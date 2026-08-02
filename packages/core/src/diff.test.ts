import { describe, expect, it } from "vitest";
import { annotateFrames, coalesceFrames, diffLocals } from "./diff";
import type { RawTraceFrame, SerializedValue } from "./types";

const scalar = (value: number): SerializedValue => ({
  kind: "scalar",
  type: "int",
  value,
});

const sequence = (id: string, values: number[]): SerializedValue => ({
  kind: "sequence",
  id,
  type: "list",
  items: values.map(scalar),
});

describe("diffLocals", () => {
  it("tracks nested sequence updates without replacing stable containers", () => {
    const changes = diffLocals(
      { numbers: sequence("py:1", [3, 1, 2]) },
      { numbers: sequence("py:1", [1, 3, 2]) },
    );

    expect(changes.map((change) => [change.kind, change.path])).toEqual([
      ["updated", "numbers[0]"],
      ["updated", "numbers[1]"],
    ]);
  });

  it("tracks variable creation and removal", () => {
    expect(diffLocals({}, { index: scalar(0) })).toMatchObject([
      { kind: "created", path: "index" },
    ]);
    expect(diffLocals({ index: scalar(0) }, {})).toMatchObject([
      { kind: "removed", path: "index" },
    ]);
  });

  it("does not report mapping changes when stable entries only reorder", () => {
    const entry = (key: number, value: number) =>
      [scalar(key), scalar(value)] as [SerializedValue, SerializedValue];
    const before: SerializedValue = {
      kind: "mapping",
      id: "map:1",
      type: "dict",
      entries: [entry(1, 10), entry(2, 20)],
      entryIds: ["entry:1", "entry:2"],
    };
    const after: SerializedValue = {
      kind: "mapping",
      id: "map:1",
      type: "dict",
      entries: [entry(2, 20), entry(1, 10)],
      entryIds: ["entry:2", "entry:1"],
    };

    expect(diffLocals({ values: before }, { values: after })).toEqual([]);
  });

  it("does not report set changes when stable members only reorder", () => {
    const before: SerializedValue = {
      kind: "set",
      id: "set:1",
      type: "set",
      items: [scalar(1), scalar(2)],
      itemIds: ["member:1", "member:2"],
    };
    const after: SerializedValue = {
      kind: "set",
      id: "set:1",
      type: "set",
      items: [scalar(2), scalar(1)],
      itemIds: ["member:2", "member:1"],
    };

    expect(diffLocals({ values: before }, { values: after })).toEqual([]);
  });
});

describe("annotateFrames", () => {
  it("assigns stable indexes and derives changes from previous state", () => {
    const rawFrames: RawTraceFrame[] = [
      {
        event: "line",
        source: { line: 1 },
        functionName: "<module>",
        scopeId: "module",
        depth: 0,
        locals: { value: scalar(1) },
        stdout: "",
      },
      {
        event: "line",
        source: { line: 2 },
        functionName: "<module>",
        scopeId: "module",
        depth: 0,
        locals: { value: scalar(2) },
        stdout: "",
      },
    ];

    const frames = annotateFrames(rawFrames);
    expect(frames.map((frame) => frame.index)).toEqual([0, 1]);
    expect(frames[0].changes[0]).toMatchObject({ path: "value", kind: "created" });
    expect(frames[1].changes[0]).toMatchObject({ path: "value", kind: "updated" });
  });
});

describe("coalesceFrames", () => {
  it("preserves debugger line transitions and semantic operations", () => {
    const frames: RawTraceFrame[] = [
      {
        event: "line",
        source: { line: 1 },
        functionName: "<module>",
        scopeId: "module",
        depth: 0,
        locals: {},
        stdout: "",
      },
      {
        event: "line",
        source: { line: 2 },
        functionName: "<module>",
        scopeId: "module",
        depth: 0,
        locals: {},
        stdout: "",
        semanticEvents: [
          {
            kind: "branch",
            source: { line: 1 },
            expression: "value > 0",
            result: { kind: "scalar", type: "bool", value: true },
          },
        ],
      },
    ];

    const result = coalesceFrames(frames);
    expect(result).toHaveLength(2);
    expect(result[0].source.line).toBe(1);
    expect(result[1].semanticEvents[0].kind).toBe("branch");
    expect(result[0].index).toBe(0);
    expect(result[1].index).toBe(1);
  });
});
