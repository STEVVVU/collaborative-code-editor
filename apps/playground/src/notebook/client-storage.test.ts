import { IDBFactory } from "fake-indexeddb";
import { expect, it, vi } from "vitest";
import * as Y from "yjs";
import { NotebookClient } from "./client";
import { encode, notebookTypes } from "./document";

it("reinitializes storage on reconnect and transmits subsequent local edits", async () => {
  const sockets: Socket[] = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    sent: Array<{ type: string }> = [];
    onmessage?: (event: { data: string }) => void;
    constructor() {
      sockets.push(this);
    }
    send(data: string) {
      this.sent.push(JSON.parse(data));
    }
    close() {
      this.readyState = 3;
    }
  }
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("indexedDB", {
    open() {
      throw new DOMException("Denied", "SecurityError");
    },
  });
  const client = new NotebookClient({
    id: "recovery-test",
    token: "synthetic-test-capability",
  });
  const doc = new Y.Doc();
  try {
    await client.start();
    expect(client.state.status).toBe("error");
    expect(sockets).toHaveLength(0);
    vi.stubGlobal("indexedDB", new IDBFactory());
    client.reconnect();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    notebookTypes(doc).source.insert(0, "base");
    sockets[0]!.onmessage?.({
      data: JSON.stringify({
        type: "state",
        state: encode(Y.encodeStateAsUpdate(doc)),
        revision: 1,
        role: "edit",
      }),
    });
    const before = sockets[0]!.sent.length;
    notebookTypes(client.doc).source.insert(0, "local ");
    expect(sockets[0]!.sent.length).toBe(before + 1);
    expect(client.state.status).toBe("pending");
  } finally {
    client.dispose();
    doc.destroy();
    vi.unstubAllGlobals();
  }
});
