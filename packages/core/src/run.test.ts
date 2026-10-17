import { describe, expect, it } from "vitest";
import { parseFunctionRunSpec, runSpecArgumentsText } from "./run";

describe("parseFunctionRunSpec", () => {
  it("builds a function run from a JSON argument list", () => {
    expect(
      parseFunctionRunSpec(" bubble_sort ", "[[5, 1, 4], true]"),
    ).toEqual({
      mode: "function",
      entrypoint: "bubble_sort",
      arguments: [[5, 1, 4], true],
    });
  });

  it("accepts a dotted class method entrypoint", () => {
    expect(parseFunctionRunSpec("Solution.twoSum", "[[2,7,11,15],9]")).toMatchObject({
      entrypoint: "Solution.twoSum",
    });
  });

  it("rejects invalid entrypoints and non-array arguments", () => {
    expect(() => parseFunctionRunSpec("sort()", "[]")).toThrow(
      "dotted callable path",
    );
    expect(() => parseFunctionRunSpec("sort", '{"nums": [1]}')).toThrow(
      "JSON array",
    );
  });

  it("serializes function arguments for editing", () => {
    expect(
      runSpecArgumentsText({
        mode: "function",
        entrypoint: "solve",
        arguments: [[1, 2], null],
      }),
    ).toBe("[[1,2],null]");
    expect(runSpecArgumentsText({ mode: "script" })).toBe("[]");
  });

  it("validates tagged object graphs and forward references", () => {
    expect(() =>
      parseFunctionRunSpec(
        "solve",
        JSON.stringify([
          {
            $kind: "object",
            type: "ListNode",
            id: "head",
            fields: {
              val: 1,
              next: { $kind: "reference", id: "head" },
            },
          },
        ]),
      ),
    ).not.toThrow();
  });

  it("rejects malformed tags, duplicate ids, and dangling references", () => {
    expect(() =>
      parseFunctionRunSpec(
        "solve",
        '[{"$kind":"object","type":"Node","fields":{},"id":"x"},{"$kind":"object","type":"Node","fields":{},"id":"x"}]',
      ),
    ).toThrow("Duplicate input identity");
    expect(() =>
      parseFunctionRunSpec(
        "solve",
        '[{"$kind":"reference","id":"missing"}]',
      ),
    ).toThrow("Unknown input reference");
    expect(() =>
      parseFunctionRunSpec("solve", '[{"$kind":"tree"}]'),
    ).toThrow("Unknown tagged input kind");
  });

  it("preserves and validates explicit projection contracts", () => {
    const contracts = {
      version: 1,
      declarations: [{
        id: "graph",
        target: {
          root: { kind: "binding", name: "graph" },
          segments: [{ kind: "index", index: 0 }],
        },
        configuration: {
          kind: "graph",
          representation: "adjacency-list",
          directed: true,
        },
      }],
    };
    expect(parseFunctionRunSpec("walk", "[]", contracts)).toMatchObject({
      projectionContracts: contracts,
    });
    expect(() => parseFunctionRunSpec("walk", "[]", {
      ...contracts,
      unexpected: true,
    })).toThrow("Projection contracts must use version 1 with declarations");
    expect(() => parseFunctionRunSpec("walk", "[]", {
      ...contracts,
      declarations: [...contracts.declarations, { ...contracts.declarations[0] }],
    })).toThrow("Duplicate projection contract id");
    expect(() => parseFunctionRunSpec("walk", "[]", {
      ...contracts,
      declarations: [{
        ...contracts.declarations[0],
        target: { root: { kind: "binding", name: "graph.path" }, segments: [] },
      }],
    })).toThrow("invalid binding target");
    expect(() => parseFunctionRunSpec("walk", "[]", {
      ...contracts,
      declarations: [{
        ...contracts.declarations[0],
        id: "nested",
        target: {
          root: { kind: "binding", name: "graph" },
          segments: [],
        },
      }, {
        ...contracts.declarations[0],
        id: "child",
        target: {
          root: { kind: "binding", name: "graph" },
          segments: [{ kind: "index", index: 0 }],
        },
      }],
    })).toThrow("Conflicting projection contract target");
  });

  it("validates each as a keyless contract path segment", () => {
    const contracts = {
      version: 1,
      declarations: [{
        id: "all-graphs",
        target: {
          root: { kind: "binding", name: "state" },
          segments: [{ kind: "each" }],
        },
        configuration: {
          kind: "graph",
          representation: "adjacency-list",
          directed: false,
        },
      }],
    };

    expect(parseFunctionRunSpec("solve", "[]", contracts))
      .toMatchObject({ projectionContracts: contracts });
    expect(() => parseFunctionRunSpec("solve", "[]", {
      ...contracts,
      declarations: [{
        ...contracts.declarations[0],
        target: {
          ...contracts.declarations[0].target,
          segments: [{ kind: "each", index: 0 }],
        },
      }],
    })).toThrow("invalid each segment");
  });

  it("compares projection targets without delimiter collisions", () => {
    const graphConfiguration = {
      kind: "graph",
      representation: "adjacency-list",
      directed: true,
    } as const;

    expect(() => parseFunctionRunSpec("walk", "[]", {
      version: 1,
      declarations: [{
        id: "slash-field",
        target: {
          root: { kind: "binding", name: "graph" },
          segments: [{ kind: "field", name: "node/index:0" }],
        },
        configuration: graphConfiguration,
      }, {
        id: "nested-field",
        target: {
          root: { kind: "binding", name: "graph" },
          segments: [
            { kind: "field", name: "node" },
            { kind: "index", index: 0 },
          ],
        },
        configuration: graphConfiguration,
      }, {
        id: "slash-map-key",
        target: {
          root: { kind: "binding", name: "graph" },
          segments: [{
            kind: "mapKey",
            key: { kind: "scalar", type: "str", value: "node/index:0" },
          }],
        },
        configuration: graphConfiguration,
      }],
    })).not.toThrow();
  });

  it("requires exact typed scalar map keys and graph configurations", () => {
    const contracts = {
      version: 1,
      declarations: [{
        id: "routes",
        target: {
          root: { kind: "binding", name: "state" },
          segments: [{
            kind: "mapKey",
            key: { kind: "scalar", type: "int", value: 1 },
          }],
        },
        configuration: {
          kind: "graph",
          representation: "adjacency-list",
          directed: true,
        },
      }],
    };

    expect(parseFunctionRunSpec("walk", "[]", contracts)).toMatchObject({
      projectionContracts: contracts,
    });
    expect(() => parseFunctionRunSpec("walk", "[]", {
      ...contracts,
      declarations: [{
        ...contracts.declarations[0],
        target: {
          ...contracts.declarations[0].target,
          segments: [{ kind: "mapKey", key: 1 }],
        },
      }],
    })).toThrow("invalid map key segment");
    expect(() => parseFunctionRunSpec("walk", "[]", {
      ...contracts,
      declarations: [{
        ...contracts.declarations[0],
        configuration: {
          kind: "graph",
          representation: "adjacency-list",
          directed: "true",
        },
      }],
    })).toThrow("invalid graph configuration");
  });
});
