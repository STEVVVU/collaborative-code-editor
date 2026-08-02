import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  defaultTraceframeRendererConfig,
  TraceframeProvider,
  TraceframeSurface,
  useTraceframeRendererConfig,
} from "./TraceframeProvider";

function OperationDuration() {
  const config = useTraceframeRendererConfig();
  return <span>{config.operationMotionDurationMs}</span>;
}

describe("TraceframeProvider", () => {
  it("uses a deliberately slower operation choreography default", () => {
    expect(defaultTraceframeRendererConfig.operationMotionDurationMs).toBe(900);
  });

  it("exposes configurable semantic-state timing to renderer CSS", () => {
    const { container } = render(
      <TraceframeProvider config={{ stateTransitionMs: 340 }}>
        <TraceframeSurface>content</TraceframeSurface>
      </TraceframeProvider>,
    );

    expect(container.querySelector(".tf-root")).toHaveStyle({
      "--tf-state-transition-duration": "340ms",
    });
  });

  it("allows operation choreography timing to be configured independently", () => {
    const { getByText } = render(
      <TraceframeProvider config={{ operationMotionDurationMs: 1_400 }}>
        <OperationDuration />
      </TraceframeProvider>,
    );

    expect(getByText("1400")).toBeInTheDocument();
  });
});
