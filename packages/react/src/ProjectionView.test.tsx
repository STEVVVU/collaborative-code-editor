import { fireEvent, render, screen, within } from "@testing-library/react";
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

describe("ProjectionView recursive rendering", () => {
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

  it("renders nested containers inline and supports collapse and detail inspection", () => {
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

    expect(container.querySelector(".mapping-row")).toBeInTheDocument();
    expect(container.querySelector(".sequence-view")).toBeInTheDocument();
    const collapse = screen.getByRole("button", {
      name: "Collapse 0",
    });
    expect(collapse).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(collapse);
    expect(container.querySelector(".mapping-row")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand 0" }));
    expect(container.querySelector(".mapping-row")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open details for 0" }));
    expect(inspect).toHaveBeenCalledWith(nestedMapping, "values[0]");
  });

  it("renders composite combinations and nested graphs through the same recursive path", () => {
    const inspect = vi.fn();
    const graph = (key: string, label: string, count: number): SceneProjection => ({
      kind: "graph",
      key,
      label,
      type: "Graph",
      layout: "network",
      directed: false,
      vertices: Array.from({ length: count }, (_, index) => ({
        id: `${key}-vertex-${index}`,
        label: `${index}`,
        value: scalar(`${key}-value-${index}`, `${index}`, `${index}`),
        adjacency: { kind: "reference", key: `${key}-ref-${index}`, label: `${index}`, type: "vertex", targetId: `${key}-vertex-${index}` },
      })),
      edges: [],
    });
    const nested: SceneProjection = {
      kind: "mapping",
      key: "outer-map",
      label: "outer",
      type: "dict",
      entries: [{
        key: scalar("outer-key", "key", '"graphs"'),
        value: {
          kind: "sequence",
          key: "graph-list",
          label: "graphs",
          type: "list",
          items: [
            graph("graph-small", "small graph", 2),
            graph("graph-large", "large graph", 5),
          ],
        },
      }],
    };
    const { container } = render(
      <ProjectionView
        projection={nested}
        onInspect={inspect}
        path="root"
      />,
    );

    expect(container.querySelectorAll(".graph-viewport")).toHaveLength(2);
    expect(container.querySelectorAll(".graph-node")).toHaveLength(7);
    expect(container.querySelector('[data-projection-path="root{0}.value[1]"]')).toBeInTheDocument();
    expect(container.querySelectorAll(".projection-shell[data-motion-key]")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Open details for graphs" }));
    expect(inspect).toHaveBeenCalledWith(nested.entries[0].value, "root{0}.value");
  });

  it("supports object and grid nesting while preserving scalar focus and reference leaves", () => {
    const reference: SceneProjection = {
      kind: "reference", key: "cycle", label: "cycle", type: "Node", targetId: "object-1",
    };
    const object: SceneProjection = {
      kind: "object", key: "object-1", label: "node", type: "Node", fields: [
        { name: "cells", value: {
          kind: "grid", key: "grid-nested", label: "cells", type: "grid",
          rows: [[scalar("focused-value", "0,0", "12"), reference]],
        } },
      ],
    };
    const { container } = render(
      <ProjectionView projection={{ kind: "sequence", key: "root-list", label: "root", type: "list", items: [object] }} path="root" focusPaths={["root[0].cells[0][0]"]} />,
    );

    expect(container.querySelector(".object-fields")).toBeInTheDocument();
    expect(container.querySelector(".grid-view")).toBeInTheDocument();
    expect(container.querySelector(".grid-cell .scalar-value.focused")).toHaveTextContent("12");
    expect(container.querySelector(".reference-value")).toHaveTextContent("object-1");
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
    expect(marker).toHaveStyle({ left: "50%" });

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
    expect(marker).toHaveStyle({ left: "50%" });
  });

  it("anchors sequence and grid variable markers to their actual cells", () => {
    const nested: SceneProjection = {
      kind: "mapping", key: "wide-map", label: "wide", type: "dict",
      entries: [{ key: scalar("wide-key", "key", '"a long key"'), value: scalar("wide-value", "value", '"a much longer value"') }],
    };
    const sequence: SceneProjection = {
      kind: "sequence", key: "marked-sequence", label: "sequence", type: "list",
      items: [nested, scalar("sequence-tail", "1", "2")],
    };
    const grid: SceneProjection = {
      kind: "grid", key: "marked-grid", label: "grid", type: "grid",
      rows: [[nested, scalar("grid-tail", "0,1", "3")]],
    };
    const { container } = render(
      <div>
        <ProjectionView projection={sequence} path="sequence" variableMarkers={[{ id: "sequence-marker", label: "last", path: "sequence[1]" }]} />
        <ProjectionView projection={grid} path="grid" variableMarkers={[{ id: "grid-marker", label: "cell", path: "grid[0][1]" }]} />
      </div>,
    );

    const sequenceMarker = container.querySelector('[data-variable-path="sequence[1]"]');
    expect(sequenceMarker?.closest(".sequence-view")).toBeInTheDocument();
    expect(sequenceMarker).toHaveStyle({ gridColumn: "2" });
    const gridMarker = container.querySelector('[data-variable-path="grid[0][1]"]');
    expect(gridMarker?.closest(".grid-view")).toBeInTheDocument();
    expect(gridMarker).toHaveStyle({ gridColumn: "2", gridRow: "1" });
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

    const { container } = render(
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
    fireEvent.click(within(container).getByRole("button", { name: "Inspect vertex 0" }));
    expect(inspect).toHaveBeenCalledWith(neighbors, "graph[0]");
  });
});
