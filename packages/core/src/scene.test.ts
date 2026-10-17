import { describe, expect, it } from "vitest";
import { compileScene, ProjectionRegistry } from "./scene";
import type {
  ProjectionContractsV1,
  SerializedValue,
  TraceFrame,
} from "./types";

const scalar = (value: number): SerializedValue => ({
  kind: "scalar",
  type: "int",
  value,
});

const stringScalar = (value: string): SerializedValue => ({
  kind: "scalar",
  type: "str",
  value,
});

function row(id: string, values: number[]): SerializedValue {
  return {
    kind: "sequence",
    id,
    type: "list",
    items: values.map(scalar),
  };
}

function adjacencyGraph(id: string, neighbors: number[][]): SerializedValue {
  return {
    kind: "sequence",
    id,
    type: "list",
    items: neighbors.map((values, index) => row(`${id}-neighbors-${index}`, values)),
  };
}

describe("ProjectionRegistry", () => {
  it("lifts rectangular nested sequences into a grid projection", () => {
    const grid: SerializedValue = {
      kind: "sequence",
      id: "grid",
      type: "list",
      items: [row("row-a", [1, 2]), row("row-b", [3, 4])],
    };

    const projection = new ProjectionRegistry().project(grid, {
      key: "grid",
      label: "grid",
      depth: 0,
    });

    expect(projection.kind).toBe("grid");
    if (projection.kind === "grid") {
      expect(projection.rows).toHaveLength(2);
      expect(projection.rows[0]).toHaveLength(2);
    }
  });

  it("lifts a zero-valued dynamic-programming grid without graph inference", () => {
    const grid: SerializedValue = {
      kind: "sequence",
      id: "dp",
      type: "list",
      items: [row("row-a", [0, 0]), row("row-b", [0, 0])],
    };

    expect(
      new ProjectionRegistry().project(grid, {
        key: "dp",
        label: "dp",
        depth: 0,
      }),
    ).toMatchObject({
      kind: "grid",
      rows: [
        [{ kind: "scalar", value: "0" }, { kind: "scalar", value: "0" }],
        [{ kind: "scalar", value: "0" }, { kind: "scalar", value: "0" }],
      ],
    });
  });

  it("keeps non-rectangular nested sequences as ordinary sequences", () => {
    const jagged: SerializedValue = {
      kind: "sequence",
      id: "jagged",
      type: "list",
      items: [row("row-a", [1]), row("row-b", [2, 3])],
    };

    expect(
      new ProjectionRegistry().project(jagged, {
        key: "items",
        label: "items",
        depth: 0,
      }).kind,
    ).toBe("sequence");
  });

  it("keeps a rectangular adjacency sequence structural without a contract", () => {
    const adjacency: SerializedValue = {
      kind: "sequence",
      id: "adjacency",
      type: "list",
      items: [
        row("neighbors-0", [1, 2]),
        row("neighbors-1", [0, 2]),
        row("neighbors-2", [0, 1]),
      ],
    };

    const projection = new ProjectionRegistry().project(adjacency, {
      key: "network",
      label: "network",
      depth: 0,
    });

    expect(projection.kind).toBe("grid");
  });

  it("lifts a closed adjacency sequence with an explicit graph contract", () => {
    const adjacency: SerializedValue = {
      kind: "sequence",
      id: "adjacency",
      type: "list",
      items: [
        row("neighbors-0", [1, 2]),
        row("neighbors-1", [0]),
        row("neighbors-2", [0]),
      ],
    };
    const contracts: ProjectionContractsV1 = {
      version: 1,
      declarations: [{
        id: "network",
        target: { root: { kind: "binding", name: "network" }, segments: [] },
        configuration: {
          kind: "graph",
          representation: "adjacency-list",
          directed: false,
        },
      }],
    };
    const projection = new ProjectionRegistry([], contracts, { network: adjacency }).project(adjacency, {
      key: "network",
      label: "network",
      depth: 0,
    });

    expect(projection.kind).toBe("graph");
    if (projection.kind === "graph") {
      expect(projection.directed).toBe(false);
      expect(projection.vertices.map((vertex) => vertex.label)).toEqual(["0", "1", "2"]);
      expect(projection.edges).toHaveLength(2);
      expect(projection.vertices[0].adjacency).toMatchObject({
        kind: "sequence",
        label: "Neighbors of 0",
      });
    }
  });

  it("shows a stable error for malformed contracted adjacency values", () => {
    const malformed: SerializedValue = {
      kind: "sequence",
      id: "malformed-adjacency",
      type: "list",
      items: [
        row("neighbors-0", [1]),
        { kind: "scalar", type: "int", value: 0 },
      ],
    };
    const contracts: ProjectionContractsV1 = {
      version: 1,
      declarations: [{
        id: "graph",
        target: { root: { kind: "binding", name: "graph" }, segments: [] },
        configuration: {
          kind: "graph",
          representation: "adjacency-list",
          directed: true,
        },
      }],
    };

    expect(
      new ProjectionRegistry([], contracts, { graph: malformed }).project(malformed, {
        key: "graph",
        label: "graph",
        depth: 0,
      }),
    ).toMatchObject({
      kind: "truncated",
      preview: "Invalid adjacency-list graph contract",
    });
  });

  it("shows a stable error when a graph contract resolves to a scalar", () => {
    const scalarTarget = scalar(1);
    const contracts: ProjectionContractsV1 = {
      version: 1,
      declarations: [{
        id: "graph",
        target: { root: { kind: "binding", name: "graph" }, segments: [] },
        configuration: {
          kind: "graph",
          representation: "adjacency-list",
          directed: true,
        },
      }],
    };

    expect(
      new ProjectionRegistry([], contracts, { graph: scalarTarget }).project(scalarTarget, {
        key: "graph",
        label: "graph",
        depth: 0,
      }),
    ).toMatchObject({
      kind: "truncated",
      preview: "Invalid adjacency-list graph contract",
    });
  });

  it("requires a contract to lift key-based adjacency maps into directed graphs", () => {
    const startEntry: [SerializedValue, SerializedValue] = [
      stringScalar("start"),
      {
        kind: "sequence",
        id: "start-neighbors",
        type: "list",
        items: [stringScalar("finish")],
      },
    ];
    const finishEntry: [SerializedValue, SerializedValue] = [
      stringScalar("finish"),
      {
        kind: "sequence",
        id: "finish-neighbors",
        type: "list",
        items: [],
      },
    ];
    const adjacency: SerializedValue = {
      kind: "mapping",
      id: "routes",
      type: "dict",
      entries: [startEntry, finishEntry],
    };

    expect(
      new ProjectionRegistry().project(adjacency, {
        key: "routes",
        label: "routes",
        depth: 0,
      }).kind,
    ).toBe("mapping");

    const contracts: ProjectionContractsV1 = {
      version: 1,
      declarations: [{
        id: "routes",
        target: { root: { kind: "binding", name: "routes" }, segments: [] },
        configuration: {
          kind: "graph",
          representation: "adjacency-list",
          directed: true,
        },
      }],
    };
    const registry = new ProjectionRegistry([], contracts, { routes: adjacency });
    const projection = registry.project(adjacency, {
      key: "routes",
      label: "routes",
      depth: 0,
    });

    expect(projection).toMatchObject({
      kind: "graph",
      directed: true,
      edges: [{
        sourceId: "routes:vertex:str%3A%22start%22",
        targetId: "routes:vertex:str%3A%22finish%22",
      }],
    });

    const reordered = new ProjectionRegistry([], contracts, {
      routes: {
      ...adjacency,
      entries: [finishEntry, startEntry],
      },
    }).project({
      ...adjacency,
      entries: [finishEntry, startEntry],
    }, {
      key: "routes",
      label: "routes",
      depth: 0,
    });
    expect(reordered.kind).toBe("graph");
    if (projection.kind === "graph" && reordered.kind === "graph") {
      expect(reordered.vertices.map((vertex) => vertex.id).sort()).toEqual(
        projection.vertices.map((vertex) => vertex.id).sort(),
      );
      expect(reordered.edges.map((edge) => edge.id)).toEqual(
        projection.edges.map((edge) => edge.id),
      );
    }
  });

  it("projects aliases of a contracted value by runtime identity", () => {
    const adjacency: SerializedValue = {
      kind: "sequence",
      id: "adjacency",
      type: "list",
      items: [row("neighbors-0", [1]), row("neighbors-1", [0])],
    };
    const contracts: ProjectionContractsV1 = {
      version: 1,
      declarations: [{
        id: "graph",
        target: { root: { kind: "binding", name: "graph" }, segments: [] },
        configuration: {
          kind: "graph",
          representation: "adjacency-list",
          directed: false,
        },
      }],
    };
    const registry = new ProjectionRegistry([], contracts, {
      graph: adjacency,
      alias: { kind: "reference", targetId: "adjacency", type: "list" },
    });

    const alias: SerializedValue = {
      kind: "reference",
      targetId: "adjacency",
      type: "list",
    };
    expect(registry.project(alias, { key: "alias", label: "alias", depth: 0 })).toMatchObject({
      kind: "graph",
      key: "adjacency",
      label: "alias",
    });
  });

  it("rejects contracts whose targets resolve to the same alias identity", () => {
    const adjacency: SerializedValue = {
      kind: "sequence",
      id: "adjacency",
      type: "list",
      items: [row("neighbors-0", [1]), row("neighbors-1", [0])],
    };
    const contracts: ProjectionContractsV1 = {
      version: 1,
      declarations: [
        {
          id: "forward-graph",
          target: { root: { kind: "binding", name: "graph" }, segments: [] },
          configuration: {
            kind: "graph",
            representation: "adjacency-list",
            directed: true,
          },
        },
        {
          id: "reverse-graph",
          target: { root: { kind: "binding", name: "alias" }, segments: [] },
          configuration: {
            kind: "graph",
            representation: "adjacency-list",
            directed: false,
          },
        },
      ],
    };

    const bindings = {
      graph: adjacency,
      alias: { kind: "reference", targetId: "adjacency", type: "list" },
    };
    const message =
      "Projection contracts 'forward-graph', 'reverse-graph' resolve to identity 'adjacency'";

    expect(() => new ProjectionRegistry([], contracts, bindings)).toThrow(message);
    expect(() => new ProjectionRegistry([], {
      ...contracts,
      declarations: [...contracts.declarations].reverse(),
    }, bindings)).toThrow(message);
  });

  it("coalesces matching contracts whose targets resolve to an alias identity", () => {
    const adjacency: SerializedValue = {
      kind: "sequence",
      id: "adjacency",
      type: "list",
      items: [row("neighbors-0", [1]), row("neighbors-1", [0])],
    };
    const contracts: ProjectionContractsV1 = {
      version: 1,
      declarations: [
        {
          id: "graph",
          target: { root: { kind: "binding", name: "graph" }, segments: [] },
          configuration: {
            kind: "graph",
            representation: "adjacency-list",
            directed: false,
          },
        },
        {
          id: "alias",
          target: { root: { kind: "binding", name: "alias" }, segments: [] },
          configuration: {
            kind: "graph",
            representation: "adjacency-list",
            directed: false,
          },
        },
      ],
    };

    const projection = new ProjectionRegistry([], contracts, {
      graph: adjacency,
      alias: { kind: "reference", targetId: "adjacency", type: "list" },
    }).project(adjacency, { key: "graph", label: "graph", depth: 0 });

    expect(projection).toMatchObject({ kind: "graph", directed: false });
  });

  it("resolves typed field, index, and map-key target segments", () => {
    const adjacency: SerializedValue = {
      kind: "sequence",
      id: "nested-adjacency",
      type: "list",
      items: [row("nested-neighbors-0", [1]), row("nested-neighbors-1", [0])],
    };
    const state: SerializedValue = {
      kind: "object",
      id: "state",
      type: "State",
      fields: {
        layers: {
          kind: "sequence",
          id: "layers",
          type: "list",
          items: [{
            kind: "mapping",
            id: "layer-0",
            type: "dict",
            entries: [[stringScalar("primary"), adjacency]],
          }],
        },
      },
    };
    const contracts: ProjectionContractsV1 = {
      version: 1,
      declarations: [{
        id: "nested-graph",
        target: {
          root: { kind: "binding", name: "state" },
          segments: [
            { kind: "field", name: "layers" },
            { kind: "index", index: 0 },
            {
              kind: "mapKey",
              key: { kind: "scalar", type: "str", value: "primary" },
            },
          ],
        },
        configuration: {
          kind: "graph",
          representation: "adjacency-list",
          directed: false,
        },
      }],
    };

    const registry = new ProjectionRegistry([], contracts, { state });
    expect(
      registry.project(adjacency, {
        key: "nested",
        label: "nested",
        depth: 0,
      }).kind,
    ).toBe("graph");
  });

  it("selects immediate sequence, set, mapping-value, and object-field children", () => {
    const graphs = [
      adjacencyGraph("each-sequence-graph", [[1], [0]]),
      adjacencyGraph("each-set-graph", [[1], [0]]),
      adjacencyGraph("each-mapping-graph", [[1, 2], [0], [0]]),
      adjacencyGraph("each-object-graph", [[1], [0]]),
    ];
    const bindings: Record<string, SerializedValue> = {
      sequence: { kind: "sequence", id: "sequence-container", type: "list", items: [graphs[0]] },
      set: { kind: "set", id: "set-container", type: "set", items: [graphs[1]] },
      mapping: {
        kind: "mapping",
        id: "mapping-container",
        type: "dict",
        entries: [[stringScalar("graph"), graphs[2]]],
      },
      object: {
        kind: "object",
        id: "object-container",
        type: "Graphs",
        fields: { graph: graphs[3] },
      },
    };
    const contracts: ProjectionContractsV1 = {
      version: 1,
      declarations: Object.keys(bindings).map((name) => ({
        id: `${name}-children`,
        target: {
          root: { kind: "binding" as const, name },
          segments: [{ kind: "each" as const }],
        },
        configuration: {
          kind: "graph" as const,
          representation: "adjacency-list" as const,
          directed: false,
        },
      })),
    };
    const registry = new ProjectionRegistry([], contracts, bindings);

    expect(graphs.map((graph) => registry.project(graph, {
      key: "graph",
      label: "graph",
      depth: 0,
    }).kind)).toEqual(["graph", "graph", "graph", "graph"]);
    const mappingKey = (bindings.mapping as Extract<SerializedValue, { kind: "mapping" }>).entries[0][0];
    expect(registry.project(mappingKey, {
      key: "mapping-key",
      label: "mapping-key",
      depth: 0,
    }).kind).toBe("scalar");
  });

  it("composes each selectors through nested containers for differently sized graphs", () => {
    const smallGraph = adjacencyGraph("nested-small-graph", [[1], [0]]);
    const largeGraph: SerializedValue = {
      kind: "sequence",
      id: "nested-large-graph",
      type: "list",
      items: [
        row("nested-large-neighbors-0", [1, 3]),
        row("nested-large-neighbors-1", [0, 2]),
        row("nested-large-neighbors-2", [1, 3]),
        row("nested-large-neighbors-3", [0, 2]),
      ],
    };
    const state: SerializedValue = {
      kind: "mapping",
      id: "nested-state",
      type: "dict",
      entries: [
        [stringScalar("batches"), {
          kind: "sequence",
          id: "nested-batches",
          type: "list",
          items: [
            {
              kind: "mapping",
              id: "nested-batch-a",
              type: "dict",
              entries: [[stringScalar("graphs"), {
                kind: "mapping",
                id: "nested-graphs-a",
                type: "dict",
                entries: [
                  [stringScalar("small"), smallGraph],
                  [stringScalar("small-alias"), smallGraph],
                ],
              }]],
            },
            {
              kind: "mapping",
              id: "nested-batch-b",
              type: "dict",
              entries: [[stringScalar("graphs"), {
                kind: "mapping",
                id: "nested-graphs-b",
                type: "dict",
                entries: [[stringScalar("large"), largeGraph]],
              }]],
            },
          ],
        }],
        [stringScalar("metadata"), {
          kind: "sequence",
          id: "nested-metadata",
          type: "list",
          items: [scalar(2), scalar(4)],
        }],
      ],
    };
    const contracts: ProjectionContractsV1 = {
      version: 1,
      declarations: [{
        id: "all-batch-graphs",
        target: {
          root: { kind: "binding", name: "state" },
          segments: [
            { kind: "mapKey", key: stringScalar("batches") },
            { kind: "each" },
            { kind: "mapKey", key: stringScalar("graphs") },
            { kind: "each" },
          ],
        },
        configuration: {
          kind: "graph",
          representation: "adjacency-list",
          directed: false,
        },
      }],
    };
    const registry = new ProjectionRegistry([], contracts, { state });

    const smallProjection = registry.project(smallGraph, {
      key: "small",
      label: "small",
      depth: 0,
    });
    const largeProjection = registry.project(largeGraph, {
      key: "large",
      label: "large",
      depth: 0,
    });
    const scene = registry.project(state, { key: "state", label: "state", depth: 0 });

    expect(smallProjection).toMatchObject({ kind: "graph", vertices: [{}, {}] });
    expect(largeProjection).toMatchObject({ kind: "graph", vertices: [{}, {}, {}, {}] });
    expect(scene.kind).toBe("mapping");
    if (scene.kind === "mapping") {
      expect(scene.entries[1].value.kind).toBe("sequence");
    }
    const aliasProjection = registry.project(smallGraph, {
      key: "small-alias",
      label: "small-alias",
      depth: 0,
    });
    expect(aliasProjection).toMatchObject({ kind: "graph", key: "nested-small-graph" });
  });

  it("deduplicates aliases selected by each and preserves conflicting-contract errors", () => {
    const graph = adjacencyGraph("each-alias-graph", [[1], [0]]);
    const mapping: SerializedValue = {
      kind: "mapping",
      id: "each-alias-map",
      type: "dict",
      entries: [
        [stringScalar("primary"), graph],
        [stringScalar("alias"), { kind: "reference", targetId: graph.id, type: "list" }],
      ],
    };
    const eachContract: ProjectionContractsV1 = {
      version: 1,
      declarations: [{
        id: "all-values",
        target: {
          root: { kind: "binding", name: "graphs" },
          segments: [{ kind: "each" }],
        },
        configuration: {
          kind: "graph",
          representation: "adjacency-list",
          directed: false,
        },
      }],
    };
    const aliasContract = {
      id: "explicit-alias",
      target: {
        root: { kind: "binding" as const, name: "graphs" },
        segments: [{ kind: "mapKey" as const, key: stringScalar("alias") }],
      },
      configuration: {
        kind: "graph" as const,
        representation: "adjacency-list" as const,
        directed: true,
      },
    };
    const registry = new ProjectionRegistry([], eachContract, { graphs: mapping });

    expect(registry.project(graph, { key: "graph", label: "graph", depth: 0 }).kind)
      .toBe("graph");
    expect(registry.project(mapping.entries[1][1], {
      key: "alias",
      label: "alias",
      depth: 0,
    }).kind).toBe("graph");
    expect(() => new ProjectionRegistry([], {
      ...eachContract,
      declarations: [...eachContract.declarations, aliasContract],
    }, { graphs: mapping })).toThrow("resolve to identity 'each-alias-graph'");
  });

  it("treats scalar matches as invalid graphs and does not follow reference leaves", () => {
    const numbers: SerializedValue = {
      kind: "sequence",
      id: "scalar-children",
      type: "list",
      items: [scalar(1), scalar(2)],
    };
    const cycle: SerializedValue = {
      kind: "sequence",
      id: "cycle-root",
      type: "list",
      items: [{ kind: "reference", targetId: "cycle-root", type: "list" }],
    };
    const contracts: ProjectionContractsV1 = {
      version: 1,
      declarations: [{
        id: "scalar-children",
        target: {
          root: { kind: "binding", name: "numbers" },
          segments: [{ kind: "each" }],
        },
        configuration: {
          kind: "graph",
          representation: "adjacency-list",
          directed: false,
        },
      }, {
        id: "cycle-children",
        target: {
          root: { kind: "binding", name: "cycle" },
          segments: [{ kind: "each" }, { kind: "each" }],
        },
        configuration: {
          kind: "graph",
          representation: "adjacency-list",
          directed: false,
        },
      }, {
        id: "missing-child",
        target: {
          root: { kind: "binding", name: "cycle" },
          segments: [{ kind: "index", index: 5 }, { kind: "each" }],
        },
        configuration: {
          kind: "graph",
          representation: "adjacency-list",
          directed: true,
        },
      }],
    };
    const registry = new ProjectionRegistry([], contracts, { numbers, cycle });

    expect(registry.project(numbers.items[0], {
      key: "number",
      label: "number",
      depth: 0,
    })).toMatchObject({
      kind: "truncated",
      preview: "Invalid adjacency-list graph contract",
    });
    expect(registry.project(cycle, { key: "cycle", label: "cycle", depth: 0 }).kind)
      .toBe("sequence");
    expect(registry.project(cycle.items[0], {
      key: "cycle-ref",
      label: "cycle-ref",
      depth: 0,
    }).kind).toBe("reference");
  });

  it("retains contracted identities when a binding is rebound", () => {
    const first: SerializedValue = {
      kind: "sequence",
      id: "first-adjacency",
      type: "list",
      items: [row("first-neighbors-0", [1]), row("first-neighbors-1", [0])],
    };
    const second: SerializedValue = {
      kind: "sequence",
      id: "second-adjacency",
      type: "list",
      items: [row("second-neighbors-0", [1]), row("second-neighbors-1", [0])],
    };
    const contracts: ProjectionContractsV1 = {
      version: 1,
      declarations: [{
        id: "graph",
        target: { root: { kind: "binding", name: "graph" }, segments: [] },
        configuration: {
          kind: "graph",
          representation: "adjacency-list",
          directed: false,
        },
      }],
    };
    const registry = new ProjectionRegistry([], contracts, { graph: first });

    registry.observeBindings({ graph: second });

    expect(registry.project(first, { key: "old", label: "old", depth: 0 }).kind).toBe("graph");
    expect(registry.project(second, { key: "new", label: "new", depth: 0 }).kind).toBe("graph");
  });
});

