import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  addAnnotation,
  anchorAnnotation,
  notebookTypes,
  parseCapability,
  resolveAnnotation,
} from "./document";

describe("character-relative annotations", () => {
  it("preserves the selected code through outside insertions, unlike integer offsets", () => {
    const doc = new Y.Doc();
    const { source } = notebookTypes(doc);
    source.insert(0, "return total");
    const annotation = anchorAnnotation(
      doc,
      7,
      12,
      "Check this accumulator",
      "Reviewer",
    );
    source.insert(0, "# reviewed\n");
    expect(resolveAnnotation(doc, annotation)?.current).toBe("total");
    expect(source.toString().slice(7, 12)).not.toBe("total");
    const position = resolveAnnotation(doc, annotation)!;
    source.insert(position.start, "(");
    source.insert(resolveAnnotation(doc, annotation)!.end, ")");
    expect(resolveAnnotation(doc, annotation)?.current).toBe("total");
  });

  it("includes internal edits and identifies deleted selections", () => {
    const doc = new Y.Doc();
    const { source } = notebookTypes(doc);
    source.insert(0, "total");
    const annotation = anchorAnnotation(doc, 0, 5, "Check", "Reviewer");
    source.insert(2, "_");
    expect(resolveAnnotation(doc, annotation)?.current).toBe("to_tal");
    source.delete(0, source.length);
    expect(resolveAnnotation(doc, annotation)).toBeNull();
    expect(annotation.quote).toBe("total");
  });

  it("converges with annotations after disconnected peers merge", () => {
    const first = new Y.Doc();
    notebookTypes(first).source.insert(0, "return total");
    const second = new Y.Doc();
    notebookTypes(second);
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    const annotation = anchorAnnotation(first, 7, 12, "Check", "Guest");
    notebookTypes(first).annotations.push([annotation]);
    notebookTypes(first).source.insert(0, "# Alice\n");
    notebookTypes(second).source.insert(0, "# Bob\n");
    Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    expect(notebookTypes(first).source.toString()).toBe(
      notebookTypes(second).source.toString(),
    );
    expect(resolveAnnotation(second, annotation)?.current).toBe("total");
  });

  it("refuses comment 101 before changing the document", () => {
    const doc = new Y.Doc();
    notebookTypes(doc).source.insert(0, "total");
    for (let index = 0; index < 100; index++)
      addAnnotation(doc, 0, 5, `Comment ${index}`, "Reviewer");
    const state = Y.encodeStateAsUpdate(doc);
    expect(() => addAnnotation(doc, 0, 5, "One too many", "Reviewer")).toThrow(
      "100-comment limit",
    );
    expect(Y.encodeStateAsUpdate(doc)).toEqual(state);
  });
});

it("accepts only well-formed fragment capabilities", () => {
  expect(
    parseCapability(
      new URL("https://example.test/#notebook=abc&key=abcdefghijklmnopqrst"),
    )?.id,
  ).toBe("abc");
  expect(
    parseCapability(
      new URL("https://example.test/?notebook=abc&key=abcdefghijklmnopqrst"),
    ),
  ).toBeNull();
  expect(
    parseCapability(new URL("https://example.test/#notebook=abc&key=short")),
  ).toBeNull();
});
