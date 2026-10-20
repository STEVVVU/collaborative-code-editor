import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { WebSocket, WebSocketServer } from "ws";
import * as Y from "yjs";
import { validateProjectionContracts } from "@traceframe/core";

const DOCUMENT_LIMIT = 1024 * 1024;
const FRAME_LIMIT = 1.5 * 1024 * 1024;
const defaultOrigins = ["http://127.0.0.1:5173", "http://localhost:5173"];
const settingLimits = {
  title: 120,
  mode: 8,
  entrypoint: 200,
  argumentsText: 16384,
  projectionContracts: 16384,
};
const annotationLimits = {
  id: 100,
  text: 2000,
  quote: 4000,
  start: 500,
  end: 500,
  author: 300,
  createdAt: 100,
};

function requireValid(condition) {
  if (!condition) throw new Error("Invalid notebook data");
}

function exactObject(value, keys) {
  requireValid(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  requireValid(
    Object.keys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key)),
  );
}

function decodeBase64(value, maxBytes = DOCUMENT_LIMIT) {
  requireValid(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= Math.ceil(maxBytes / 3) * 4,
  );
  requireValid(
    value.length % 4 === 0 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        value,
      ),
  );
  const bytes = Buffer.from(value, "base64");
  requireValid(bytes.length <= maxBytes && bytes.toString("base64") === value);
  return bytes;
}

function newDocument() {
  const doc = new Y.Doc();
  doc.getText("source");
  doc.getMap("settings");
  doc.getArray("annotations");
  return doc;
}

function validateDocument(doc) {
  requireValid(
    doc.share.size === 3 &&
      ["source", "settings", "annotations"].every((name) =>
        doc.share.has(name),
      ),
  );
  requireValid(!doc.store.pendingStructs && !doc.store.pendingDs);
  const source = doc.getText("source");
  requireValid(source._map.size === 0 && source.length <= 65536);
  requireValid(
    source
      .toDelta()
      .every(
        (operation) =>
          typeof operation.insert === "string" && !operation.attributes,
      ),
  );
  const settings = doc.getMap("settings");
  requireValid(settings._start === null);
  const values = Object.fromEntries(settings);
  exactObject(values, Object.keys(settingLimits));
  for (const [key, limit] of Object.entries(settingLimits))
    requireValid(
      typeof values[key] === "string" && values[key].length <= limit,
    );
  requireValid(values.mode === "script" || values.mode === "function");
  if (values.projectionContracts !== "")
    validateProjectionContracts(JSON.parse(values.projectionContracts));
  const annotations = doc.getArray("annotations");
  requireValid(annotations._map.size === 0 && annotations.length <= 100);
  const ids = new Set();
  for (const annotation of annotations.toArray()) {
    exactObject(annotation, Object.keys(annotationLimits));
    for (const [key, limit] of Object.entries(annotationLimits))
      requireValid(
        typeof annotation[key] === "string" && annotation[key].length <= limit,
      );
    requireValid(!ids.has(annotation.id));
    ids.add(annotation.id);
    for (const key of ["start", "end"])
      Y.decodeRelativePosition(decodeBase64(annotation[key], 375));
  }
  const bytes = Buffer.from(Y.encodeStateAsUpdate(doc));
  requireValid(bytes.length <= DOCUMENT_LIMIT);
  return bytes;
}

const hash = (token) => createHash("sha256").update(token).digest();
function roleFor(row, token) {
  if (
    !row ||
    typeof token !== "string" ||
    token.length < 32 ||
    token.length > 128
  )
    return null;
  const value = hash(token);
  if (timingSafeEqual(value, row.edit_hash)) return "edit";
  if (timingSafeEqual(value, row.view_hash)) return "view";
  return null;
}

function send(socket, value) {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > FRAME_LIMIT * 2) {
    socket.close(1013, "Slow connection");
    return;
  }
  socket.send(JSON.stringify(value));
}

