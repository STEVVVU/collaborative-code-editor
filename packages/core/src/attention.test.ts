import { describe, expect, it, vi } from "vitest";
import { compileAttentionTimeline, deriveSceneAttention, indexAttentionViews } from "./attention";
import * as sceneModule from "./scene";
import { materializeExecutionState } from "./executionModel";
import type { ExecutionTrace, RuntimeLocation, SerializedValue, TraceFrame } from "./types";

const scalar = (value: number): SerializedValue => ({ kind: "scalar", type: "int", value });
const sequence = (id: string, values: SerializedValue[]): SerializedValue => ({ kind: "sequence", id, type: "list", items: values });
const mapping = (id: string, entries: Array<[SerializedValue, SerializedValue]>): SerializedValue => ({ kind: "mapping", id, type: "dict", entries });

function frame(index: number, locals: Record<string, SerializedValue>, options: {
  location?: RuntimeLocation;
  changes?: TraceFrame["changes"];
  expression?: string;
} = {}): TraceFrame {
  return {
    index, event: "line", source: { line: index + 1 }, functionName: "<module>", scopeId: "main", depth: 0,
    callStack: [{ functionName: "<module>", scopeId: "main", line: index + 1 }], locals,
    stdout: "", changes: options.changes ?? [],
    semanticEvents: options.location ? [{ kind: "read", id: `read-${index}`, source: { line: index + 1 }, expression: options.expression ?? "read", location: options.location }] : [],
  };
}

function trace(frames: TraceFrame[]): ExecutionTrace {
  return { source: "", runSpec: { mode: "script" }, frames, stdout: "", durationMs: 0 };
}

function read(frameWithRead: TraceFrame, container: SerializedValue, key: SerializedValue, location?: RuntimeLocation): void {
  frameWithRead.semanticEvents = [{
    kind: "read", id: `read-${frameWithRead.index}`, source: { line: frameWithRead.source.line }, expression: "access",
    accessContainer: container, accessKey: key, ...(location ? { location } : {}),
  }];
}

