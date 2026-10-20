import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as Y from "yjs";
import {
  anchorAnnotation,
  notebookTypes,
  resolveAnnotation,
} from "../apps/playground/src/notebook/document.ts";

const cases = [
  ["prefix insertion", (source) => source.insert(0, "# reviewed\n"), "total"],
  [
    "suffix insertion",
    (source) => source.insert(source.length, " + tax"),
    "total",
  ],
  ["left boundary insertion", (source) => source.insert(7, "("), "total"],
  ["right boundary insertion", (source) => source.insert(12, ")"), "total"],
  ["inside selection", (source) => source.insert(9, "_"), "to_tal"],
  ["selection deletion", (source) => source.delete(7, 5), null],
];
const rows = [];
for (const [name, edit, expected] of cases) {
  const doc = new Y.Doc();
  const { source } = notebookTypes(doc);
  source.insert(0, "return total");
  const annotation = anchorAnnotation(
    doc,
    7,
    12,
    "Check accumulator",
    "Experiment",
  );
  edit(source);
  const current = resolveAnnotation(doc, annotation)?.current ?? null;
  assert.equal(current, expected, name);
  const integerOffsets = source.toString().slice(7, 12) || null;
  rows.push({
    name,
    expected,
    relative: current,
    unchangedIntegerOffsets: integerOffsets,
    relativePass: current === expected,
    integerPass: integerOffsets === expected,
  });
  doc.destroy();
}
const first = new Y.Doc();
notebookTypes(first).source.insert(0, "return total");
const second = new Y.Doc();
notebookTypes(second);
Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
const annotation = anchorAnnotation(first, 7, 12, "Review", "Experiment");
notebookTypes(first).annotations.push([annotation]);
notebookTypes(first).source.insert(0, "# Alice\n");
notebookTypes(second).source.insert(0, "# Bob\n");
Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
assert.equal(
  notebookTypes(first).source.toString(),
  notebookTypes(second).source.toString(),
);
assert.equal(resolveAnnotation(second, annotation)?.current, "total");
const mergedRelative = resolveAnnotation(second, annotation)?.current;
const mergedInteger = notebookTypes(second).source.toString().slice(7, 12);
rows.push({
  name: "disconnected concurrent prefix insertions",
  expected: "total",
  relative: mergedRelative,
  unchangedIntegerOffsets: mergedInteger,
  relativePass: mergedRelative === "total",
  integerPass: mergedInteger === "total",
});
const restored = new Y.Doc();
notebookTypes(restored);
Y.applyUpdate(restored, Y.encodeStateAsUpdate(second));
assert.equal(resolveAnnotation(restored, annotation)?.current, "total");
const output = {
  cases: rows,
  converged: true,
  restored: true,
  limitation:
    "Named correctness cases, not a benchmark or full Peritext implementation. The baseline uses fixed offsets without operational transformation.",
};
if (process.argv[2]) {
  const directory = resolve(process.argv[2]);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, "annotations.json"),
    JSON.stringify(output, null, 2),
  );
}
console.log(JSON.stringify(output, null, 2));
for (const doc of [first, second, restored]) doc.destroy();
