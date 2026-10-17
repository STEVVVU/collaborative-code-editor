import { compileScene, type AttentionSnapshot, type SceneProjection, type TraceFrame, type VisualScene } from "@traceframe/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AttentionWorkspace } from "./AttentionWorkspace";

const scalar = (key: string, label: string, value: number): SceneProjection => ({ kind: "scalar", key, label, type: "int", value });
const sequence = (key: string, label: string, items: SceneProjection[]): SceneProjection => ({ kind: "sequence", key, label, type: "list", items });

function createScene(projections: Array<[string, SceneProjection]>): VisualScene {
  const frame: TraceFrame = {
    index: 0, event: "line", source: { line: 1 }, functionName: "run", scopeId: "run:1", depth: 0,
    callStack: [], locals: {}, stdout: "", changes: [], semanticEvents: [],
  };
  const scene = compileScene(frame);
  scene.variables = projections.map(([name, projection]) => ({ name, projection, changed: false, changeCount: 0 }));
  return scene;
}

function snapshot(views: AttentionSnapshot["views"], workingIds: string[]): AttentionSnapshot {
  return { stepIndex: 0, views, workingIds };
}

describe("AttentionWorkspace", () => {
  it("keeps context values as bounded previews and only full-renders working views", () => {
    const values = [sequence("first", "first", [scalar("a", "0", 1)]), sequence("second", "second", [scalar("b", "0", 2)]), sequence("third", "third", [scalar("c", "0", 3)])];
    const scene = createScene(values.map((projection) => [projection.label, projection]));
    const views = values.map((projection) => ({ id: projection.key, path: projection.label, label: projection.label, type: "list", kind: "sequence" as const, aliases: [], activity: "idle" as const, changes: [] }));
    const { container } = render(<AttentionWorkspace scene={scene} attention={snapshot(views, ["second"])} sessionId="run-1" onInspect={vi.fn()} />);

    expect(container.querySelectorAll(".attention-context-card")).toHaveLength(3);
    expect(container.querySelectorAll(".attention-working-card")).toHaveLength(1);
    expect(container.querySelectorAll(".projection-shell")).toHaveLength(1);
    expect(container.querySelectorAll(".attention-preview-cells").length).toBeGreaterThan(0);
  });

  it("marks actual changes separately from reads and does not treat activity as mutation", () => {
    const changed = sequence("changed", "changed", [scalar("changed-value", "0", 8)]);
    const used = sequence("used", "used", [scalar("used-value", "0", 8)]);
    const scene = createScene([["changed", changed], ["used", used]]);
    const views: AttentionSnapshot["views"] = [
      { id: "changed", path: "changed", label: "changed", type: "list", kind: "sequence", aliases: [], activity: "changed", changes: [{ path: "changed[0]", kind: "updated", before: { kind: "scalar", type: "int", value: 7 }, after: { kind: "scalar", type: "int", value: 8 } }] },
      { id: "used", path: "used", label: "used", type: "list", kind: "sequence", aliases: [], activity: "used", changes: [] },
    ];
    const { container } = render(<AttentionWorkspace scene={scene} attention={snapshot(views, ["changed", "used"])} sessionId="run-1" onInspect={vi.fn()} />);

    expect(screen.getByLabelText("Changed")).toBeInTheDocument();
    expect(screen.getByText("In use")).toBeInTheDocument();
    expect(container.querySelectorAll(".attention-change-summary")).toHaveLength(1);
    expect(container.querySelector(".attention-change-summary")).toHaveTextContent("updated changed[0]: 7 → 8");
    expect(container.querySelector("[data-attention-id='used'] .attention-changed")).toBeNull();
  });

  it("pins views, shows an absent pinned placeholder, and resets pins for a new session", () => {
    const item = sequence("item", "item", [scalar("item-value", "0", 1)]);
    const scene = createScene([["item", item]]);
    const view = { id: "item", path: "item", label: "item", type: "list", kind: "sequence" as const, aliases: [], activity: "idle" as const, changes: [] };
    const { rerender } = render(<AttentionWorkspace scene={scene} attention={snapshot([view], [])} sessionId="run-1" onInspect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Pin item" }));
    expect(screen.getAllByText("Pinned").length).toBeGreaterThan(0);

    rerender(<AttentionWorkspace scene={scene} attention={snapshot([], [])} sessionId="run-1" onInspect={vi.fn()} />);
    expect(screen.getByText("Not in scope at this step")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unpin item" }));
    expect(screen.queryByText("Not in scope at this step")).toBeNull();

    rerender(<AttentionWorkspace scene={scene} attention={snapshot([view], [])} sessionId="run-1" onInspect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Pin item" }));
    rerender(<AttentionWorkspace scene={scene} attention={snapshot([], [])} sessionId="run-2" onInspect={vi.fn()} />);
    expect(screen.queryByText("Not in scope at this step")).toBeNull();
  });

  it("keeps child composites as previews in full mode and preserves explicit detail navigation", () => {
    const nested = sequence("outer", "outer", [sequence("inner", "inner", [scalar("leaf", "0", 4)])]);
    const scene = createScene([["outer", nested]]);
    const view: AttentionSnapshot["views"][number] = { id: "outer", path: "outer", label: "outer", type: "list", kind: "sequence", aliases: [], activity: "used", changes: [] };
    const onInspect = vi.fn();
    const { container } = render(<AttentionWorkspace scene={scene} attention={snapshot([view], ["outer"])} sessionId="run-1" onInspect={onInspect} />);

    expect(container.querySelectorAll(".projection-shell")).toHaveLength(1);
    expect(container.querySelectorAll(".attention-preview").length).toBeGreaterThan(0);
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.some((button) => button.querySelector("button"))).toBe(false);
    const motionKeys = [...container.querySelectorAll("[data-motion-key]")].map((node) => node.getAttribute("data-motion-key"));
    expect(new Set(motionKeys).size).toBe(motionKeys.length);
    fireEvent.click(screen.getByRole("button", { name: /Open details for inner/ }));
    expect(onInspect).toHaveBeenCalledWith(expect.objectContaining({ key: "inner" }), "outer[0]");
  });

  it("shows simple binding aliases beside canonical labels without repeating the root name", () => {
    const chain = sequence("chain-id", "chain", [scalar("chain-item", "0", 1)]);
    const distances = sequence("distances-id", "distances", [scalar("distance-item", "0", 2)]);
    const scene = createScene([["details", chain], ["distances", distances]]);
    const views: AttentionSnapshot["views"] = [
      { id: "chain-id", path: "details[0]", label: "chain", type: "list", kind: "sequence", aliases: ["graph", "distances", "queue", "details[0]", "details.child"], activity: "used", changes: [] },
      { id: "distances-id", path: "distances", label: "distances", type: "list", kind: "sequence", aliases: ["distances", "other"], activity: "used", changes: [] },
    ];
    const { container } = render(<AttentionWorkspace scene={scene} attention={snapshot(views, ["chain-id", "distances-id"])} sessionId="run-1" onInspect={vi.fn()} />);

    const chainCard = container.querySelector('.attention-working-card[data-attention-id="chain-id"]')!;
    expect(chainCard.querySelector(".attention-working-aliases")).toHaveTextContent("= graph, distances");
    expect(chainCard.querySelector(".attention-working-heading strong")).toHaveTextContent("chain");
    expect(chainCard.querySelector(".attention-working-heading strong")).toHaveAttribute("title", "details[0] · aliases: graph, distances, queue");
    const distancesCard = container.querySelector('.attention-working-card[data-attention-id="distances-id"]')!;
    expect(distancesCard.querySelector(".attention-working-aliases")).toHaveTextContent("= other");
    expect(distancesCard.querySelector(".attention-working-aliases")).not.toHaveTextContent("distances");
    expect(chainCard.querySelector('button[aria-label="Pin chain"]')).not.toBeNull();
  });
});
