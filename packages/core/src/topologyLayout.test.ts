import { describe, expect, it } from "vitest";
import type {
  GraphProjection,
  GraphVertexProjection,
  RelationGraph,
} from "./scene";
import {
  layoutRelationGraph,
  TopologyLayoutRegistry,
} from "./topologyLayout";

function vertex(index: number): GraphVertexProjection {
  return {
    id: `vertex-${index}`,
    label: String(index),
    value: {
      kind: "scalar",
      key: `value-${index}`,
      label: String(index),
      type: "int",
      value: String(index),
    },
    adjacency: {
      kind: "sequence",
      key: `neighbors-${index}`,
      label: `Neighbors of ${index}`,
      type: "list",
      items: [],
    },
  };
}

describe("TopologyLayoutRegistry", () => {
  it("places tree children below their root", () => {
    const graph: GraphProjection = {
      kind: "graph",
      key: "tree",
      label: "tree",
      type: "list",
      layout: "tree",
      rootId: "vertex-0",
      directed: true,
      vertices: [vertex(0), vertex(1), vertex(2)],
      edges: [
        { id: "0-1", sourceId: "vertex-0", targetId: "vertex-1" },
        { id: "0-2", sourceId: "vertex-0", targetId: "vertex-2" },
      ],
    };

    const layout = new TopologyLayoutRegistry().layout(graph);
    const positions = new Map(
      layout.positioned.map((item) => [item.vertex.id, item]),
    );
    expect(positions.get("vertex-1")!.y).toBeGreaterThan(
      positions.get("vertex-0")!.y,
    );
    expect(positions.get("vertex-1")!.x).not.toBe(
      positions.get("vertex-2")!.x,
    );
  });

  it("is deterministic and keeps dense networks collision-free", () => {
    const vertices = Array.from({ length: 10 }, (_, index) => vertex(index));
    const graph: GraphProjection = {
      kind: "graph",
      key: "network",
      label: "network",
      type: "list",
      layout: "network",
      directed: false,
      vertices,
      edges: vertices.map((_, index) => ({
        id: `edge-${index}`,
        sourceId: `vertex-${index}`,
        targetId: `vertex-${(index + 1) % vertices.length}`,
      })),
    };
    const registry = new TopologyLayoutRegistry();

    const first = registry.layout(graph);
    expect(registry.layout(graph)).toEqual(first);
    expect(new Set(first.positioned.map(({ x, y }) => `${x}:${y}`)).size)
      .toBe(vertices.length);
    for (const [index, current] of first.positioned.entries()) {
      for (const other of first.positioned.slice(index + 1)) {
        expect(Math.hypot(current.x - other.x, current.y - other.y))
          .toBeGreaterThanOrEqual(70);
      }
    }
  });

  it("keeps every small-network vertex at a distinct coordinate", () => {
    const graph: GraphProjection = {
      kind: "graph",
      key: "network",
      label: "network",
      type: "list",
      layout: "network",
      directed: true,
      vertices: [vertex(0), vertex(1), vertex(2)],
      edges: [
        { id: "0-1", sourceId: "vertex-0", targetId: "vertex-1" },
        { id: "1-0", sourceId: "vertex-1", targetId: "vertex-0" },
        { id: "2-0", sourceId: "vertex-2", targetId: "vertex-0" },
      ],
    };

    const positions = new TopologyLayoutRegistry()
      .layout(graph)
      .positioned
      .map(({ x, y }) => `${x}:${y}`);
    expect(new Set(positions).size).toBe(graph.vertices.length);
  });

  it("expands dense tree layers without overlapping nodes", () => {
    const children = Array.from({ length: 12 }, (_, index) => vertex(index + 1));
    const graph: GraphProjection = {
      kind: "graph",
      key: "wide-tree",
      label: "wide tree",
      type: "list",
      layout: "tree",
      rootId: "vertex-0",
      directed: true,
      vertices: [vertex(0), ...children],
      edges: children.map((child) => ({
        id: `root-${child.id}`,
        sourceId: "vertex-0",
        targetId: child.id,
      })),
    };

    const layout = new TopologyLayoutRegistry().layout(graph);
    const childPositions = layout.positioned.filter(
      ({ vertex: item }) => item.id !== "vertex-0",
    );
    expect(layout.width).toBeGreaterThan(520);
    for (const [index, current] of childPositions.entries()) {
      for (const other of childPositions.slice(index + 1)) {
        expect(Math.abs(current.x - other.x)).toBeGreaterThanOrEqual(76);
      }
    }
  });

  it("keeps dense relation networks collision-free", () => {
    const graph: RelationGraph = {
      layout: "network",
      roots: [],
      edges: [],
      entities: Array.from({ length: 14 }, (_, index) => ({
        id: `entity-${index}`,
        label: String(index),
        type: "Node",
        projection: {
          kind: "object",
          key: `entity-${index}`,
          label: String(index),
          type: "Node",
          fields: [],
        },
      })),
    };
    const layout = layoutRelationGraph(graph);
    const minimum = 52 + 70 * 0.45;
    for (const [index, current] of layout.positioned.entries()) {
      for (const other of layout.positioned.slice(index + 1)) {
        expect(Math.hypot(current.x - other.x, current.y - other.y))
          .toBeGreaterThanOrEqual(minimum - 0.001);
      }
    }
  });

  it("places a two-entity cycle across a horizontal diameter", () => {
    const graph: RelationGraph = {
      layout: "cycle",
      roots: ["entity-0"],
      edges: [
        { sourceId: "entity-0", targetId: "entity-1", label: "next" },
        { sourceId: "entity-1", targetId: "entity-0", label: "next" },
      ],
      entities: Array.from({ length: 2 }, (_, index) => ({
        id: `entity-${index}`,
        label: String(index),
        type: "Node",
        projection: {
          kind: "object",
          key: `entity-${index}`,
          label: String(index),
          type: "Node",
          fields: [],
        },
      })),
    };

    const [first, second] = layoutRelationGraph(graph).positioned;
    expect(first.y).toBeCloseTo(second.y);
    expect(Math.abs(first.x - second.x)).toBeGreaterThan(100);
  });
});
