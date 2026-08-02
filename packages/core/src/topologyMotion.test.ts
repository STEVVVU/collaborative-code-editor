import { describe, expect, it } from "vitest";
import {
  compileTopologyTransition,
  sampleTopologyTransition,
  settledTopology,
  type TopologySnapshot,
} from "./topologyMotion";

interface NodeData {
  label: string;
}

interface EdgeData {
  label: string;
}

function snapshot(
  nodes: Array<{ id: string; x: number; y: number }>,
  edges: Array<{ id: string; sourceId: string; targetId: string }> = [],
): TopologySnapshot<NodeData, EdgeData> {
  return {
    width: 300,
    height: 200,
    nodes: nodes.map((node) => ({
      ...node,
      data: { label: node.id },
    })),
    edges: edges.map((edge) => ({
      ...edge,
      data: { label: edge.id },
    })),
  };
}

describe("topology motion", () => {
  it("interpolates every persistent node on the same timeline", () => {
    const previous = settledTopology(snapshot([
      { id: "root", x: 100, y: 40 },
      { id: "child", x: 60, y: 120 },
    ]));
    const transition = compileTopologyTransition(previous, snapshot([
      { id: "root", x: 150, y: 40 },
      { id: "child", x: 210, y: 120 },
    ]));

    const midpoint = sampleTopologyTransition(transition, 0.5);
    expect(midpoint.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual([
      { id: "root", x: 125, y: 40 },
      { id: "child", x: 135, y: 120 },
    ]);
  });

  it("enters a connected node from its persistent neighbor", () => {
    const previous = settledTopology(snapshot([
      { id: "one", x: 80, y: 100 },
    ]));
    const transition = compileTopologyTransition(previous, snapshot(
      [
        { id: "one", x: 80, y: 100 },
        { id: "two", x: 220, y: 100 },
      ],
      [{ id: "one:next:two", sourceId: "one", targetId: "two" }],
    ));

    const start = sampleTopologyTransition(transition, 0);
    expect(start.nodes.find((node) => node.id === "two")).toMatchObject({
      x: 80,
      y: 100,
      opacity: 0,
      scale: 0.72,
      phase: "entering",
    });
    expect(start.edges[0]).toMatchObject({
      opacity: 0,
      phase: "entering",
    });
  });

  it("keeps removed nodes and edges alive until the transition completes", () => {
    const previous = settledTopology(snapshot(
      [
        { id: "one", x: 60, y: 100 },
        { id: "two", x: 180, y: 100 },
      ],
      [{ id: "one:next:two", sourceId: "one", targetId: "two" }],
    ));
    const transition = compileTopologyTransition(previous, snapshot([
      { id: "one", x: 120, y: 100 },
    ]));

    const midpoint = sampleTopologyTransition(transition, 0.5);
    expect(midpoint.nodes.find((node) => node.id === "two")).toMatchObject({
      x: 150,
      opacity: 0.5,
      phase: "exiting",
    });
    expect(midpoint.edges[0]).toMatchObject({
      opacity: 0.5,
      phase: "exiting",
    });

    const complete = sampleTopologyTransition(transition, 1);
    expect(complete.nodes.map((node) => node.id)).toEqual(["one"]);
    expect(complete.edges).toEqual([]);
  });

  it("cross-fades reconnecting edges while nodes keep their identities", () => {
    const previous = settledTopology(snapshot(
      [
        { id: "one", x: 40, y: 100 },
        { id: "two", x: 150, y: 100 },
        { id: "three", x: 260, y: 100 },
      ],
      [{ id: "one:next:two", sourceId: "one", targetId: "two" }],
    ));
    const transition = compileTopologyTransition(previous, snapshot(
      [
        { id: "one", x: 40, y: 100 },
        { id: "two", x: 150, y: 100 },
        { id: "three", x: 260, y: 100 },
      ],
      [{ id: "one:next:three", sourceId: "one", targetId: "three" }],
    ));

    const midpoint = sampleTopologyTransition(transition, 0.5);
    expect(midpoint.edges).toEqual([
      expect.objectContaining({
        id: "one:next:three",
        opacity: 0.5,
        phase: "entering",
      }),
      expect.objectContaining({
        id: "one:next:two",
        opacity: 0.5,
        phase: "exiting",
      }),
    ]);
  });

  it("curves intersecting node paths apart at their midpoint", () => {
    const previous = settledTopology(snapshot([
      { id: "old-root", x: 100, y: 40 },
      { id: "new-root", x: 160, y: 140 },
    ]));
    const transition = compileTopologyTransition(previous, snapshot([
      { id: "new-root", x: 100, y: 40 },
      { id: "old-root", x: 100, y: 140 },
    ]));

    const midpoint = sampleTopologyTransition(transition, 0.5);
    const oldRoot = midpoint.nodes.find((node) => node.id === "old-root")!;
    const newRoot = midpoint.nodes.find((node) => node.id === "new-root")!;
    expect(Math.hypot(
      oldRoot.x - newRoot.x,
      oldRoot.y - newRoot.y,
    )).toBeGreaterThanOrEqual(62);
  });
});