describe("compileAttentionTimeline", () => {
  it("indexes nested structures, deduplicates aliases, and keeps graph projections atomic", () => {
    const shared = mapping("shared", [[scalar(1), sequence("nested-list", [scalar(2)])]]);
    const graph = sequence("graph-id", [sequence("row-0", [scalar(0)])]);
    const input = frame(0, { data: shared, alias: shared, graph });
    const graphContracts = { version: 1 as const, declarations: [{ id: "g", target: { root: { kind: "binding" as const, name: "graph" }, segments: [] }, configuration: { kind: "graph" as const, representation: "adjacency-list" as const, directed: true } }] };
    const output = compileAttentionTimeline(trace([input]), { projectionContracts: graphContracts })[0];
    expect(output.views.filter(({ id }) => id === "shared")).toHaveLength(1);
    expect(output.views.find(({ id }) => id === "shared")?.aliases).toContain("alias");
    expect(output.views.find(({ id }) => id === "graph-id")?.kind).toBe("graph");
    expect(output.views.some(({ id }) => id === "row-0")).toBe(false);
  });

  it("distinguishes reads from actual changes and maps nested accesses to the closest visible owner", () => {
    const before = mapping("outer", [[scalar(1), sequence("inner", [scalar(2)])]]);
    const after = mapping("outer", [[scalar(1), sequence("inner", [scalar(3)])]]);
    const readLocals = { data: before, idle: sequence("idle", [scalar(9)]) };
    const nestedLocation: RuntimeLocation = { kind: "index", containerId: "inner", index: 0 };
    const first = frame(0, readLocals, { location: nestedLocation });
    const secondLocals = { data: after, idle: sequence("idle", [scalar(9)]) };
    const second = frame(1, secondLocals, {
      location: nestedLocation,
      changes: [{ path: "data{0}.value[0]", kind: "updated", before: scalar(2), after: scalar(3), location: nestedLocation }],
    });
    const snapshots = compileAttentionTimeline(trace([first, second]));
    expect(snapshots[0].views.find(({ id }) => id === "inner")?.activity).toBe("used");
    expect(snapshots[0].views.find(({ id }) => id === "idle")?.activity).toBe("idle");
    expect(snapshots[0].workingIds).not.toContain("idle");
    expect(snapshots[1].views.find(({ id }) => id === "inner")?.activity).toBe("changed");
  });

  it("keeps a stable bounded working set and replays identical presentation-step snapshots", () => {
    const frames = ["a", "b", "c", "d"].map((name, index) => {
      const locals = Object.fromEntries(["a", "b", "c", "d"].map((item) => [item, sequence(`id-${item}`, [scalar(index)])]));
      return frame(index, locals, { location: { kind: "binding", activationId: "main", name } });
    });
    const input = trace(frames);
    const forward = compileAttentionTimeline(input, { maxWorkingViews: 2 });
    const replay = compileAttentionTimeline(input, { maxWorkingViews: 2 });
    expect(forward.map(({ workingIds }) => workingIds)).toEqual(replay.map(({ workingIds }) => workingIds));
    expect(forward.every(({ workingIds }) => workingIds.length <= 2)).toBe(true);
    expect(forward[0].workingIds).toEqual(["id-a"]);
    expect(forward[1].workingIds).toEqual(["id-a", "id-b"]);
    expect(forward[2].workingIds).toContain("id-c");
  });

  it("retains separate scalar bindings in scalar-only programs", () => {
    const locals = { left: scalar(4), right: scalar(4) };
    const result = compileAttentionTimeline(trace([frame(0, locals, { location: { kind: "binding", activationId: "main", name: "right" } })]))[0];
    expect(result.views.map(({ path }) => path)).toEqual(["left", "right"]);
    expect(result.workingIds).toEqual(["right"]);
  });

  it("attributes a field reassignment to its surviving container rather than the new child", () => {
    const oldChild: SerializedValue = { kind: "object", id: "old-node", type: "Node", fields: { value: scalar(1) } };
    const newChild: SerializedValue = { kind: "object", id: "new-node", type: "Node", fields: { value: scalar(2) } };
    const before: SerializedValue = { kind: "object", id: "head", type: "Node", fields: { next: oldChild } };
    const after: SerializedValue = { kind: "object", id: "head", type: "Node", fields: { next: newChild } };
    const changeLocation: RuntimeLocation = { kind: "field", objectId: "head", name: "next" };
    const result = compileAttentionTimeline(trace([
      frame(0, { head: before }),
      frame(1, { head: after }, { changes: [{ path: "head.next", kind: "updated", before: oldChild, after: newChild, location: changeLocation }] }),
    ]))[1];
    expect(result.views.find(({ id }) => id === "head")?.activity).toBe("changed");
    expect(result.views.find(({ id }) => id === "new-node")?.activity).toBe("idle");
  });

  it("keeps canonical occurrence paths and labels stable when binding order changes", () => {
    const shared = mapping("same", [[scalar(1), scalar(2)]]);
    const snapshots = compileAttentionTimeline(trace([
      frame(0, { first: shared, second: shared }),
      frame(1, { second: shared, first: shared }),
    ]));
    for (const snapshot of snapshots) {
      expect(snapshot.views.find(({ id }) => id === "same")).toMatchObject({ path: "first", label: "first", aliases: ["second"] });
    }
  });

  it("resolves a nested location using the longest matching alias", () => {
    const leaf: SerializedValue = { kind: "object", id: "leaf", type: "Leaf", fields: { value: scalar(1) } };
    const branch: SerializedValue = { kind: "object", id: "branch", type: "Branch", fields: { leaf } };
    const longAlias = `${"unrelated".repeat(8)}`;
    const locals = { root: branch, [longAlias]: branch };
    const result = compileAttentionTimeline(trace([frame(0, locals, { location: { kind: "field", objectId: "leaf", name: "value" } })]))[0];
    expect(result.views.find(({ id }) => id === "leaf")?.activity).toBe("used");
    expect(result.views.find(({ id }) => id === "branch")?.activity).toBe("idle");
  });

  it("keeps primitive bindings compact when structural candidates exist", () => {
    const locals = { scalar: scalar(5), first: sequence("first-id", [scalar(1)]), second: sequence("second-id", [scalar(2)]) };
    const result = compileAttentionTimeline(trace([frame(0, locals, { location: { kind: "binding", activationId: "main", name: "scalar" } })]), { maxWorkingViews: 1 })[0];
    expect(result.views.find(({ path }) => path === "scalar")?.activity).toBe("used");
    expect(result.workingIds).toEqual(["first-id"]);
  });

  it("uses container ownership for reassignment in the standalone scene fallback", () => {
    const oldChild: SerializedValue = { kind: "object", id: "old-child", type: "Node", fields: {} };
    const newChild: SerializedValue = { kind: "object", id: "new-child", type: "Node", fields: {} };
    const headBefore: SerializedValue = { kind: "object", id: "head-fallback", type: "Node", fields: { next: oldChild } };
    const headAfter: SerializedValue = { kind: "object", id: "head-fallback", type: "Node", fields: { next: newChild } };
    const change = { path: "head.next", kind: "updated" as const, before: oldChild, after: newChild, location: { kind: "field" as const, objectId: "head-fallback", name: "next" } };
    const frameWithChange = frame(1, { head: headAfter }, { changes: [change] });
    const scene = sceneModule.compileScene(frameWithChange, new sceneModule.ProjectionRegistry(), materializeExecutionState(frameWithChange));
    const result = deriveSceneAttention(scene);
    expect(result.views.find(({ id }) => id === "head-fallback")?.activity).toBe("changed");
    expect(result.views.find(({ id }) => id === "new-child")?.activity).toBe("idle");
  });

  it("attributes a location-tagged scalar binding change in the standalone fallback", () => {
    const scalarBefore = scalar(1);
    const scalarAfter = scalar(2);
    const bindingLocation: RuntimeLocation = { kind: "binding", activationId: "main", name: "count" };
    const frameWithChange = frame(1, { count: scalarAfter }, { changes: [{ path: "count", kind: "updated", before: scalarBefore, after: scalarAfter, location: bindingLocation }] });
    const scene = sceneModule.compileScene(frameWithChange, new sceneModule.ProjectionRegistry(), materializeExecutionState(frameWithChange));
    const result = deriveSceneAttention(scene);
    expect(result.views.find(({ path }) => path === "count")?.activity).toBe("changed");
  });

  it("preserves changed and higher ranked candidates during same-step overflow", () => {
    const locals = {
      changed: sequence("changed-id", [scalar(2)]),
      usedA: sequence("used-a-id", [scalar(3)]),
      usedB: sequence("used-b-id", [scalar(4)]),
    };
    const inputFrame = frame(0, locals, {
      changes: [{ path: "changed[0]", kind: "updated", before: scalar(1), after: scalar(2), location: { kind: "index", containerId: "changed-id", index: 0 } }],
    });
    inputFrame.semanticEvents = ["usedA", "usedB"].map((name) => ({
      kind: "read" as const, id: `read-${name}`, source: { line: 1 }, expression: name,
      location: { kind: "binding" as const, activationId: "main", name },
    }));
    const result = compileAttentionTimeline(trace([inputFrame]), { maxWorkingViews: 2 })[0];
    expect(result.views.find(({ id }) => id === "changed-id")?.activity).toBe("changed");
    expect(result.workingIds).toContain("changed-id");
    expect(result.workingIds).toEqual(["changed-id", "used-a-id"]);
  });

  it("lets newer direct use replace an older changed view", () => {
    const firstLocals = { first: sequence("first-id", [scalar(2)]), second: sequence("second-id", [scalar(3)]) };
    const firstFrame = frame(0, firstLocals, {
      changes: [{ path: "first[0]", kind: "updated", before: scalar(1), after: scalar(2), location: { kind: "index", containerId: "first-id", index: 0 } }],
    });
    const secondFrame = frame(1, firstLocals, { location: { kind: "binding", activationId: "main", name: "second" } });
    const result = compileAttentionTimeline(trace([firstFrame, secondFrame]), { maxWorkingViews: 1 });
    expect(result[0].workingIds).toEqual(["first-id"]);
    expect(result[1].views.find(({ id }) => id === "first-id")?.activity).toBe("idle");
    expect(result[1].workingIds).toEqual(["second-id"]);
  });

  it("removes primitive working slots when a mixed structural workspace appears", () => {
    const scalarFrame = frame(0, { count: scalar(1) }, { location: { kind: "binding", activationId: "main", name: "count" } });
    const mixedFrame = frame(1, { count: scalar(2), data: sequence("data-id", [scalar(2)]) }, { location: { kind: "binding", activationId: "main", name: "count" } });
    const snapshots = compileAttentionTimeline(trace([scalarFrame, mixedFrame]), { maxWorkingViews: 1 });
    expect(snapshots[0].workingIds).toEqual(["count"]);
    expect(snapshots[1].workingIds).toEqual(["data-id"]);
  });

  it("includes aliases from indexAttentionViews", () => {
    const shared = mapping("indexed-shared", [[scalar(1), scalar(2)]]);
    const variables = sceneModule.projectSceneVariables(frame(0, { first: shared, second: shared }), new sceneModule.ProjectionRegistry());
    const result = indexAttentionViews(variables).find(({ id }) => id === "indexed-shared");
    expect(result?.path).toBe("first");
    expect(result?.aliases).toEqual(["second"]);
  });

  it("attributes a read without a location through its sequence container identity", () => {
    const items = sequence("sequence-read", [scalar(1), scalar(2)]);
    const frameWithRead = frame(0, { items });
    read(frameWithRead, items, scalar(0));
    const result = compileAttentionTimeline(trace([frameWithRead]))[0];
    expect(result.views.find(({ id }) => id === "sequence-read")?.activity).toBe("used");
    expect(result.workingIds).toContain("sequence-read");
  });

  it("attributes a locationless mapping read to its nested visible value", () => {
    const value: SerializedValue = { kind: "object", id: "mapped-value", type: "Node", fields: { next: scalar(1) } };
    const data = mapping("mapping-read", [[{ kind: "scalar", type: "str", value: "key" }, value]]);
    const frameWithRead = frame(0, { data });
    read(frameWithRead, data, { kind: "scalar", type: "str", value: "key" });
    const result = compileAttentionTimeline(trace([frameWithRead]))[0];
    expect(result.views.find(({ id }) => id === "mapped-value")?.activity).toBe("used");
    expect(result.views.find(({ id }) => id === "mapping-read")?.activity).toBe("idle");
  });

  it("attributes an unsupported object-slot read through its object identity", () => {
    const object: SerializedValue = { kind: "object", id: "object-read", type: "Node", fields: { value: scalar(1) } };
    const frameWithRead = frame(0, { object });
    read(frameWithRead, object, { kind: "scalar", type: "str", value: "value" });
    const result = compileAttentionTimeline(trace([frameWithRead]))[0];
    expect(result.views.find(({ id }) => id === "object-read")?.activity).toBe("used");
  });

  it("keeps a graph atomic while attributing a locationless indexed read", () => {
    const graph = sequence("graph-read", [sequence("graph-row", [scalar(0)])]);
    const frameWithRead = frame(0, { graph });
    read(frameWithRead, graph, scalar(0));
    const contracts = { version: 1 as const, declarations: [{ id: "g", target: { root: { kind: "binding" as const, name: "graph" }, segments: [] }, configuration: { kind: "graph" as const, representation: "adjacency-list" as const, directed: true } }] };
    const result = compileAttentionTimeline(trace([frameWithRead]), { projectionContracts: contracts })[0];
    expect(result.views.find(({ id }) => id === "graph-read")?.kind).toBe("graph");
    expect(result.views.find(({ id }) => id === "graph-read")?.activity).toBe("used");
    expect(result.views.some(({ id }) => id === "graph-row")).toBe(false);
  });

  it("keeps an explicit location authoritative over a different access container", () => {
    const container = sequence("container", [scalar(1)]);
    const other = sequence("other", [scalar(2)]);
    const frameWithRead = frame(0, { container, other });
    read(frameWithRead, container, scalar(0), { kind: "binding", activationId: "main", name: "other" });
    const result = compileAttentionTimeline(trace([frameWithRead]))[0];
    expect(result.views.find(({ id }) => id === "other")?.activity).toBe("used");
    expect(result.views.find(({ id }) => id === "container")?.activity).toBe("idle");
  });

  it("does not infer an access when the container has no runtime identity", () => {
    const scalarContainer = scalar(3);
    const frameWithRead = frame(0, { container: sequence("unrelated", [scalar(1)]) });
    read(frameWithRead, scalarContainer, scalar(0));
    const result = compileAttentionTimeline(trace([frameWithRead]))[0];
    expect(result.views.find(({ id }) => id === "unrelated")?.activity).toBe("idle");
  });

  it("projects timeline variables without compiling a full scene", () => {
    const compileScene = vi.spyOn(sceneModule, "compileScene");
    try {
      compileAttentionTimeline(trace([frame(0, { data: sequence("data-id", [scalar(1)]) })]));
      expect(compileScene).not.toHaveBeenCalled();
    } finally {
      compileScene.mockRestore();
    }
  });
});
