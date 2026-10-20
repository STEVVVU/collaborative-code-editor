import * as Y from "yjs";
import { NotebookPersistence } from "./persistence";
import {
  decode,
  encode,
  notebookTypes,
  type Capability,
  type NotebookRole,
} from "./document";

export interface ConnectionState {
  status: "connecting" | "saved" | "pending" | "offline" | "error";
  role?: NotebookRole;
  revision: number;
  message?: string;
}

export class NotebookClient {
  readonly doc = new Y.Doc();
  state: ConnectionState = { status: "connecting", revision: 0 };
  private storage?: NotebookPersistence;
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private authenticated = false;
  private initialized = false;
  private lastUpdate = "";
  private syncError?: string;
  private storageError?: string;
  private listeners = new Set<() => void>();

  constructor(readonly capability: Capability) {
    notebookTypes(this.doc);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(next: ConnectionState) {
    if (this.disposed) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  async start() {
    try {
      const fingerprint = encode(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(this.capability.token),
          ),
        ),
      );
      if (this.disposed) return;
      const storage = new NotebookPersistence(
        `traceframe:${this.capability.id}:${fingerprint}`,
        this.doc,
        this.onStorageError,
      );
      this.storage = storage;
      await storage.whenSynced;
      if (this.disposed) return;
      const cachedRole = await storage.get("role");
      const cachedRevision = await storage.get("revision");
      if (this.disposed) return;
      if (cachedRole === "edit" || cachedRole === "view") {
        this.publish({
          status: "offline",
          role: cachedRole,
          revision:
            typeof cachedRevision === "number" &&
            Number.isSafeInteger(cachedRevision)
              ? cachedRevision
              : 0,
        });
      }
      this.doc.on("update", this.onUpdate);
      this.initialized = true;
      this.connect();
    } catch {
      this.storage?.destroy();
      this.publish({
        status: "error",
        revision: 0,
        message:
          "Local notebook storage is unavailable. Allow site storage and reopen this notebook.",
      });
    }
  }

  private onStorageError = () => {
    this.storageError =
      "Local persistence failed. Keep this tab open and copy changes before leaving.";
    this.publish({
      ...this.state,
      status: "error",
      message: this.storageError,
    });
  };

  private onUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin === "server" || this.disposed) return;
    if (this.state.role !== "edit") return;
    this.syncError = undefined;
    this.lastUpdate = crypto.randomUUID();
    this.publish({
      ...this.state,
      status: this.storageError
        ? "error"
        : this.authenticated
          ? "pending"
          : "offline",
      message: this.storageError,
    });
    this.sendState();
  };

  private sendState() {
    if (
      !this.authenticated ||
      this.state.role !== "edit" ||
      this.socket?.readyState !== WebSocket.OPEN
    )
      return;
    const state = encode(Y.encodeStateAsUpdate(this.doc));
    if (state.length > 1_398_104) {
      this.lastUpdate = crypto.randomUUID();
      this.syncError =
        "Notebook exceeds the 1 MiB sync limit. Keep this tab open and copy your changes before leaving.";
      this.publish({ ...this.state, status: "error", message: this.syncError });
      return;
    }
    this.lastUpdate = crypto.randomUUID();
    this.socket.send(
      JSON.stringify({ type: "update", updateId: this.lastUpdate, state }),
    );
  }

  private connect = () => {
    if (this.disposed) return;
    this.authenticated = false;
    const url = new URL(
      `/api/notebooks/${this.capability.id}/live`,
      window.location.origin,
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => {
      if (!this.disposed)
        socket.send(
          JSON.stringify({ type: "auth", token: this.capability.token }),
        );
    };
    socket.onmessage = (event) => {
      if (this.disposed || this.socket !== socket) return;
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === "error") {
          this.syncError = String(message.message);
          this.publish({
            ...this.state,
            status: "error",
            message: this.syncError,
          });
          return;
        }
        if (
          message.type !== "state" ||
          !["edit", "view"].includes(message.role) ||
          !Number.isSafeInteger(message.revision) ||
          typeof message.state !== "string"
        ) {
          throw new Error("Invalid notebook response");
        }
        const first = !this.authenticated;
        Y.applyUpdate(this.doc, decode(message.state), "server");
        this.authenticated = true;
        if (message.ack === this.lastUpdate) this.lastUpdate = "";
        void Promise.all([
          this.storage?.set("role", message.role),
          this.storage?.set("revision", message.revision),
        ]).catch(() => {
          this.onStorageError();
        });
        this.publish({
          status:
            this.storageError || this.syncError
              ? "error"
              : message.role === "view" || !this.lastUpdate
                ? "saved"
                : "pending",
          role: message.role,
          revision: message.revision,
          message: this.storageError ?? this.syncError,
        });
        if (first && message.role === "edit") {
          this.publish({ ...this.state, status: "pending" });
          this.sendState();
        }
      } catch {
        this.authenticated = false;
        this.publish({
          ...this.state,
          status: "error",
          message:
            "The notebook server sent an invalid document. Your local draft is retained.",
        });
        socket.close();
      }
    };
    socket.onclose = () => {
      if (this.disposed || this.socket !== socket) return;
      this.authenticated = false;
      if (this.state.status === "error") return;
      this.publish({ ...this.state, status: "offline", message: undefined });
      this.retry = setTimeout(this.connect, 2000);
    };
    socket.onerror = () => {
      socket.close();
    };
  };

  reconnect() {
    if (this.disposed) return;
    clearTimeout(this.retry);
    const previous = this.socket;
    this.socket = undefined;
    previous?.close();
    this.syncError = undefined;
    this.publish({ ...this.state, status: "connecting", message: undefined });
    if (!this.initialized || this.storageError) {
      this.storage?.destroy();
      this.storageError = undefined;
      this.doc.off("update", this.onUpdate);
      this.initialized = false;
      void this.start();
      return;
    }
    this.connect();
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.retry);
    this.doc.off("update", this.onUpdate);
    this.socket?.close();
    void this.storage?.destroy();
    this.doc.destroy();
    this.listeners.clear();
  }
}
