import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { NotebookClient } from "./client";
import { encode, notebookTypes } from "./document";

const persistenceControl = vi.hoisted(() => ({ fail: () => {} }));

vi.mock("./persistence", () => ({
  NotebookPersistence: class {
    constructor(_name: string, _doc: Y.Doc, onError: () => void) {
      persistenceControl.fail = onError;
    }
    whenSynced = Promise.resolve();
    get = async () => undefined;
    set = async () => undefined;
    destroy = async () => undefined;
  },
}));

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  sent: Record<string, string>[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  constructor(readonly url: string) {
    Socket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}
let client: NotebookClient;
let socket: Socket;
let server: Y.Doc;
beforeEach(async () => {
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  client = new NotebookClient({
    id: "test-notebook",
    token: "synthetic-capability-for-tests",
  });
  server = new Y.Doc();
  notebookTypes(server).source.insert(0, "initial");
  await client.start();
  socket = Socket.instances[0]!;
  socket.onopen?.();
});
afterEach(() => {
  client.dispose();
  server.destroy();
  vi.unstubAllGlobals();
});

function state(role: "edit" | "view", ack?: string) {
  socket.receive({
    type: "state",
    role,
    revision: 1,
    state: encode(Y.encodeStateAsUpdate(server)),
    ack,
  });
}

it("authenticates in a message and only the latest acknowledgement marks edits saved", () => {
  expect(socket.url).not.toContain(client.capability.token);
  expect(socket.sent[0]?.type).toBe("auth");
  state("edit");
  const initialAck = socket.sent.at(-1)!.updateId;
  notebookTypes(client.doc).source.insert(0, "local ");
  const latestAck = socket.sent.at(-1)!.updateId;
  state("edit", initialAck);
  expect(client.state.status).toBe("pending");
  state("edit", latestAck);
  expect(client.state.status).toBe("saved");
  state("edit");
  expect(client.state.status).toBe("saved");
  expect(notebookTypes(client.doc).source.toString()).toContain("local");
});

it("does not send viewer document changes", () => {
  state("view");
  notebookTypes(client.doc).source.insert(0, "attempted ");
  expect(
    socket.sent.filter((message) => message.type === "update"),
  ).toHaveLength(0);
  expect(client.state.role).toBe("view");
});

it("never calls an oversized unsent draft saved when an older acknowledgement arrives", () => {
  state("edit");
  const oldAck = socket.sent.at(-1)!.updateId;
  notebookTypes(client.doc).source.insert(0, "x".repeat(1_050_000));
  expect(client.state.status).toBe("error");
  const sentCount = socket.sent.length;
  state("edit", oldAck);
  expect(client.state.status).toBe("error");
  expect(client.state.message).toContain("sync limit");
  expect(socket.sent).toHaveLength(sentCount);
});

it("keeps offline changes and ignores responses after disposal", () => {
  state("edit");
  socket.close();
  notebookTypes(client.doc).source.insert(0, "offline ");
  expect(client.state.status).toBe("offline");
  expect(notebookTypes(client.doc).source.toString()).toContain("offline");
  client.dispose();
  const before = client.state;
  state("view");
  expect(client.state).toBe(before);
});

it("keeps storage-failure warnings visible while further offline edits are made", () => {
  state("edit");
  persistenceControl.fail();
  socket.close();
  notebookTypes(client.doc).source.insert(0, "unsaved ");
  expect(client.state.status).toBe("error");
  expect(client.state.message).toContain("Local persistence failed");
  expect(client.state.message).toContain("copy changes");
});
