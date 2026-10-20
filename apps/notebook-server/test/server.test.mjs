import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import * as Y from "yjs";
import { createNotebookServer } from "../src/server.mjs";

const input = () => ({
  title: "Shared example",
  source: "hello",
  settings: {
    mode: "script",
    entrypoint: "",
    argumentsText: "[]",
    projectionContracts: "",
  },
});
const encode = (doc) =>
  Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
function decode(state) {
  const doc = new Y.Doc();
  doc.getText("source");
  doc.getMap("settings");
  doc.getArray("annotations");
  Y.applyUpdate(doc, Buffer.from(state, "base64"));
  return doc;
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "traceframe-notebook-"));
  const dbPath = join(directory, "notebooks.sqlite");
  let server = await createNotebookServer({
    port: 0,
    dbPath,
    allowedOrigins: ["http://localhost:5173"],
  });
  t.after(async () => {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  const request = async (path, body, token, origin) => {
    const response = await fetch(`${server.url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(origin ? { origin } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  };
  const create = async () => {
    const result = await request("/api/notebooks", input());
    assert.equal(result.status, 201);
    return result.data;
  };
  const open = async (room, token = room.editToken) =>
    request(`/api/notebooks/${room.id}/open`, {}, token);
  const connect = async (room, token = room.editToken) => {
    const socket = new WebSocket(
      `${server.url.replace("http", "ws")}/api/notebooks/${room.id}/live`,
    );
    const queue = [];
    const pending = [];
    socket.on("message", (data) => {
      const value = JSON.parse(data.toString());
      const waiter = pending.shift();
      if (waiter) waiter.resolve(value);
      else queue.push(value);
    });
    socket.on("error", () => {});
    t.after(() => socket.terminate());
    await once(socket, "open");
    const next = () =>
      queue.length
        ? Promise.resolve(queue.shift())
        : new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error("No server response")),
              3000,
            );
            pending.push({
              resolve: (value) => {
                clearTimeout(timer);
                resolve(value);
              },
            });
          });
    socket.send(JSON.stringify({ type: "auth", token }));
    const initial = await next();
    return {
      socket,
      initial,
      next,
      send: (value) => socket.send(JSON.stringify(value)),
    };
  };
  return {
    request,
    create,
    open,
    connect,
    dbPath,
    get server() {
      return server;
    },
    restart: async () => {
      await server.close();
      server = await createNotebookServer({
        port: 0,
        dbPath,
        allowedOrigins: ["http://localhost:5173"],
      });
    },
  };
}

test("creation, capability authentication, SQLite hashes, and restart preserve a notebook", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.request("/health"), {
    status: 200,
    data: { ok: true },
  });
  const room = await f.create();
  assert.equal(decode(room.state).getText("source").toString(), "hello");
  assert.equal((await f.open(room)).data.role, "edit");
  assert.equal((await f.open(room, room.viewToken)).data.role, "view");
  assert.equal((await f.open(room, "wrong-token")).status, 403);
  assert.equal((await f.open({ ...room, id: "missing" })).status, 403);
  const bytes = await readFile(f.dbPath);
  assert.equal(bytes.includes(Buffer.from(room.editToken)), false);
  assert.equal(bytes.includes(Buffer.from(room.viewToken)), false);
  await f.restart();
  assert.deepEqual((await f.open(room)).data, {
    id: room.id,
    role: "edit",
    state: room.state,
    revision: room.revision,
  });
});

test("two editors merge concurrent full states, acknowledge retries, and persist the merged revision", async (t) => {
  const f = await fixture(t);
  const room = await f.create();
  const a = await f.connect(room);
  const b = await f.connect(room);
  const viewer = await f.connect(room, room.viewToken);
  const left = decode(a.initial.state);
  const right = decode(b.initial.state);
  left.getText("source").insert(0, "A");
  right.getText("source").insert(5, "B");
  a.send({ type: "update", updateId: "a", state: encode(left) });
  b.send({ type: "update", updateId: "b", state: encode(right) });
  const aMessages = [await a.next(), await a.next()];
  const bMessages = [await b.next(), await b.next()];
  assert.equal(aMessages.filter((message) => message.ack === "a").length, 1);
  assert.equal(bMessages.filter((message) => message.ack === "b").length, 1);
  assert.equal(
    aMessages.some((message) => message.ack === "b"),
    false,
  );
  const latest = aMessages.at(-1);
  assert.equal(latest.role, "edit");
  assert.equal(bMessages.at(-1).role, "edit");
  const viewerMessages = [await viewer.next(), await viewer.next()];
  assert.equal(viewerMessages.at(-1).role, "view");
  assert.equal(viewerMessages.at(-1).ack, undefined);
  assert.equal(decode(latest.state).getText("source").toString(), "AhelloB");
  assert.equal(latest.revision, room.revision + 2);
  a.send({ type: "update", updateId: "retry", state: encode(left) });
  const duplicate = await a.next();
  assert.equal(duplicate.ack, "retry");
  assert.equal(duplicate.revision, latest.revision);
  await f.restart();
  const reopened = (await f.open(room)).data;
  assert.equal(reopened.revision, latest.revision);
  assert.equal(decode(reopened.state).getText("source").toString(), "AhelloB");
});

test("viewer writes and invalid capabilities cannot alter state", async (t) => {
  const f = await fixture(t);
  const room = await f.create();
  const viewer = await f.connect(room, room.viewToken);
  assert.equal(viewer.initial.role, "view");
  const document = decode(room.state);
  document.getText("source").insert(0, "forbidden");
  viewer.send({ type: "update", updateId: "view", state: encode(document) });
  assert.equal((await viewer.next()).type, "error");
  const invalid = await f.connect(room, "not-a-capability");
  assert.equal(invalid.initial.type, "error");
  assert.equal(
    JSON.stringify(invalid.initial).includes("not-a-capability"),
    false,
  );
  assert.equal((await f.open(room)).data.state, room.state);
});

test("invalid updates are atomic across live state, persistence, and later valid edits", async (t) => {
  const f = await fixture(t);
  const room = await f.create();
  const editor = await f.connect(room);
  const attempts = [
    "!!!",
    Buffer.from("not yjs").toString("base64"),
    ...[
      (doc) => doc.getText("source").insert(0, "x".repeat(65537)),
      (doc) => doc.getMap("settings").set("unknown", "value"),
      (doc) => doc.getMap("settings").set("mode", "invalid"),
      (doc) => doc.getMap("extra").set("secret", "forbidden"),
      (doc) => doc.getArray("annotations").push([{ id: "bad" }]),
      (doc) => doc.getText("source").insertEmbed(0, { malicious: true }),
    ].map((change) => {
      const doc = decode(room.state);
      change(doc);
      return encode(doc);
    }),
  ];
  for (const state of attempts) {
    editor.send({ type: "update", updateId: "bad", state });
    const result = await editor.next();
    assert.equal(result.type, "error");
    const persisted = (await f.open(room)).data;
    assert.equal(persisted.state, room.state);
    assert.equal(persisted.revision, room.revision);
  }
  const valid = decode(room.state);
  valid.getText("source").insert(0, "valid ");
  editor.send({ type: "update", updateId: "good", state: encode(valid) });
  assert.equal((await editor.next()).ack, "good");
  await f.restart();
  assert.equal(
    decode((await f.open(room)).data.state)
      .getText("source")
      .toString(),
    "valid hello",
  );
});

test("HTTP and WebSocket boundaries enforce origins, JSON, schema, and size budgets", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.request("/api/notebooks", { ...input(), title: "x".repeat(121) }))
      .status,
    400,
  );
  assert.equal(
    (
      await f.request("/api/notebooks", {
        ...input(),
        source: "x".repeat(65537),
      })
    ).status,
    400,
  );
  assert.equal(
    (await f.request("/api/notebooks", { ...input(), extra: true })).status,
    400,
  );
  assert.equal(
    (
      await f.request(
        "/api/notebooks",
        input(),
        undefined,
        "https://evil.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request(
        "/api/notebooks",
        input(),
        undefined,
        "http://localhost:5173",
      )
    ).status,
    201,
  );
  const raw = await fetch(`${f.server.url}/api/notebooks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  assert.equal(raw.status, 400);
  const tooLarge = await fetch(`${f.server.url}/api/notebooks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input(), source: "x".repeat(1572865) }),
  });
  assert.equal(tooLarge.status, 413);
  const preflight = await fetch(`${f.server.url}/api/notebooks`, {
    method: "OPTIONS",
    headers: {
      origin: "http://localhost:5173",
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization,content-type",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.get("access-control-allow-origin"),
    "http://localhost:5173",
  );
  const room = await f.create();
  const denied = new WebSocket(
    `${f.server.url.replace("http", "ws")}/api/notebooks/${room.id}/live`,
    { origin: "https://evil.example" },
  );
  denied.on("error", () => {});
  const [, response] = await once(denied, "unexpected-response");
  assert.equal(response.statusCode, 403);
  response.resume();
  denied.terminate();
  const editor = await f.connect(room);
  editor.send({ type: "update", updateId: "huge", state: "A".repeat(1400004) });
  assert.equal((await editor.next()).type, "error");
  const oversized = await f.connect(room);
  const closed = once(oversized.socket, "close");
  oversized.socket.send("x".repeat(1572865));
  assert.equal((await closed)[0], 1009);
  assert.equal((await f.open(room)).data.state, room.state);
});

test("annotations and run settings survive normal edits while malformed structures are rejected", async (t) => {
  const f = await fixture(t);
  const room = await f.create();
  const editor = await f.connect(room);
  const doc = decode(room.state);
  const position = (index, assoc) =>
    Buffer.from(
      Y.encodeRelativePosition(
        Y.createRelativePositionFromTypeIndex(
          doc.getText("source"),
          index,
          assoc,
        ),
      ),
    ).toString("base64");
  doc
    .getArray("annotations")
    .push([
      {
        id: "comment-1",
        text: "Inspect this word",
        quote: "hello",
        start: position(0, 0),
        end: position(5, -1),
        author: "Editor",
        createdAt: "2026-10-20T12:00:00Z",
      },
    ]);
  doc.getMap("settings").set("argumentsText", "[unfinished");
  doc
    .getMap("settings")
    .set(
      "projectionContracts",
      JSON.stringify({ version: 1, declarations: [] }),
    );
  editor.send({ type: "update", updateId: "comment", state: encode(doc) });
  const accepted = await editor.next();
  assert.equal(accepted.ack, "comment");
  const saved = decode((await f.open(room)).data.state);
  assert.equal(saved.getArray("annotations").get(0).quote, "hello");
  assert.equal(saved.getMap("settings").get("argumentsText"), "[unfinished");
  const mutations = [
    (candidate) => candidate.getMap("settings").set("projectionContracts", "{"),
    (candidate) =>
      candidate
        .getMap("settings")
        .set(
          "projectionContracts",
          JSON.stringify({ version: 1, declarations: [{}] }),
        ),
    (candidate) =>
      candidate.getMap("settings").set("entrypoint", "x".repeat(201)),
    (candidate) =>
      candidate.getMap("settings").set("argumentsText", "x".repeat(16385)),
    (candidate) =>
      candidate
        .getMap("settings")
        .set("projectionContracts", " ".repeat(16385)),
    (candidate) =>
      candidate
        .getArray("annotations")
        .push([
          {
            ...saved.getArray("annotations").get(0),
            id: "comment-2",
            start: "invalid",
          },
        ]),
    (candidate) =>
      candidate
        .getArray("annotations")
        .push([saved.getArray("annotations").get(0)]),
    (candidate) =>
      candidate
        .getArray("annotations")
        .push(
          Array.from({ length: 100 }, (_, i) => ({
            ...saved.getArray("annotations").get(0),
            id: `extra-${i}`,
          })),
        ),
    (candidate) => candidate.getText("source").format(0, 1, { bold: true }),
    (candidate) =>
      candidate.getMap("settings").set("title", new Y.Text("nested")),
  ];
  for (const change of mutations) {
    const invalid = decode(accepted.state);
    change(invalid);
    editor.send({
      type: "update",
      updateId: "invalid",
      state: encode(invalid),
    });
    assert.equal((await editor.next()).type, "error");
    assert.equal((await f.open(room)).data.state, accepted.state);
    invalid.destroy();
  }
  await f.restart();
  assert.equal((await f.open(room)).data.state, accepted.state);
});

test("wrong root types and incomplete Yjs updates cannot bypass validation", async (t) => {
  const f = await fixture(t);
  const room = await f.create();
  const editor = await f.connect(room);
  const wrongRoots = [
    (doc) => doc.getMap("source").set("unexpected", "value"),
    (doc) => doc.getArray("settings").push(["unexpected"]),
    (doc) => doc.getMap("annotations").set("unexpected", "value"),
  ];
  for (const change of wrongRoots) {
    const wrongRoot = new Y.Doc();
    change(wrongRoot);
    editor.send({ type: "update", updateId: "root", state: encode(wrongRoot) });
    assert.equal((await editor.next()).type, "error");
    wrongRoot.destroy();
  }
  const isolated = new Y.Doc();
  isolated.getText("source").insert(0, "first");
  const vector = Y.encodeStateVector(isolated);
  isolated.getText("source").insert(5, "second");
  editor.send({
    type: "update",
    updateId: "incomplete",
    state: Buffer.from(Y.encodeStateAsUpdate(isolated, vector)).toString(
      "base64",
    ),
  });
  assert.equal((await editor.next()).type, "error");
  assert.equal((await f.open(room)).data.state, room.state);
});

test("authentication is required within five seconds and capabilities in URLs are rejected", async (t) => {
  const f = await fixture(t);
  const room = await f.create();
  const url = `${f.server.url.replace("http", "ws")}/api/notebooks/${room.id}/live`;
  const query = new WebSocket(`${url}?token=${room.editToken}`);
  query.on("error", () => {});
  const [, response] = await once(query, "unexpected-response");
  assert.equal(response.statusCode, 403);
  response.resume();
  query.terminate();
  const socket = new WebSocket(url);
  socket.on("error", () => {});
  t.after(() => socket.terminate());
  const result = once(socket, "message");
  const closed = once(socket, "close");
  assert.equal(JSON.parse((await result)[0].toString()).type, "error");
  assert.equal((await closed)[0], 1008);
});