describe("compileScene", () => {
  it("classifies a closed single-successor object chain as a cycle", () => {
    const first: SerializedValue = {
      kind: "object",
      id: "first",
      type: "ListNode",
      fields: {
        val: scalar(4),
        next: {
          kind: "object",
          id: "second",
          type: "ListNode",
          fields: {
            val: scalar(9),
            next: {
              kind: "reference",
              targetId: "first",
              type: "ListNode",
            },
          },
        },
      },
    };
    const frame: TraceFrame = {
      index: 0,
      event: "line",
      source: { line: 2 },
      functionName: "walk",
      scopeId: "walk:1",
      depth: 0,
      callStack: [],
      locals: { head: first },
      stdout: "",
      changes: [],
      semanticEvents: [],
    };

    expect(compileScene(frame).relationGraph).toMatchObject({
      layout: "cycle",
      entities: [{ id: "first" }, { id: "second" }],
      edges: [
        { sourceId: "first", targetId: "second", label: "next" },
        { sourceId: "second", targetId: "first", label: "next" },
      ],
    });
  });

  it("marks a variable changed when a nested path changed", () => {
    const frame: TraceFrame = {
      index: 4,
      event: "line",
      source: { line: 8 },
      functionName: "sort",
      scopeId: "sort:1",
      depth: 1,
      callStack: [],
      locals: {
        numbers: {
          kind: "sequence",
          id: "numbers",
          type: "list",
          items: [scalar(1), scalar(2)],
        },
      },
      stdout: "",
      changes: [{ kind: "updated", path: "numbers[1]", before: scalar(3), after: scalar(2) }],
      semanticEvents: [],
    };

    const scene = compileScene(
      frame,
      new ProjectionRegistry([], {
        version: 1,
        declarations: [{
          id: "graph",
          target: { root: { kind: "binding", name: "graph" }, segments: [] },
          configuration: {
            kind: "graph",
            representation: "adjacency-list",
            directed: false,
          },
        }],
      }, frame.locals),
    );
    expect(scene.variables[0]).toMatchObject({
      name: "numbers",
      changed: true,
      changeCount: 1,
    });
  });

  it("resolves semantic operand expressions to concrete sequence paths", () => {
    const frame: TraceFrame = {
      index: 5,
      event: "line",
      source: { line: 9 },
      functionName: "sort",
      scopeId: "sort:1",
      depth: 1,
      callStack: [],
      locals: {
        nums: {
          kind: "sequence",
          id: "numbers",
          type: "list",
          items: [scalar(3), scalar(2), scalar(1)],
        },
        index: scalar(1),
      },
      stdout: "",
      changes: [],
      semanticEvents: [
        {
          kind: "compare",
          source: { line: 9 },
          expression: "nums[index] > nums[index + 1]",
          operator: "Gt",
          operandExpressions: ["nums[index]", "nums[index + 1]"],
          operands: [scalar(2), scalar(1)],
          result: { kind: "scalar", type: "bool", value: true },
        },
      ],
    };

    expect(compileScene(frame).focusPaths).toEqual(["nums[1]", "nums[2]"]);
  });

  it("resolves primitive-operation operands to concrete sequence paths", () => {
    const frame: TraceFrame = {
      index: 5,
      event: "line",
      source: { line: 9 },
      functionName: "difference",
      scopeId: "difference:1",
      depth: 1,
      callStack: [],
      locals: {
        nums: {
          kind: "sequence",
          id: "numbers",
          type: "list",
          items: [scalar(8), scalar(3)],
        },
        index: scalar(0),
        difference: scalar(5),
      },
      stdout: "",
      changes: [],
      semanticEvents: [{
        kind: "operation",
        source: { line: 9 },
        expression: "nums[index] - nums[index + 1]",
        operator: "subtract",
        operatorToken: "-",
        operationCategory: "arithmetic",
        operandExpressions: ["nums[index]", "nums[index + 1]"],
        operands: [scalar(8), scalar(3)],
        result: scalar(5),
      }, {
        kind: "write",
        source: { line: 9 },
        expression: "difference = nums[index] - nums[index + 1]",
        target: "difference",
        result: scalar(5),
      }],
    };

    const scene = compileScene(frame);
    expect(scene.focusPaths).toEqual(["nums[0]", "nums[1]", "difference"]);
    expect(scene.operationMotion).toEqual({
      id: "9:nums[index] - nums[index + 1]:-:5",
      expression: "nums[index] - nums[index + 1]",
      operandTexts: ["8", "3"],
      sourcePaths: ["nums[0]", "nums[1]"],
      operatorToken: "-",
      resultText: "5",
      targetPath: "difference",
    });
  });

  it("does not animate literal-only iterator setup operations", () => {
    const scene = compileScene({
      index: 4,
      event: "line",
      source: { line: 2 },
      functionName: "bubble_sort",
      scopeId: "sort:1",
      depth: 0,
      callStack: [],
      locals: { end: scalar(4) },
      stdout: "",
      changes: [],
      semanticEvents: [
        {
          kind: "iteration",
          source: { line: 2 },
          expression: "for end in range(len(nums) - 1, 0, -1)",
          target: "end",
          iteratorExpression: "range(len(nums) - 1, 0, -1)",
          iterationIndex: 0,
          loopKind: "for",
          result: scalar(4),
        },
        {
          kind: "operation",
          source: { line: 2 },
          expression: "-1",
          operator: "negate",
          operatorToken: "-",
          operationCategory: "arithmetic",
          operandExpressions: ["1"],
          operands: [scalar(1)],
          result: scalar(-1),
        },
      ],
    });

    expect(scene.operationMotion).toBeUndefined();
  });

  it("attaches enumerate bindings to their sequence cells", () => {
    const frame: TraceFrame = {
      index: 6,
      event: "line",
      source: { line: 4 },
      functionName: "two_sum",
      scopeId: "two-sum:1",
      depth: 1,
      callStack: [],
      locals: {
        nums: {
          kind: "sequence",
          id: "numbers",
          type: "list",
          items: [scalar(2), scalar(7), scalar(11)],
        },
        index: scalar(2),
        value: scalar(11),
      },
      stdout: "",
      changes: [],
      semanticEvents: [{
        kind: "iteration",
        source: { line: 3 },
        expression: "for index, value in enumerate(nums)",
        target: "index, value",
        iteratorExpression: "enumerate(nums)",
        iterationIndex: 2,
        loopKind: "for",
        result: {
          kind: "sequence",
          id: "iteration-result",
          type: "tuple",
          items: [scalar(2), scalar(11)],
        },
      }],
    };

    expect(compileScene(frame).variableMarkers).toEqual([{
      id: "3:enumerate(nums):index",
      label: "index",
      path: "nums[2]",
    }]);
  });

  it("keeps nested row and column loop bindings visible together", () => {
    const frame: TraceFrame = {
      index: 7,
      event: "line",
      source: { line: 5 },
      functionName: "matrix_sum",
      scopeId: "matrix:1",
      depth: 1,
      callStack: [],
      locals: {
        grid: {
          kind: "sequence",
          id: "grid",
          type: "list",
          items: [row("row-a", [1, 2]), row("row-b", [3, 4])],
        },
        row: scalar(1),
        column: scalar(0),
      },
      stdout: "",
      changes: [],
      semanticEvents: [
        {
          kind: "iteration",
          source: { line: 3 },
          expression: "for row in range(len(grid))",
          target: "row",
          iteratorExpression: "range(len(grid))",
          iterationIndex: 1,
          loopKind: "for",
          result: scalar(1),
        },
        {
          kind: "iteration",
          source: { line: 4 },
          expression: "for column in range(len(grid[row]))",
          target: "column",
          iteratorExpression: "range(len(grid[row]))",
          iterationIndex: 0,
          loopKind: "for",
          result: scalar(0),
        },
      ],
    };

    expect(compileScene(frame).variableMarkers).toEqual([
      {
        id: "3:range(len(grid)):row",
        label: "row",
        path: "grid[1]",
      },
      {
        id: "4:range(len(grid[row])):column",
        label: "column",
        path: "grid[1][0]",
      },
    ]);
  });

  it("binds loop variables to every structure access they control", () => {
    const frame: TraceFrame = {
      index: 8,
      event: "line",
      source: { line: 5 },
      functionName: "bubble_sort",
      scopeId: "bubble:1",
      depth: 1,
      callStack: [],
      locals: {
        nums: {
          kind: "sequence",
          id: "numbers",
          type: "list",
          items: [scalar(1), scalar(4), scalar(3), scalar(2)],
        },
        end: scalar(3),
        index: scalar(1),
      },
      stdout: "",
      changes: [],
      semanticEvents: [{
        kind: "iteration",
        source: { line: 4 },
        expression: "for index in range(end)",
        target: "index",
        iteratorExpression: "range(end)",
        iterationIndex: 1,
        loopKind: "for",
        accessExpressions: ["nums[index]", "nums[index + 1]"],
        result: scalar(1),
      }],
    };

    expect(compileScene(frame).variableMarkers).toEqual([
      {
        id: "4:binding:index:0:nums[index]",
        label: "index",
        path: "nums[1]",
      },
      {
        id: "4:binding:index:0:nums[index + 1]",
        label: "index + 1",
        path: "nums[2]",
      },
    ]);
  });

  it("renders active bindings when the current debugger substep has no events", () => {
    const iteration: SemanticEvent = {
      kind: "iteration",
      source: { line: 4 },
      expression: "for index in range(end)",
      target: "index",
      iteratorExpression: "range(end)",
      iterationIndex: 1,
      loopKind: "for",
      accessExpressions: ["nums[index]", "nums[index + 1]"],
      result: scalar(1),
    };
    const frame: TraceFrame = {
      index: 9,
      event: "line",
      source: { line: 7 },
      functionName: "bubble_sort",
      scopeId: "bubble:1",
      depth: 1,
      callStack: [],
      locals: {
        nums: {
          kind: "sequence",
          id: "numbers",
          type: "list",
          items: [scalar(1), scalar(4), scalar(3), scalar(2)],
        },
        end: scalar(3),
        index: scalar(1),
      },
      stdout: "",
      changes: [],
      semanticEvents: [],
      activeVisualEvents: [iteration],
    };

    expect(compileScene(frame).variableMarkers.map(({ label, path }) => ({
      label,
      path,
    }))).toEqual([
      { label: "index", path: "nums[1]" },
      { label: "index + 1", path: "nums[2]" },
    ]);
  });

  it("binds scalar variables used by ordinary indexed reads", () => {
    const frame: TraceFrame = {
      index: 3,
      event: "line",
      source: { line: 2 },
      functionName: "lookup",
      scopeId: "lookup:1",
      depth: 1,
      callStack: [],
      locals: {
        values: {
          kind: "sequence",
          id: "values",
          type: "list",
          items: [scalar(5), scalar(8), scalar(13)],
        },
        selected: scalar(2),
      },
      stdout: "",
      changes: [],
      semanticEvents: [{
        kind: "read",
        source: { line: 2 },
        expression: "values[selected]",
        result: scalar(13),
      }],
    };

    expect(compileScene(frame).variableMarkers).toEqual([{
      id: "2:binding:selected:0:values[selected]",
      label: "selected",
      path: "values[2]",
    }]);
  });

  it("uses runtime keys for arbitrary computed index expressions", () => {
    const values: SerializedValue = {
      kind: "sequence",
      id: "values",
      type: "list",
      items: [scalar(5), scalar(8), scalar(13)],
    };
    const frame: TraceFrame = {
      index: 3,
      event: "line",
      source: { line: 2 },
      functionName: "lookup",
      scopeId: "lookup:1",
      depth: 1,
      callStack: [],
      locals: {
        values,
        selected: scalar(1),
      },
      stdout: "",
      changes: [],
      semanticEvents: [{
        kind: "read",
        source: { line: 2 },
        expression: "values[2 * selected]",
        accessVariables: ["selected"],
        accessContainer: {
          kind: "reference",
          targetId: "values",
          type: "list",
        },
        accessKey: scalar(2),
        result: scalar(13),
      }],
    };

    expect(compileScene(frame).variableMarkers).toEqual([{
      id: "2:runtime-binding:selected:values[2 * selected]",
      label: "2 * selected",
      path: "values[2]",
    }]);
  });

  it("projects active while-loop pointers onto their containers", () => {
    const frame: TraceFrame = {
      index: 8,
      event: "line",
      source: { line: 6 },
      functionName: "search",
      scopeId: "search:1",
      depth: 1,
      callStack: [],
      locals: {
        nums: {
          kind: "sequence",
          id: "numbers",
          type: "list",
          items: [scalar(1), scalar(3), scalar(5), scalar(7)],
        },
        left: scalar(1),
        right: scalar(3),
      },
      stdout: "",
      changes: [],
      semanticEvents: [{
        kind: "iteration",
        source: { line: 4 },
        expression: "left < right",
        target: "left < right",
        iteratorExpression: "left < right",
        iterationIndex: 2,
        loopKind: "while",
        accessExpressions: ["nums[left]", "nums[right]"],
      }],
    };

    expect(compileScene(frame).variableMarkers).toEqual([
      {
        id: "4:binding:left:0:nums[left]",
        label: "left",
        path: "nums[1]",
      },
      {
        id: "4:binding:right:0:nums[right]",
        label: "right",
        path: "nums[3]",
      },
    ]);
  });

  it("projects a function return value as first-class scene state", () => {
    const frame: TraceFrame = {
      index: 8,
      event: "return",
      source: { line: 10 },
      functionName: "bubble_sort",
      scopeId: "sort:1",
      depth: 1,
      callStack: [
        { functionName: "solve", scopeId: "solve:1", line: 4 },
        { functionName: "bubble_sort", scopeId: "sort:1", line: 10 },
      ],
      locals: {},
      stdout: "",
      changes: [],
      semanticEvents: [],
      returnValue: {
        kind: "sequence",
        id: "numbers",
        type: "list",
        items: [scalar(1), scalar(2), scalar(3)],
      },
    };

    const returned = compileScene(frame).variables.find(
      (variable) => variable.name === "$return",
    );
    expect(returned).toMatchObject({
      changed: true,
      changeCount: 1,
      projection: { kind: "sequence", type: "list" },
    });
    expect(compileScene(frame).callStack.map((entry) => entry.functionName)).toEqual([
      "solve",
      "bubble_sort",
    ]);
  });

  it("binds returned relation entities to the $return label", () => {
    const returnedNode: SerializedValue = {
      kind: "object",
      id: "node:3",
      type: "ListNode",
      fields: {
        val: scalar(3),
        next: { kind: "scalar", type: "NoneType", value: null },
      },
    };
    const scene = compileScene({
      index: 9,
      event: "return",
      source: { line: 12 },
      functionName: "reverse",
      scopeId: "reverse:1",
      depth: 0,
      callStack: [],
      locals: { previous: returnedNode },
      stdout: "",
      changes: [],
      semanticEvents: [],
      returnValue: returnedNode,
    });

    expect(scene.entityBindings).toEqual(expect.arrayContaining([
      { entityId: "node:3", label: "previous" },
      { entityId: "node:3", label: "$return" },
    ]));
  });

  it("links read and call producers to writes while pairing swaps", () => {
    const frame: TraceFrame = {
      index: 6,
      event: "line",
      source: { line: 7 },
      functionName: "solve",
      scopeId: "solve:1",
      depth: 1,
      callStack: [],
      locals: {
        nums: {
          kind: "sequence",
          id: "numbers",
          type: "list",
          items: [scalar(3), scalar(1), scalar(2)],
        },
        index: scalar(0),
        value: scalar(3),
        result: scalar(6),
      },
      stdout: "",
      changes: [],
      semanticEvents: [
        {
          kind: "read",
          source: { line: 5 },
          expression: "nums[index]",
          result: scalar(3),
        },
        {
          kind: "write",
          source: { line: 5 },
          expression: "value = nums[index]",
          target: "value",
          result: scalar(3),
        },
        {
          kind: "call",
          source: { line: 6 },
          expression: "double(value)",
          callee: "double",
          argumentExpressions: ["value"],
          arguments: [scalar(3)],
          result: scalar(6),
        },
        {
          kind: "write",
          source: { line: 6 },
          expression: "result = double(value)",
          target: "result",
          result: scalar(6),
        },
        {
          kind: "read",
          source: { line: 7 },
          expression: "nums[index + 1]",
          result: scalar(1),
        },
        {
          kind: "read",
          source: { line: 7 },
          expression: "nums[index]",
          result: scalar(3),
        },
        {
          kind: "swap",
          source: { line: 7 },
          expression:
            "nums[index], nums[index + 1] = nums[index + 1], nums[index]",
          target: "nums[index], nums[index + 1]",
        },
      ],
    };

    expect(compileScene(frame).causalLinks).toEqual([
      {
        source: "nums[0]",
        target: "value",
        sourceKind: "value",
        sourceLocationId: "index:numbers:0",
        targetLocationId: "binding:solve:1:value",
      },
      {
        source: "value",
        target: "result",
        sourceKind: "value",
        sourceLocationId: "binding:solve:1:value",
        targetLocationId: "binding:solve:1:result",
      },
      {
        source: "double(value)",
        target: "result",
        sourceKind: "call",
        targetLocationId: "binding:solve:1:result",
      },
      {
        source: "nums[1]",
        target: "nums[0]",
        sourceKind: "value",
        sourceLocationId: "index:numbers:1",
        targetLocationId: "index:numbers:0",
      },
      {
        source: "nums[0]",
        target: "nums[1]",
        sourceKind: "value",
        sourceLocationId: "index:numbers:0",
        targetLocationId: "index:numbers:1",
      },
    ]);
  });

  it("links mutating calls to caller-visible structural changes", () => {
    const frame: TraceFrame = {
      index: 7,
      event: "line",
      source: { line: 8 },
      functionName: "collect",
      scopeId: "collect:1",
      depth: 1,
      callStack: [],
      locals: {
        nums: {
          kind: "sequence",
          id: "numbers",
          type: "list",
          items: [scalar(4)],
        },
        output: {
          kind: "sequence",
          id: "output",
          type: "list",
          items: [scalar(4)],
        },
      },
      stdout: "",
      changes: [
        {
          kind: "created",
          path: "output[0]",
          after: scalar(4),
        },
      ],
      semanticEvents: [
        {
          kind: "read",
          source: { line: 7 },
          expression: "nums[0]",
          result: scalar(4),
        },
        {
          kind: "call",
          source: { line: 7 },
          expression: "output.append(nums[0])",
          callee: "output.append",
          argumentExpressions: ["nums[0]"],
          arguments: [scalar(4)],
          result: { kind: "scalar", type: "NoneType", value: null },
        },
      ],
    };

    expect(compileScene(frame).causalLinks).toEqual([
      {
        source: "nums[0]",
        target: "output[0]",
        sourceKind: "value",
        sourceLocationId: "index:numbers:0",
        targetLocationId: "index:output:0",
      },
      {
        source: "output.append(nums[0])",
        target: "output[0]",
        sourceKind: "call",
        targetLocationId: "index:output:0",
      },
    ]);
  });

  it("resolves mapping keys to canonical focus paths and readable flow labels", () => {
    const frame: TraceFrame = {
      index: 8,
      event: "line",
      source: { line: 6 },
      functionName: "count",
      scopeId: "count:1",
      depth: 1,
      callStack: [],
      locals: {
        counts: {
          kind: "mapping",
          id: "counts",
          type: "dict",
          entries: [
            [stringScalar("a"), scalar(2)],
            [stringScalar("b"), scalar(1)],
          ],
        },
        word: stringScalar("a"),
        result: scalar(2),
      },
      stdout: "",
      changes: [],
      semanticEvents: [
        {
          kind: "read",
          source: { line: 5 },
          expression: "counts[word]",
          result: scalar(2),
        },
        {
          kind: "write",
          source: { line: 5 },
          expression: "result = counts[word]",
          target: "result",
          result: scalar(2),
        },
      ],
    };

    const scene = compileScene(
      frame,
      new ProjectionRegistry([], {
        version: 1,
        declarations: [{
          id: "graph",
          target: { root: { kind: "binding", name: "graph" }, segments: [] },
          configuration: {
            kind: "graph",
            representation: "adjacency-list",
            directed: false,
          },
        }],
      }, frame.locals),
    );
    expect(scene.focusPaths).toContain("counts{0}.value");
    expect(scene.causalLinks).toEqual([
      {
        source: "counts{0}.value",
        sourceLabel: 'counts["a"]',
        sourceKind: "value",
        sourceLocationId: "expression:count:1:counts{0}.value",
        target: "result",
        targetLabel: undefined,
        targetLocationId: "binding:count:1:result",
      },
    ]);
  });

  it("focuses the memo row selected by a cached call argument", () => {
    const frame: TraceFrame = {
      index: 9,
      event: "line",
      source: { line: 6 },
      functionName: "solve",
      scopeId: "solve:1",
      depth: 1,
      callStack: [],
      locals: {
        "solve.memo": {
          kind: "mapping",
          id: "memo",
          type: "dict",
          entries: [
            [scalar(3), scalar(7)],
            [scalar(2), scalar(10)],
          ],
        },
      },
      stdout: "",
      changes: [],
      semanticEvents: [{
        kind: "memo",
        source: { line: 6 },
        expression: "solve(index + 1)",
        callee: "solve",
        cacheHit: true,
        argumentExpressions: ["index + 1"],
        arguments: [scalar(2)],
        result: scalar(10),
      }],
    };

    expect(compileScene(frame).focusPaths).toEqual([
      "solve.memo{1}.key",
      "solve.memo{1}.value",
    ]);
  });

  it("continues resolving sequence access inside a mapping value", () => {
    const frame: TraceFrame = {
      index: 9,
      event: "line",
      source: { line: 4 },
      functionName: "visit",
      scopeId: "visit:1",
      depth: 1,
      callStack: [],
      locals: {
        graph: {
          kind: "mapping",
          id: "graph",
          type: "dict",
          entries: [
            [
              scalar(0),
              {
                kind: "sequence",
                id: "neighbors",
                type: "list",
                items: [scalar(1), scalar(2)],
              },
            ],
          ],
        },
        node: scalar(0),
        neighbor: scalar(2),
      },
      stdout: "",
      changes: [],
      semanticEvents: [
        {
          kind: "read",
          source: { line: 3 },
          expression: "graph[node]",
          result: {
            kind: "sequence",
            id: "neighbors",
            type: "list",
            items: [scalar(1), scalar(2)],
          },
        },
        {
          kind: "read",
          source: { line: 3 },
          expression: "graph[node][1]",
          result: scalar(2),
        },
        {
          kind: "write",
          source: { line: 3 },
          expression: "neighbor = graph[node][1]",
          target: "neighbor",
          result: scalar(2),
        },
      ],
    };

    const scene = compileScene(frame);
    expect(scene.focusPaths).toEqual([
      "graph{0}.value",
      "graph{0}.value[1]",
      "neighbor",
    ]);
    expect(scene.causalLinks).toEqual([
      {
        source: "graph{0}.value[1]",
        sourceLabel: "graph[0][1]",
        sourceKind: "value",
        sourceLocationId: "expression:visit:1:graph{0}.value[1]",
        target: "neighbor",
        targetLabel: undefined,
        targetLocationId: "binding:visit:1:neighbor",
      },
    ]);
  });

  it("links unmatched reads to same-frame diffs for complex in-place updates", () => {
    const frame: TraceFrame = {
      index: 10,
      event: "line",
      source: { line: 5 },
      functionName: "sum_grid",
      scopeId: "sum:1",
      depth: 1,
      callStack: [],
      locals: {
        grid: {
          kind: "sequence",
          id: "grid",
          type: "list",
          items: [row("row-a", [4])],
        },
        total: scalar(4),
      },
      stdout: "",
      changes: [
        {
          kind: "updated",
          path: "total",
          before: scalar(0),
          after: scalar(4),
        },
      ],
      semanticEvents: [
        {
          kind: "read",
          source: { line: 4 },
          expression: "grid[0][0]",
          result: scalar(4),
        },
      ],
    };

    expect(compileScene(frame).causalLinks).toEqual([
      {
        source: "grid[0][0]",
        target: "total",
        sourceKind: "value",
        sourceLocationId: "index:row-a:0",
        targetLocationId: "binding:sum:1:total",
      },
    ]);
  });

  it("focuses graph vertices that match active operation values", () => {
    const frame: TraceFrame = {
      index: 11,
      event: "line",
      source: { line: 8 },
      functionName: "walk",
      scopeId: "walk:1",
      depth: 1,
      callStack: [],
      locals: {
        graph: {
          kind: "sequence",
          id: "adjacency",
          type: "list",
          items: [
            row("neighbors-0", [1, 2]),
            row("neighbors-1", [0]),
            row("neighbors-2", [0]),
          ],
        },
        neighbor: scalar(2),
        visited: {
          kind: "set",
          id: "visited",
          type: "set",
          items: [scalar(0), scalar(2)],
        },
      },
      stdout: "",
      changes: [],
      semanticEvents: [{
        kind: "call",
        source: { line: 8 },
        expression: "visited.add(neighbor)",
        callee: "visited.add",
        argumentExpressions: ["neighbor"],
        arguments: [scalar(2)],
        result: { kind: "scalar", type: "NoneType", value: null },
      }],
    };

    const scene = compileScene(
      frame,
      new ProjectionRegistry([], {
        version: 1,
        declarations: [{
          id: "graph",
          target: { root: { kind: "binding", name: "graph" }, segments: [] },
          configuration: {
            kind: "graph",
            representation: "adjacency-list",
            directed: false,
          },
        }],
      }, frame.locals),
    );
    expect(scene.focusedGraphVertexIds).toEqual([
      "adjacency:vertex:2",
    ]);
    expect(scene.graphMemberships).toEqual([{
      graphKey: "adjacency",
      variableName: "visited",
      vertexIds: ["adjacency:vertex:0", "adjacency:vertex:2"],
    }]);
  });

  it("scopes graph access focus to the graph that was read", () => {
    const graphA: SerializedValue = {
      kind: "sequence",
      id: "graph-a",
      type: "list",
      items: [row("graph-a-row-0", [1]), row("graph-a-row-1", [0])],
    };
    const graphB: SerializedValue = {
      kind: "sequence",
      id: "graph-b",
      type: "list",
      items: [row("graph-b-row-0", [1]), row("graph-b-row-1", [0])],
    };
    const frame: TraceFrame = {
      index: 12,
      event: "line",
      source: { line: 9 },
      functionName: "walk",
      scopeId: "walk:2",
      depth: 1,
      callStack: [],
      locals: { graphA, graphB, node: scalar(0) },
      stdout: "",
      changes: [],
      semanticEvents: [{
        kind: "read",
        source: { line: 9 },
        expression: "graphA[node]",
        argumentExpressions: ["node"],
        arguments: [scalar(0)],
        result: graphA.items[0],
      }],
    };
    const contracts: ProjectionContractsV1 = {
      version: 1,
      declarations: ["graphA", "graphB"].map((name) => ({
        id: name,
        target: { root: { kind: "binding" as const, name }, segments: [] },
        configuration: {
          kind: "graph" as const,
          representation: "adjacency-list" as const,
          directed: false,
        },
      })),
    };

    const scene = compileScene(
      frame,
      new ProjectionRegistry([], contracts, frame.locals),
    );

    expect(scene.focusedGraphVertexIds).toEqual(["graph-a:vertex:0"]);
  });

  it("does not guess graph focus for an unscoped scalar with multiple graphs", () => {
    const graphA: SerializedValue = {
      kind: "sequence",
      id: "graph-a",
      type: "list",
      items: [row("graph-a-row-0", [1]), row("graph-a-row-1", [0])],
    };
    const graphB: SerializedValue = {
      kind: "sequence",
      id: "graph-b",
      type: "list",
      items: [row("graph-b-row-0", [1]), row("graph-b-row-1", [0])],
    };
    const frame: TraceFrame = {
      index: 13,
      event: "line",
      source: { line: 10 },
      functionName: "walk",
      scopeId: "walk:3",
      depth: 1,
      callStack: [],
      locals: { graphA, graphB, neighbor: scalar(1) },
      stdout: "",
      changes: [],
      semanticEvents: [{
        kind: "call",
        source: { line: 10 },
        expression: "visited.add(neighbor)",
        callee: "visited.add",
        argumentExpressions: ["neighbor"],
        arguments: [scalar(1)],
        result: scalar(null),
      }],
    };
    const contracts: ProjectionContractsV1 = {
      version: 1,
      declarations: ["graphA", "graphB"].map((name) => ({
        id: name,
        target: { root: { kind: "binding" as const, name }, segments: [] },
        configuration: {
          kind: "graph" as const,
          representation: "adjacency-list" as const,
          directed: false,
        },
      })),
    };

    const scene = compileScene(
      frame,
      new ProjectionRegistry([], contracts, frame.locals),
    );

    expect(scene.focusedGraphVertexIds).toEqual([]);
  });

  it("keeps the single-graph fallback when multiple bindings alias it", () => {
    const graph: SerializedValue = {
      kind: "sequence",
      id: "aliased-graph",
      type: "list",
      items: [row("aliased-row-0", [1]), row("aliased-row-1", [0])],
    };
    const frame: TraceFrame = {
      index: 14,
      event: "line",
      source: { line: 11 },
      functionName: "walk",
      scopeId: "walk:4",
      depth: 1,
      callStack: [],
      locals: { graph, graphAlias: graph, neighbor: scalar(1) },
      stdout: "",
      changes: [],
      semanticEvents: [{
        kind: "call",
        source: { line: 11 },
        expression: "visited.add(neighbor)",
        callee: "visited.add",
        argumentExpressions: ["neighbor"],
        arguments: [scalar(1)],
        result: scalar(null),
      }],
    };
    const contracts: ProjectionContractsV1 = {
      version: 1,
      declarations: ["graph", "graphAlias"].map((name) => ({
        id: name,
        target: { root: { kind: "binding" as const, name }, segments: [] },
        configuration: {
          kind: "graph" as const,
          representation: "adjacency-list" as const,
          directed: false,
        },
      })),
    };

    const scene = compileScene(
      frame,
      new ProjectionRegistry([], contracts, frame.locals),
    );

    expect(scene.focusedGraphVertexIds).toEqual(["aliased-graph:vertex:1"]);
  });

  it("derives an identity graph from nested object references", () => {
    const tail: SerializedValue = {
      kind: "object",
      id: "node:2",
      type: "Node",
      fields: {
        value: scalar(2),
        next: { kind: "scalar", type: "NoneType", value: null },
      },
    };
    const head: SerializedValue = {
      kind: "object",
      id: "node:1",
      type: "Node",
      fields: {
        value: scalar(1),
        next: tail,
      },
    };
    const frame: TraceFrame = {
      index: 0,
      event: "line",
      source: { line: 4 },
      functionName: "<module>",
      scopeId: "module",
      depth: 0,
      callStack: [],
      locals: {
        head,
        current: { kind: "reference", targetId: "node:2", type: "Node" },
      },
      stdout: "",
      changes: [],
      semanticEvents: [
        {
          kind: "read",
          source: { line: 4 },
          expression: "head.next",
          result: tail,
        },
      ],
    };

    const scene = compileScene(frame);
    const graph = scene.relationGraph;
    expect(graph?.roots).toEqual(["node:1"]);
    expect(graph?.entities.map((entity) => entity.label)).toEqual(["1", "2"]);
    expect(graph?.edges).toContainEqual({
      sourceId: "node:1",
      targetId: "node:2",
      label: "next",
    });
    expect(scene.focusPaths).toEqual(["head.next"]);
    expect(scene.focusedEntityIds).toEqual(["node:1", "node:2"]);
    expect(scene.focusedRelationKeys).toEqual(["node:1:next:node:2"]);
    expect(scene.entityBindings).toEqual([
      { entityId: "node:1", label: "head" },
      { entityId: "node:2", label: "current" },
    ]);
  });

  it("preserves the complete identity tree while recursion is inside a leaf", () => {
    const leaf = (id: string, value: number): SerializedValue => ({
      kind: "object",
      id,
      type: "TreeNode",
      fields: {
        val: scalar(value),
        left: { kind: "scalar", type: "NoneType", value: null },
        right: { kind: "scalar", type: "NoneType", value: null },
      },
    });
    const left = leaf("node:2", 2);
    const right = leaf("node:3", 3);
    const tree: SerializedValue = {
      kind: "object",
      id: "node:1",
      type: "TreeNode",
      fields: {
        val: scalar(1),
        left,
        right,
      },
    };
    const solution: SerializedValue = {
      kind: "object",
      id: "solution",
      type: "Solution",
      fields: {},
    };
    const frame: TraceFrame = {
      index: 20,
      event: "return",
      source: { line: 15 },
      functionName: "invertTree",
      scopeId: "leaf-scope",
      depth: 2,
      callStack: [
        { functionName: "invertTree", scopeId: "root-scope", line: 13 },
        { functionName: "invertTree", scopeId: "leaf-scope", line: 15 },
      ],
      ancestorScopes: [{
        functionName: "invertTree",
        scopeId: "root-scope",
        line: 13,
        locals: { self: solution, root: tree },
      }],
      locals: { self: solution, root: left },
      returnValue: left,
      stdout: "",
      changes: [],
      semanticEvents: [],
    };

    const scene = compileScene(frame);
    expect(scene.relationGraph).toMatchObject({
      layout: "tree",
      roots: ["node:1"],
      edges: [
        { sourceId: "node:1", targetId: "node:2", label: "left" },
        { sourceId: "node:1", targetId: "node:3", label: "right" },
      ],
    });
    expect(scene.relationGraph?.entities.map(({ id }) => id)).toEqual([
      "node:1",
      "node:2",
      "node:3",
    ]);
    expect(scene.relationGraph?.entities.some(({ id }) => id === "solution"))
      .toBe(false);
  });

  it("omits an isolated empty receiver from the relation graph", () => {
    const frame: TraceFrame = {
      index: 21,
      event: "line",
      source: { line: 4 },
      functionName: "solve",
      scopeId: "solve:1",
      depth: 1,
      callStack: [],
      locals: {
        self: {
          kind: "object",
          id: "solution",
          type: "Solution",
          fields: {},
        },
        values: {
          kind: "sequence",
          id: "values",
          type: "list",
          items: [scalar(1), scalar(2)],
        },
      },
      stdout: "",
      changes: [],
      semanticEvents: [],
    };

    expect(compileScene(frame).relationGraph).toBeUndefined();
  });

  it("does not animate a computed write as a structural transfer", () => {
    const frame: TraceFrame = {
      index: 22,
      event: "line",
      source: { line: 3 },
      functionName: "solve",
      scopeId: "solve:1",
      depth: 0,
      callStack: [],
      locals: {
        nums: {
          kind: "sequence",
          id: "nums",
          type: "list",
          items: [scalar(0), scalar(4)],
        },
        out: {
          kind: "sequence",
          id: "out",
          type: "list",
          items: [scalar(5)],
        },
      },
      stdout: "",
      changes: [],
      semanticEvents: [
        {
          kind: "read",
          source: { line: 3 },
          expression: "nums[1]",
        },
        {
          kind: "operation",
          source: { line: 3 },
          expression: "nums[1] + 1",
          operator: "add",
          operatorToken: "+",
          operationCategory: "arithmetic",
          operandExpressions: ["nums[1]", "1"],
          operands: [scalar(4), scalar(1)],
          result: scalar(5),
        },
        {
          kind: "write",
          source: { line: 3 },
          expression: "out[0] = nums[1] + 1",
          target: "out[0]",
          result: scalar(5),
        },
      ],
    };

    const scene = compileScene(frame);
    expect(scene.causalLinks).toEqual([]);
    expect(scene.motionPlan.motions).toEqual([]);
  });

  it("projects scalar recursive calls as a stable call chain", () => {
    const recursiveScopes = [5, 4, 3, 2].map((number, index) => ({
      functionName: "factorial",
      scopeId: `factorial:${index + 1}`,
      line: 4,
      locals: { number: scalar(number) },
    }));
    const frame: TraceFrame = {
      index: 23,
      event: "return",
      source: { line: 3 },
      functionName: "factorial",
      scopeId: "factorial:5",
      depth: 4,
      callStack: [
        ...recursiveScopes.map(({ functionName, scopeId, line }) => ({
          functionName,
          scopeId,
          line,
        })),
        { functionName: "factorial", scopeId: "factorial:5", line: 3 },
      ],
      ancestorScopes: recursiveScopes,
      locals: { number: scalar(1) },
      returnValue: scalar(1),
      stdout: "",
      changes: [],
      semanticEvents: [],
    };

    expect(compileScene(frame).recursion).toEqual({
      frames: [
        {
          scopeId: "factorial:1",
          functionName: "factorial",
          line: 4,
          bindings: [{ name: "number", value: "5" }],
        },
        {
          scopeId: "factorial:2",
          functionName: "factorial",
          line: 4,
          bindings: [{ name: "number", value: "4" }],
        },
        {
          scopeId: "factorial:3",
          functionName: "factorial",
          line: 4,
          bindings: [{ name: "number", value: "3" }],
        },
        {
          scopeId: "factorial:4",
          functionName: "factorial",
          line: 4,
          bindings: [{ name: "number", value: "2" }],
        },
        {
          scopeId: "factorial:5",
          functionName: "factorial",
          line: 3,
          bindings: [{ name: "number", value: "1" }],
          returnValue: "1",
        },
      ],
    });
  });

  it("projects mutual recursion from generic call activations", () => {
    const frame: TraceFrame = {
      index: 24,
      event: "line",
      source: { line: 6 },
      functionName: "is_even",
      scopeId: "even:2",
      depth: 2,
      callStack: [
        {
          functionName: "is_even",
          scopeId: "even:1",
          line: 3,
          parameters: ["n"],
        },
        {
          functionName: "is_odd",
          scopeId: "odd:1",
          line: 6,
          parameters: ["n"],
        },
        {
          functionName: "is_even",
          scopeId: "even:2",
          line: 6,
          parameters: ["n"],
        },
      ],
      ancestorScopes: [
        {
          functionName: "is_even",
          scopeId: "even:1",
          line: 3,
          parameters: ["n"],
          locals: { n: scalar(4) },
        },
        {
          functionName: "is_odd",
          scopeId: "odd:1",
          line: 6,
          parameters: ["n"],
          locals: { n: scalar(3) },
        },
      ],
      locals: { n: scalar(2) },
      stdout: "",
      changes: [],
      semanticEvents: [],
    };

    expect(compileScene(frame).callFlow).toMatchObject({
      recursive: true,
      frames: [
        {
          activationId: "even:1",
          functionName: "is_even",
          bindings: [{ name: "n", value: "4", kind: "scalar" }],
        },
        {
          activationId: "odd:1",
          parentActivationId: "even:1",
          functionName: "is_odd",
          bindings: [{ name: "n", value: "3", kind: "scalar" }],
        },
        {
          activationId: "even:2",
          parentActivationId: "odd:1",
          functionName: "is_even",
          bindings: [{ name: "n", value: "2", kind: "scalar" }],
        },
      ],
    });
  });

  it("summarizes object parameters in ordinary nested calls", () => {
    const node: SerializedValue = {
      kind: "object",
      id: "node:7",
      type: "TreeNode",
      fields: { val: scalar(7) },
    };
    const frame: TraceFrame = {
      index: 25,
      event: "line",
      source: { line: 8 },
      functionName: "visit",
      scopeId: "visit:1",
      depth: 1,
      callStack: [
        {
          functionName: "solve",
          scopeId: "solve:1",
          line: 4,
          parameters: ["root"],
        },
        {
          functionName: "visit",
          scopeId: "visit:1",
          line: 8,
          parameters: ["node"],
        },
      ],
      ancestorScopes: [{
        functionName: "solve",
        scopeId: "solve:1",
        line: 4,
        parameters: ["root"],
        locals: { root: node },
      }],
      locals: { node },
      stdout: "",
      changes: [],
      semanticEvents: [],
    };

    const scene = compileScene(frame);
    expect(scene.callFlow).toMatchObject({
      recursive: false,
      frames: [
        { bindings: [{ name: "root", value: "TreeNode(7)", kind: "object" }] },
        { bindings: [{ name: "node", value: "TreeNode(7)", kind: "object" }] },
      ],
    });
    expect(scene.recursion).toBeUndefined();
  });

  it("keeps adjacency-shaped matrices structural without a contract", () => {
    const row = (id: string, values: number[]): SerializedValue => ({
      kind: "sequence",
      id,
      type: "list",
      items: values.map(scalar),
    });
    const frame: TraceFrame = {
      index: 26,
      event: "line",
      source: { line: 1 },
      functionName: "solve",
      scopeId: "solve:1",
      depth: 0,
      callStack: [],
      locals: {
        matrix: {
          kind: "sequence",
          id: "matrix",
          type: "list",
          items: [
            row("row:0", [0, 1]),
            row("row:1", [1, 0]),
          ],
        },
      },
      stdout: "",
      changes: [],
      semanticEvents: [],
    };

    const [matrix] = compileScene(frame).variables;
    expect(matrix.projection.kind).toBe("grid");
    expect(matrix.graphFacet).toBeUndefined();
  });

  it("discovers identity relations nested inside containers", () => {
    const tail: SerializedValue = {
      kind: "object",
      id: "node:2",
      type: "Node",
      fields: { value: scalar(2) },
    };
    const head: SerializedValue = {
      kind: "object",
      id: "node:1",
      type: "Node",
      fields: {
        value: scalar(1),
        next: { kind: "reference", targetId: "node:2", type: "Node" },
      },
    };
    const frame: TraceFrame = {
      index: 27,
      event: "line",
      source: { line: 1 },
      functionName: "solve",
      scopeId: "solve:1",
      depth: 0,
      callStack: [],
      locals: {
        nodes: {
          kind: "sequence",
          id: "nodes",
          type: "list",
          items: [head, tail],
        },
      },
      stdout: "",
      changes: [],
      semanticEvents: [],
    };

    expect(compileScene(frame).relationGraph).toMatchObject({
      layout: "tree",
      roots: ["node:1"],
      entities: [{ id: "node:1" }, { id: "node:2" }],
      edges: [{ sourceId: "node:1", targetId: "node:2", label: "next" }],
    });
  });
});
