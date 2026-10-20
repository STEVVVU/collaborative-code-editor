import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { NotebookPersistence } from "./persistence";
import { notebookTypes } from "./document";

const stores: NotebookPersistence[] = [];
beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => {
  for (const store of stores.splice(0)) store.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function storage(name: string, doc: Y.Doc, onError = vi.fn()) {
  const store = new NotebookPersistence(name, doc, onError);
  stores.push(store);
  return store;
}

it("appends concurrent peer updates and retains deletion history through reload", async () => {
  const first = new Y.Doc();
  const second = new Y.Doc();
  notebookTypes(first);
  notebookTypes(second);
  const a = storage("shared", first);
  const b = storage("shared", second);
  await Promise.all([a.whenSynced, b.whenSynced]);
  notebookTypes(first).source.insert(0, "Alice");
  notebookTypes(second).source.insert(0, "Bob");
  await Promise.all([a.set("role", "edit"), b.set("revision", 5)]);
  const merged = new Y.Doc();
  notebookTypes(merged);
  const c = storage("shared", merged);
  await c.whenSynced;
  expect(notebookTypes(merged).source.toString()).toContain("Alice");
  expect(notebookTypes(merged).source.toString()).toContain("Bob");
  notebookTypes(merged).source.delete(0, notebookTypes(merged).source.length);
  await c.set("revision", 6);
  c.destroy();
  const restored = new Y.Doc();
  notebookTypes(restored);
  const d = storage("shared", restored);
  await d.whenSynced;
  expect(notebookTypes(restored).source.toString()).toBe("");
  expect(await d.get("role")).toBe("edit");
  expect(await d.get("revision")).toBe(6);
});

it("rejects denied storage instead of hanging or leaving an unhandled rejection", async () => {
  vi.stubGlobal("indexedDB", {
    open() {
      throw new DOMException("Denied", "SecurityError");
    },
  });
  const store = storage("denied", new Y.Doc());
  await expect(store.whenSynced).rejects.toThrow("Denied");
});

it("waits for transaction commit and rejects an abort after request success", async () => {
  const store = storage("aborted", new Y.Doc());
  await store.whenSynced;
  const original = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    ...args
  ) {
    const request = original.apply(this, args);
    request.addEventListener("success", () => this.transaction.abort());
    return request;
  });
  await expect(store.set("role", "edit")).rejects.toThrow();
});

it("preserves edits made while initialization is pending", async () => {
  const doc = new Y.Doc();
  const store = storage("initializing", doc);
  notebookTypes(doc).source.insert(0, "early edit");
  await store.whenSynced;
  store.destroy();
  const restored = new Y.Doc();
  const next = storage("initializing", restored);
  await next.whenSynced;
  expect(notebookTypes(restored).source.toString()).toBe("early edit");
});

it("does not attach observers or reopen storage after disposal during initialization", async () => {
  const doc = new Y.Doc();
  const store = storage("disposed", doc);
  store.destroy();
  await expect(store.whenSynced).rejects.toThrow("closed");
  await expect(store.set("role", "edit")).rejects.toThrow("closed");
});
