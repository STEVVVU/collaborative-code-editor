import * as Y from "yjs";

export class NotebookPersistence {
  readonly whenSynced: Promise<void>;
  private database?: IDBDatabase;
  private disposed = false;
  private ready = false;

  constructor(
    name: string,
    private doc: Y.Doc,
    private onError: () => void,
  ) {
    this.doc.on("update", this.storeUpdate);
    this.whenSynced = this.open(name).catch((error) => {
      this.destroy();
      throw error;
    });
  }

  private async open(name: string) {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      let blocked = false;
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("updates"))
          db.createObjectStore("updates", { autoIncrement: true });
        if (!db.objectStoreNames.contains("custom"))
          db.createObjectStore("custom");
      };
      request.onsuccess = () => {
        if (blocked || this.disposed) {
          request.result.close();
          reject(new Error("Notebook storage closed"));
        } else resolve(request.result);
      };
      request.onerror = () =>
        reject(request.error ?? new Error("Notebook storage unavailable"));
      request.onblocked = () => {
        blocked = true;
        reject(new Error("Notebook storage is blocked by another tab"));
      };
    });
    if (this.disposed) {
      database.close();
      return;
    }
    this.database = database;
    database.onversionchange = () => {
      database.close();
      this.onError();
    };
    const updates = await this.transaction<Uint8Array[]>(
      "updates",
      "readonly",
      (store) => store.getAll(),
    );
    if (this.disposed) throw new Error("Notebook storage closed");
    Y.transact(
      this.doc,
      () => {
        for (const update of updates) Y.applyUpdate(this.doc, update);
      },
      this,
    );
    this.ready = true;
    await this.transaction("updates", "readwrite", (store) =>
      store.add(Y.encodeStateAsUpdate(this.doc)),
    );
  }

  private transaction<T>(
    name: string,
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.database || this.disposed) {
        reject(new Error("Notebook storage is closed"));
        return;
      }
      const transaction = this.database.transaction(name, mode);
      const request = action(transaction.objectStore(name));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () =>
        reject(
          transaction.error ??
            request.error ??
            new Error("Notebook storage write failed"),
        );
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Notebook storage failed"));
    });
  }

  private storeUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== this && !this.disposed && this.ready) {
      void this.transaction("updates", "readwrite", (store) =>
        store.add(update),
      ).catch(this.onError);
    }
  };

  get(key: string) {
    return this.transaction<unknown>("custom", "readonly", (store) =>
      store.get(key),
    );
  }
  set(key: string, value: unknown) {
    return this.transaction("custom", "readwrite", (store) =>
      store.put(value, key),
    );
  }

  destroy() {
    this.disposed = true;
    this.doc.off("update", this.storeUpdate);
    this.database?.close();
  }
}