export async function createNotebookServer({
  port = 5190,
  dbPath = ".traceframe/notebooks.sqlite",
  allowedOrigins = defaultOrigins,
} = {}) {
  requireValid(Number.isInteger(port) && port >= 0 && port <= 65535);
  const origins = new Set(allowedOrigins);
  if (dbPath !== ":memory:")
    await mkdir(dirname(resolve(dbPath)), { recursive: true });
  const database = new DatabaseSync(dbPath);
  database.exec(
    "PRAGMA journal_mode = DELETE; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS notebooks (id TEXT PRIMARY KEY, edit_hash BLOB NOT NULL, view_hash BLOB NOT NULL, state BLOB NOT NULL, revision INTEGER NOT NULL)",
  );
  const find = database.prepare("SELECT * FROM notebooks WHERE id = ?");
  const insert = database.prepare(
    "INSERT INTO notebooks (id, edit_hash, view_hash, state, revision) VALUES (?, ?, ?, ?, 1)",
  );
  const persist = database.prepare(
    "UPDATE notebooks SET state = ?, revision = ? WHERE id = ?",
  );
  const peers = new Map();
  const originAllowed = (request) =>
    request.headers.origin === undefined || origins.has(request.headers.origin);
  const respond = (response, status, value) => {
    response.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    response.end(JSON.stringify(value));
  };
  const http = createServer(async (request, response) => {
    try {
      if (!originAllowed(request)) {
        respond(response, 403, { error: "Origin rejected" });
        return;
      }
      const origin = request.headers.origin;
      if (origin) {
        response.setHeader("access-control-allow-origin", origin);
        response.setHeader("vary", "Origin");
      }
      if (request.method === "OPTIONS") {
        response.setHeader(
          "access-control-allow-methods",
          "GET, POST, OPTIONS",
        );
        response.setHeader(
          "access-control-allow-headers",
          "Content-Type, Authorization",
        );
        response.writeHead(204);
        response.end();
        return;
      }
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (request.method === "GET" && pathname === "/health") {
        respond(response, 200, { ok: true });
        return;
      }
      const match = /^\/api\/notebooks\/([^/]+)\/open$/.exec(pathname);
      if (request.method === "POST" && match) {
        const row = find.get(match[1]);
        const token = /^Bearer ([^\s]+)$/.exec(
          request.headers.authorization ?? "",
        )?.[1];
        const role = roleFor(row, token);
        if (!role) {
          respond(response, 403, { error: "Capability rejected" });
          return;
        }
        respond(response, 200, {
          id: row.id,
          role,
          state: Buffer.from(row.state).toString("base64"),
          revision: row.revision,
        });
        return;
      }
      if (request.method !== "POST" || pathname !== "/api/notebooks") {
        respond(response, 404, { error: "Not found" });
        return;
      }
      requireValid(
        request.headers["content-type"]?.split(";")[0].trim() ===
          "application/json",
      );
      let length = 0;
      const chunks = [];
      for await (const chunk of request) {
        length += chunk.length;
        if (length > FRAME_LIMIT) {
          respond(response, 413, { error: "Request too large" });
          return;
        }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      exactObject(body, ["title", "source", "settings"]);
      exactObject(body.settings, [
        "mode",
        "entrypoint",
        "argumentsText",
        "projectionContracts",
      ]);
      requireValid(
        typeof body.source === "string" && typeof body.title === "string",
      );
      const doc = newDocument();
      let state;
      try {
        doc.getText("source").insert(0, body.source);
        const settings = doc.getMap("settings");
        for (const [key, value] of Object.entries({
          ...body.settings,
          title: body.title,
        }))
          settings.set(key, value);
        state = validateDocument(doc);
      } finally {
        doc.destroy();
      }
      const id = randomUUID();
      const editToken = randomBytes(32).toString("base64url");
      const viewToken = randomBytes(32).toString("base64url");
      insert.run(id, hash(editToken), hash(viewToken), state);
      respond(response, 201, {
        id,
        editToken,
        viewToken,
        state: state.toString("base64"),
        revision: 1,
      });
    } catch {
      if (!response.headersSent)
        respond(response, 400, { error: "Invalid notebook request" });
      else response.end();
    }
  });
  const websocket = new WebSocketServer({
    noServer: true,
    maxPayload: FRAME_LIMIT,
    perMessageDeflate: false,
  });
  http.on("upgrade", (request, socket, head) => {
    const match = /^\/api\/notebooks\/([^/?]+)\/live$/.exec(request.url ?? "");
    if (!match || !originAllowed(request)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    websocket.handleUpgrade(request, socket, head, (client) =>
      websocket.emit("connection", client, match[1]),
    );
  });
  websocket.on("connection", (socket, id) => {
    let role = null;
    const timeout = setTimeout(() => {
      send(socket, { type: "error", message: "Authentication required" });
      socket.close(1008, "Authentication required");
    }, 5000);
    socket.on("error", () => {});
    socket.on("close", () => {
      clearTimeout(timeout);
      const room = peers.get(id);
      room?.delete(socket);
      if (room?.size === 0) peers.delete(id);
    });
    socket.on("message", (data, binary) => {
      try {
        requireValid(!binary);
        const message = JSON.parse(data.toString("utf8"));
        if (role === null) {
          exactObject(message, ["type", "token"]);
          requireValid(message.type === "auth");
          const row = find.get(id);
          role = roleFor(row, message.token);
          if (!role) {
            send(socket, { type: "error", message: "Capability rejected" });
            socket.close(1008, "Capability rejected");
            return;
          }
          clearTimeout(timeout);
          if (!peers.has(id)) peers.set(id, new Map());
          peers.get(id).set(socket, role);
          send(socket, {
            type: "state",
            state: Buffer.from(row.state).toString("base64"),
            revision: row.revision,
            role,
          });
          return;
        }
        requireValid(role === "edit");
        exactObject(message, ["type", "updateId", "state"]);
        requireValid(
          message.type === "update" &&
            typeof message.updateId === "string" &&
            message.updateId.length > 0 &&
            message.updateId.length <= 200,
        );
        const incoming = decodeBase64(message.state);
        const row = find.get(id);
        const candidate = newDocument();
        let state;
        try {
          Y.applyUpdate(candidate, row.state);
          Y.applyUpdate(candidate, incoming);
          state = validateDocument(candidate);
        } finally {
          candidate.destroy();
        }
        const changed = !state.equals(Buffer.from(row.state));
        const revision = row.revision + Number(changed);
        if (changed) persist.run(state, revision, id);
        const committed = {
          type: "state",
          state: state.toString("base64"),
          revision,
        };
        send(socket, { ...committed, role, ack: message.updateId });
        if (changed)
          for (const [peer, peerRole] of peers.get(id) ?? [])
            if (peer !== socket) send(peer, { ...committed, role: peerRole });
      } catch {
        send(socket, { type: "error", message: "Notebook update rejected" });
      }
    });
  });
  try {
    await new Promise((resolveListening, reject) => {
      http.once("error", reject);
      http.listen(port, "127.0.0.1", () => {
        http.off("error", reject);
        resolveListening();
      });
    });
  } catch (error) {
    websocket.close();
    database.close();
    throw error;
  }
  const actualPort = http.address().port;
  let closing;
  return {
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}`,
    close() {
      closing ??= (async () => {
        for (const socket of websocket.clients) socket.terminate();
        await new Promise((done) => websocket.close(done));
        await new Promise((done, reject) => {
          http.close((error) => (error ? reject(error) : done()));
          http.closeAllConnections();
        });
        database.close();
      })();
      return closing;
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const server = await createNotebookServer({
    port: Number(process.env.PORT ?? 5190),
    dbPath: process.env.NOTEBOOK_DB ?? ".traceframe/notebooks.sqlite",
    allowedOrigins:
      process.env.NOTEBOOK_ORIGINS?.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean) ?? defaultOrigins,
  });
  console.log(`Notebook service listening on ${server.url}`);
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
