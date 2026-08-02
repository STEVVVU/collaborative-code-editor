import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RecursionProjection } from "@traceframe/core";
import { TraceframeProvider, TraceframeSurface } from "./TraceframeProvider";
import { RecursionView } from "./RecursionView";
import { CallFlowView } from "./RecursionView";

const recursion: RecursionProjection = {
  frames: [5, 4, 3, 2, 1].map((number, index) => ({
    scopeId: `factorial:${index + 1}`,
    functionName: "factorial",
    line: number === 1 ? 3 : 4,
    bindings: [{ name: "number", value: String(number) }],
    ...(number === 1 ? { returnValue: "1" } : {}),
  })),
};

describe("RecursionView", () => {
  it("renders recursive scalar scopes as an ordered call chain", () => {
    const { container } = render(
      <TraceframeProvider config={{ motionDurationMs: 0 }}>
        <TraceframeSurface>
          <RecursionView recursion={recursion} />
        </TraceframeSurface>
      </TraceframeProvider>,
    );

    expect(screen.getByText("5 active calls")).toBeInTheDocument();
    expect(container.querySelectorAll(".recursion-call")).toHaveLength(5);
    expect(container.querySelectorAll(".recursion-arrow")).toHaveLength(4);
    expect(container.querySelector(".recursion-call.active")).toHaveAttribute(
      "data-scope-id",
      "factorial:5",
    );
    expect(screen.getByText("return 1")).toBeInTheDocument();
  });

  it("labels non-recursive nested activations as call flow", () => {
    render(
      <TraceframeSurface>
        <CallFlowView
          callFlow={{
            recursive: false,
            frames: [
              {
                activationId: "solve:1",
                functionName: "solve",
                line: 2,
                bindings: [{ name: "root", value: "TreeNode(7)" }],
              },
              {
                activationId: "visit:1",
                parentActivationId: "solve:1",
                functionName: "visit",
                line: 5,
                bindings: [{ name: "node", value: "TreeNode(7)" }],
              },
            ],
          }}
        />
      </TraceframeSurface>,
    );

    expect(screen.getByRole("region", { name: "Call flow" }))
      .toBeInTheDocument();
    expect(screen.getByText("2 active calls")).toBeInTheDocument();
  });
});
