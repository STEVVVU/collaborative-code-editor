import { useLayoutEffect, useRef, useState } from "react";
import {
  compileTopologyTransition,
  sampleTopologyTransition,
  settledTopology,
  type AnimatedTopologyFrame,
  type TopologySnapshot,
  type TopologyTransitionOptions,
} from "@traceframe/core";

const DEFAULT_DURATION_MS = 480;

export interface TopologyMotionOptions extends TopologyTransitionOptions {
  durationMs?: number;
}

function easeInOut(progress: number): number {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

export function useTopologyMotion<NodeData, EdgeData>(
  target: TopologySnapshot<NodeData, EdgeData>,
  options: TopologyMotionOptions | number = {},
): AnimatedTopologyFrame<NodeData, EdgeData> {
  const durationMs =
    typeof options === "number"
      ? options
      : options.durationMs ?? DEFAULT_DURATION_MS;
  const minNodeSeparation =
    typeof options === "number" ? undefined : options.minNodeSeparation;
  const enterScale =
    typeof options === "number" ? undefined : options.enterScale;
  const exitScale =
    typeof options === "number" ? undefined : options.exitScale;
  const [rendered, setRendered] = useState(() => settledTopology(target));
  const renderedRef = useRef(rendered);
  renderedRef.current = rendered;

  useLayoutEffect(() => {
    const settled = settledTopology(target);
    const transition = compileTopologyTransition(renderedRef.current, target, {
      enterScale,
      exitScale,
      minNodeSeparation,
    });
    const reduceMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    if (!transition.changed || reduceMotion) {
      renderedRef.current = settled;
      setRendered(settled);
      return;
    }

    let animationFrame = 0;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const elapsedProgress = Math.min(1, (now - startedAt) / durationMs);
      const frame = sampleTopologyTransition(
        transition,
        easeInOut(elapsedProgress),
      );
      renderedRef.current = frame;
      setRendered(frame);
      if (elapsedProgress < 1) {
        animationFrame = requestAnimationFrame(tick);
      } else {
        renderedRef.current = settled;
        setRendered(settled);
      }
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [
    durationMs,
    enterScale,
    exitScale,
    minNodeSeparation,
    target,
  ]);

  return rendered;
}
