import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlaybackControls } from "./PlaybackControls";
import { TraceframeProvider } from "./TraceframeProvider";

describe("PlaybackControls", () => {
  it("projects timeline state into a configurable animated visual", () => {
    const props = {
      current: 1,
      total: 5,
      playing: false,
      speed: 1,
      onCurrentChange: vi.fn(),
      onPlayingChange: vi.fn(),
      onSpeedChange: vi.fn(),
    };
    const { container, rerender } = render(
      <TraceframeProvider config={{ stateTransitionMs: 310 }}>
        <PlaybackControls {...props} />
      </TraceframeProvider>,
    );

    expect(container.querySelector(".playback-controls")).toHaveStyle({
      "--tf-state-transition-duration": "310ms",
    });
    expect(container.querySelector(".timeline-control")).toHaveStyle({
      "--tf-timeline-progress": "25%",
    });

    rerender(
      <TraceframeProvider config={{ stateTransitionMs: 310 }}>
        <PlaybackControls {...props} current={3} />
      </TraceframeProvider>,
    );
    expect(container.querySelector(".timeline-control")).toHaveStyle({
      "--tf-timeline-progress": "75%",
    });
  });
});
