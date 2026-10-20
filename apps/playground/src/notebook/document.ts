import * as Y from "yjs";

export type NotebookRole = "edit" | "view";
export interface NotebookSettings {
  title: string;
  mode: "function" | "script";
  entrypoint: string;
  argumentsText: string;
  projectionContracts: string;
}
export interface Annotation {
  id: string;
  text: string;
  quote: string;
  start: string;
  end: string;
  author: string;
  createdAt: string;
}
export interface Capability {
  id: string;
  token: string;
}

export function encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export function notebookTypes(doc: Y.Doc) {
  return {
    source: doc.getText("source"),
    settings: doc.getMap<string>("settings"),
    annotations: doc.getArray<Annotation>("annotations"),
  };
}

export function readSettings(doc: Y.Doc): NotebookSettings {
  const settings = notebookTypes(doc).settings;
  return {
    title: settings.get("title") ?? "Untitled notebook",
    mode: settings.get("mode") === "script" ? "script" : "function",
    entrypoint: settings.get("entrypoint") ?? "",
    argumentsText: settings.get("argumentsText") ?? "[]",
    projectionContracts: settings.get("projectionContracts") ?? "",
  };
}

export function anchorAnnotation(
  doc: Y.Doc,
  start: number,
  end: number,
  text: string,
  author: string,
): Annotation {
  const source = notebookTypes(doc).source;
  if (start < 0 || end <= start || end > source.length || end - start > 4000) {
    throw new Error("Select between 1 and 4,000 characters of code first.");
  }
  if (!text.trim() || text.length > 2000)
    throw new Error("Write a comment of up to 2,000 characters.");
  return {
    id: crypto.randomUUID(),
    text: text.trim(),
    author: author.trim() || "Guest",
    quote: source.toString().slice(start, end),
    start: encode(
      Y.encodeRelativePosition(
        Y.createRelativePositionFromTypeIndex(source, start, 0),
      ),
    ),
    end: encode(
      Y.encodeRelativePosition(
        Y.createRelativePositionFromTypeIndex(source, end, -1),
      ),
    ),
    createdAt: new Date().toISOString(),
  };
}

export function resolveAnnotation(doc: Y.Doc, annotation: Annotation) {
  const source = notebookTypes(doc).source;
  const start = Y.createAbsolutePositionFromRelativePosition(
    Y.decodeRelativePosition(decode(annotation.start)),
    doc,
  );
  const end = Y.createAbsolutePositionFromRelativePosition(
    Y.decodeRelativePosition(decode(annotation.end)),
    doc,
  );
  if (
    !start ||
    !end ||
    start.type !== source ||
    end.type !== source ||
    end.index <= start.index
  )
    return null;
  return {
    start: start.index,
    end: end.index,
    current: source.toString().slice(start.index, end.index),
  };
}

export function addAnnotation(
  doc: Y.Doc,
  start: number,
  end: number,
  text: string,
  author: string,
) {
  const annotations = notebookTypes(doc).annotations;
  if (annotations.length >= 100)
    throw new Error("This notebook has reached its 100-comment limit.");
  const annotation = anchorAnnotation(doc, start, end, text, author);
  annotations.push([annotation]);
  return annotation;
}

export function parseCapability(url: URL): Capability | null {
  const params = new URLSearchParams(url.hash.slice(1));
  const id = params.get("notebook");
  const token = params.get("key");
  return id &&
    /^[\w-]{1,100}$/.test(id) &&
    token &&
    /^[\w-]{20,200}$/.test(token)
    ? { id, token }
    : null;
}

export function shareUrl(capability: Capability): string {
  const url = new URL(window.location.origin + window.location.pathname);
  url.hash = new URLSearchParams({
    notebook: capability.id,
    key: capability.token,
  }).toString();
  return url.toString();
}
