import { Pause, Play, RotateCcw, StepBack, StepForward } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { useTraceframeRendererConfig } from "./TraceframeProvider";

export interface PlaybackControlsProps {
  current: number;
  total: number;
  playing: boolean;
  speed: number;
  disabled?: boolean;
  onCurrentChange(index: number): void;
  onPlayingChange(playing: boolean): void;
  onSpeedChange(speed: number): void;
}

export function PlaybackControls({
  current,
  total,
  playing,
  speed,
  disabled = false,
  onCurrentChange,
  onPlayingChange,
  onSpeedChange,
}: PlaybackControlsProps) {
  const rendererConfig = useTraceframeRendererConfig();
  const [dragging, setDragging] = useState(false);
  const lastIndex = Math.max(0, total - 1);
  const boundedCurrent = Math.min(Math.max(0, current), lastIndex);
  const progress = total > 1 ? (boundedCurrent / lastIndex) * 100 : 0;
  return (
    <div
      className="tf-root playback-controls"
      style={{
        "--tf-state-transition-duration":
          `${rendererConfig.stateTransitionMs}ms`,
      } as CSSProperties}
    >
      <button
        className="icon-button"
        disabled={disabled || current === 0}
        onClick={() => onCurrentChange(0)}
        title="Restart"
        aria-label="Restart"
        type="button"
      >
        <RotateCcw size={16} aria-hidden="true" />
      </button>
      <button
        className="icon-button"
        disabled={disabled || current === 0}
        onClick={() => onCurrentChange(Math.max(0, current - 1))}
        title="Previous step"
        aria-label="Previous step"
        type="button"
      >
        <StepBack size={16} aria-hidden="true" />
      </button>
      <button
        className="play-button"
        disabled={disabled || total === 0}
        onClick={() => onPlayingChange(!playing)}
        aria-label={playing ? "Pause" : "Play"}
        type="button"
      >
        <span className="playback-icon-stack" aria-hidden="true">
          <Play
            className={playing ? "" : "active"}
            size={15}
          />
          <Pause
            className={playing ? "active" : ""}
            size={15}
          />
        </span>
      </button>
      <button
        className="icon-button"
        disabled={disabled || current >= lastIndex}
        onClick={() => onCurrentChange(Math.min(lastIndex, current + 1))}
        title="Next step"
        aria-label="Next step"
        type="button"
      >
        <StepForward size={16} aria-hidden="true" />
      </button>
      <div
        className={`timeline-control ${dragging ? "dragging" : ""}`}
        style={{
          "--tf-timeline-progress": `${progress}%`,
        } as CSSProperties}
      >
        <div className="timeline-visual" aria-hidden="true">
          <span className="timeline-progress" />
          <span className="timeline-thumb" />
        </div>
        <input
          className="timeline"
          disabled={disabled || total === 0}
          max={lastIndex}
          min={0}
          onBlur={() => setDragging(false)}
          onChange={(event) => onCurrentChange(Number(event.target.value))}
          onPointerCancel={() => setDragging(false)}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging(true);
          }}
          onPointerUp={() => setDragging(false)}
          type="range"
          value={boundedCurrent}
          aria-label="Execution timeline"
        />
      </div>
      <span className="frame-counter">
        {total ? current + 1 : 0} / {total}
      </span>
      <select
        className="speed-select"
        onChange={(event) => onSpeedChange(Number(event.target.value))}
        value={speed}
        aria-label="Playback speed"
      >
        <option value={0.5}>0.5x</option>
        <option value={1}>1x</option>
        <option value={1.5}>1.5x</option>
        <option value={2}>2x</option>
      </select>
    </div>
  );
}
