import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SceneProjection } from "@traceframe/core";
import { ProjectionView } from "./ProjectionView";

const scalar = (
  key: string,
  label: string,
  value: string,
): SceneProjection => ({
  kind: "scalar",
  key,
  label,
  type: "int",
  value,
});

const nestedMapping: SceneProjection = {
  kind: "mapping",
  key: "map:1",
  label: "0",
  type: "dict",
  entries: [
    {
      key: scalar("key", "key", '"grid"'),
      value: {
        kind: "sequence",
        key: "list:1",
        label: "value",
        type: "list",
        items: [scalar("item", "0", "7")],
      },
    },
  ],
};

describe("ProjectionView semantic zoom", () => {
  it("renders structural grid projections with grid selectors", () => {
    const grid: SceneProjection = {
      kind: "grid",
      key: "grid",
      label: "grid",
      type: "list",
      rows: [[scalar("cell-0-0", "0", "0")]],
    };
    const { container } = render(
      <ProjectionView projection={grid} path="grid" />,
    );

    expect(container.querySelector(".grid-view")).toBeInTheDocument();
    expect(container.querySelector(".grid-cell")).toBeInTheDocument();
  });

  it("replaces nested containers with fixed overview tokens", () => {
    const inspect = vi.fn();
    const outer: SceneProjection = {
      kind: "sequence",
      key: "outer",
      label: "values",
      type: "list",
      items: [nestedMapping],
    };

    const { container } = render(
      <ProjectionView projection={outer} onInspect={inspect} path="values" />,
    );

    const token = screen.getByRole("button", {
      name: "Inspect 0: dict, 1 entries",
    });
    expect(token).toHaveClass("nested-projection-token");
    expect(container.querySelector(".mapping-row")).not.toBeInTheDocument();

    fireEvent.click(token);
    expect(inspect).toHaveBeenCalledWith(nestedMapping);
  });

  it("expands one selected layer and keeps deeper containers interactive", () => {
    const inspect = vi.fn();
    const { container } = render(
      <ProjectionView
        projection={nestedMapping}
        expanded
        onInspect={inspect}
        path="value"
      />,
    );

    expect(container.querySelector(".mapping-row")).toBeInTheDocument();
    expect(container.querySelector(".sequence-view")).not.toBeInTheDocument();
    const token = screen.getByRole("button", {
      name: "Inspect value: list, 1 items",
    });
    expect(token).toHaveClass("nested-projection-token");
    fireEvent.click(token);
    expect(inspect).toHaveBeenCalledWith(nestedMapping.entries[0].value);
  });

  it("highlights the canonical active mapping value", () => {
    const { container } = render(
      <ProjectionView
        projection={nestedMapping}
        focusPaths={["counts{0}.value"]}
        onInspect={vi.fn()}
        path="counts"
      />,
    );

    expect(container.querySelector(".mapping-value")).toHaveClass("focused");
    expect(container.querySelector(".mapping-key")).not.toHaveClass("focused");
  });

  it("places iteration bindings directly over sequence cells", () => {
    const sequence: SceneProjection = {
      kind: "sequence",
      key: "numbers",
      label: "nums",
      type: "list",
      items: [
        scalar("number-0", "0", "2"),
        scalar("number-1", "1", "7"),
      ],
    };
    const { rerender } = render(
      <ProjectionView
        variableMarkers={[{
          id: "loop:index",
          label: "index",
          path: "nums[0]",
        }]}
        path="nums"
        projection={sequence}
      />,
    );

    const marker = screen.getByLabelText("index at nums[0]");
    expect(marker).toHaveStyle({ left: "29px" });

    rerender(
      <ProjectionView
        variableMarkers={[{
          id: "loop:index",
          label: "index",
          path: "nums[1]",
        }]}
        path="nums"
        projection={sequence}
      />,
    );
    expect(screen.getByLabelText("index at nums[1]")).toBe(marker);
    expect(marker).toHaveStyle({ left: "83px" });
  });

  it("renders graph projections as nodes and inspects a vertex payload", () => {
    const inspect = vi.fn();
    const neighbors: SceneProjection = {
      kind: "sequence",
      key: "neighbors-0",
      label: "Neighbors of 0",
      type: "list",
      items: [scalar("neighbor-1", "0", "1")],
    };
    const graph: SceneProjection = {
      kind: "graph",
      key: "graph",
      label: "graph",
      type: "list",
      layout: "network",
      directed: false,
      vertices: [
        {
          id: "vertex-0",
          label: "0",
          value: scalar("vertex-value-0", "0", "0"),
          adjacency: neighbors,
        },
        {
          id: "vertex-1",
          label: "1",
          value: scalar("vertex-value-1", "1", "1"),
          adjacency: {
            kind: "sequence",
            key: "neighbors-1",
            label: "Neighbors of 1",
            type: "list",
            items: [scalar("neighbor-0", "0", "0")],
          },
        },
      ],
      edges: [{
        id: "edge-0-1",
        sourceId: "vertex-0",
        targetId: "vertex-1",
      }],
    };

    render(
      <ProjectionView
        graphMemberships={[{
          graphKey: "graph",
          variableName: "queue",
          vertexIds: ["vertex-1"],
        }]}
        projection={graph}
        onInspect={inspect}
        path="graph"
      />,
    );

    expect(screen.getByLabelText("graph, undirected network with 2 vertices"))
      .toBeInTheDocument();
    expect(screen.getByLabelText("Graph memberships")).toHaveTextContent("queue");
    expect(document.querySelectorAll(".graph-membership-dots i")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Inspect vertex 0" }));
    expect(inspect).toHaveBeenCalledWith(neighbors);
  });
});
