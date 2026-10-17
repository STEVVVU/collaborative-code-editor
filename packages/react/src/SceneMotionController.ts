import { useLayoutEffect, useRef, type RefObject } from "react";
import type { SceneMotion, SceneMotionPlan } from "@traceframe/core";

interface MotionSnapshot {
  rect: DOMRect;
  text: string;
  color: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
}

const motionKey = (key: string) => `key:${key}`;

function motionElements(root: HTMLElement): Map<string, HTMLElement> {
  const candidates = [
    ...root.querySelectorAll<HTMLElement>(
      "[data-motion-key], [data-projection-path]",
    ),
  ];
  const identities = new Set(
    candidates.flatMap((element) => [
      ...(element.dataset.projectionPath
        ? [element.dataset.projectionPath]
        : []),
      ...(element.dataset.motionKey
        ? [motionKey(element.dataset.motionKey)]
        : []),
    ]),
  );
  return new Map(
    [...identities].flatMap((identity) => {
      const matches = candidates.filter(
        (element) =>
          element.dataset.projectionPath === identity ||
          (element.dataset.motionKey &&
            motionKey(element.dataset.motionKey) === identity),
      );
      const element =
        matches.find((candidate) =>
          candidate.dataset.motionAnchor === "value",
        ) ??
        matches.find((candidate) =>
          candidate.dataset.motionAnchor === "entity",
        ) ??
        matches.at(-1);
      return element ? [[identity, element] as const] : [];
    }),
  );
}

function capture(root: HTMLElement): Map<string, MotionSnapshot> {
  return new Map(
    [...motionElements(root)].map(([path, element]) => {
      const style = getComputedStyle(element);
      return [
        path,
        {
          rect: element.getBoundingClientRect(),
          text: element.textContent ?? "",
          color: style.color,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
        },
      ];
    }),
  );
}

function ghostFor(
  root: HTMLElement,
  snapshot: MotionSnapshot,
): HTMLSpanElement {
  const ghost = document.createElement("span");
  ghost.className = "scene-motion-ghost";
  ghost.textContent = snapshot.text;
  ghost.setAttribute("aria-hidden", "true");
  const rootRect = root.getBoundingClientRect();
  const width = Math.max(28, snapshot.rect.width + 12);
  const height = Math.max(28, snapshot.rect.height + 8);
  Object.assign(ghost.style, {
    position: "absolute",
    zIndex: "1000",
    left: `${
      snapshot.rect.left -
      rootRect.left +
      (snapshot.rect.width - width) / 2
    }px`,
    top: `${
      snapshot.rect.top -
      rootRect.top +
      (snapshot.rect.height - height) / 2
    }px`,
    width: `${width}px`,
    height: `${height}px`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
    color: snapshot.color,
    fontFamily: snapshot.fontFamily,
    fontSize: snapshot.fontSize,
    fontWeight: snapshot.fontWeight,
    lineHeight: "1",
    willChange: "transform, opacity",
  });
  root.append(ghost);
  return ghost;
}

function ghostKeyframes(
  motion: SceneMotion,
  deltaX: number,
  deltaY: number,
): Keyframe[] {
  if (motion.kind !== "swap") {
    return [
      { transform: "translate(0, 0) scale(1)", opacity: 1 },
      {
        transform: `translate(${deltaX}px, ${deltaY}px) scale(1)`,
        opacity: 1,
      },
    ];
  }

  const distance = Math.max(1, Math.hypot(deltaX, deltaY));
  const arc = Math.min(28, Math.max(18, distance * 0.2));
  const perpendicularX = (-deltaY / distance) * arc;
  const perpendicularY = (deltaX / distance) * arc;
  return [
    { transform: "translate(0, 0) scale(1)", opacity: 1 },
    {
      transform: `translate(${deltaX * 0.5 + perpendicularX}px, ${deltaY * 0.5 + perpendicularY}px) scale(1.03)`,
      opacity: 1,
      offset: 0.5,
    },
    {
      transform: `translate(${deltaX}px, ${deltaY}px) scale(1)`,
      opacity: 1,
    },
  ];
}

