import { describe, expect, it } from "vitest";
import { examples } from "./examples";

describe("playground examples", () => {
  it("declares the BFS adjacency-list graph contract on its graph binding", () => {
    const bfs = examples.find((example) => example.id === "bfs");

    expect(bfs?.runSpec.projectionContracts).toEqual({
      version: 1,
      declarations: [
        {
          id: "bfs-graph",
          target: {
            root: { kind: "binding", name: "graph" },
            segments: [],
          },
          configuration: {
            kind: "graph",
            representation: "adjacency-list",
            directed: false,
          },
        },
      ],
    });
  });
});