export function useSceneMotion(
  rootRef: RefObject<HTMLElement | null>,
  frameIndex: number | undefined,
  plan: SceneMotionPlan | undefined,
  viewKey = "overview",
  viewDurationMs = 480,
  snapshotContextKey?: string | number,
): void {
  const previousSnapshotRef = useRef<Map<string, MotionSnapshot>>(new Map());
  const previousFrameIndexRef = useRef<number | undefined>(undefined);
  const previousPlanRef = useRef<SceneMotionPlan | undefined>(undefined);
  const previousViewKeyRef = useRef(viewKey);
  const previousSnapshotContextKeyRef = useRef(snapshotContextKey);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      previousSnapshotRef.current = new Map();
      return;
    }

    const currentElements = motionElements(root);
    const currentSnapshot = capture(root);
    const previousSnapshot = previousSnapshotRef.current;
    const previousFrameIndex = previousFrameIndexRef.current;
    const previousPlan = previousPlanRef.current;
    const previousViewKey = previousViewKeyRef.current;
    const snapshotContextChanged =
      previousSnapshotContextKeyRef.current !== snapshotContextKey;
    previousSnapshotRef.current = currentSnapshot;
    previousFrameIndexRef.current = frameIndex;
    previousPlanRef.current = plan;
    previousViewKeyRef.current = viewKey;
    previousSnapshotContextKeyRef.current = snapshotContextKey;

    const frameDistance =
      previousFrameIndex === undefined || frameIndex === undefined
        ? 0
        : frameIndex - previousFrameIndex;
    const semanticPlan =
      Math.abs(frameDistance) > 1
        ? undefined
        : frameDistance < 0 && previousPlan
          ? {
              motions: previousPlan.motions.map((motion) => ({
                ...motion,
                id: `${motion.targetPath}->${motion.sourcePath}`,
                sourcePath: motion.targetPath,
                targetPath: motion.sourcePath,
              })),
            }
          : plan;
    const sharedViewKey =
      viewKey === previousViewKey
        ? undefined
        : viewKey === "overview"
          ? previousViewKey
          : viewKey;
    const sharedIdentity = sharedViewKey
      ? motionKey(sharedViewKey)
      : undefined;
    const viewPlan: SceneMotionPlan | undefined =
      sharedIdentity &&
      previousSnapshot.has(sharedIdentity) &&
      currentElements.has(sharedIdentity)
        ? {
            motions: [{
              id: `view:${previousViewKey}->${viewKey}`,
              kind: "move",
              sourcePath: sharedIdentity,
              targetPath: sharedIdentity,
              durationMs: viewDurationMs,
              easing: "cubic-bezier(0.4, 0, 0.2, 1)",
            }],
          }
        : undefined;
    const activePlan = snapshotContextChanged
      ? undefined
      : viewPlan ?? semanticPlan;

    if (
      previousSnapshot.size === 0 ||
      !activePlan ||
      activePlan.motions.length === 0 ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const animations: Animation[] = [];
    const ghosts: HTMLElement[] = [];
    const hiddenTargets = new Map<HTMLElement, string>();

    activePlan.motions.forEach((motion) => {
      const source = previousSnapshot.get(motion.sourcePath);
      const target = currentElements.get(motion.targetPath);
      if (!source || !target || typeof target.animate !== "function") {
        return;
      }
      const targetRect = target.getBoundingClientRect();
      const deltaX =
        targetRect.left + targetRect.width / 2 -
        (source.rect.left + source.rect.width / 2);
      const deltaY =
        targetRect.top + targetRect.height / 2 -
        (source.rect.top + source.rect.height / 2);
      if (Math.hypot(deltaX, deltaY) < 2) {
        return;
      }

      if (!hiddenTargets.has(target)) {
        hiddenTargets.set(target, target.style.opacity);
        target.style.opacity = "0";
      }

      const ghost = ghostFor(root, source);
      ghosts.push(ghost);
      const animation = ghost.animate(
        ghostKeyframes(motion, deltaX, deltaY),
        {
          duration: motion.durationMs,
          easing: motion.easing,
          fill: "forwards",
        },
      );
      animations.push(animation);
    });

    let disposed = false;
    void Promise.all(
      animations.map((animation) =>
        animation.finished.catch(() => undefined),
      ),
    ).then(() => {
      if (disposed) {
        return;
      }
      ghosts.forEach((ghost) => ghost.remove());
      hiddenTargets.forEach((opacity, target) => {
        target.style.opacity = opacity;
      });
      hiddenTargets.clear();
    });

    return () => {
      disposed = true;
      animations.forEach((animation) => animation.cancel());
      ghosts.forEach((ghost) => ghost.remove());
      hiddenTargets.forEach((opacity, target) => {
        target.style.opacity = opacity;
      });
    };
  }, [frameIndex, plan, rootRef, snapshotContextKey, viewDurationMs, viewKey]);
}
