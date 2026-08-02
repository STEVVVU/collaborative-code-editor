import { useLayoutEffect, useRef, type RefObject } from "react";
import type { OperationMotionPlan } from "@traceframe/core";

const TOKEN_SIZE = 84;

function pathElement(
  root: HTMLElement,
  path: string | undefined,
): HTMLElement | undefined {
  if (!path) {
    return undefined;
  }
  const matches = [
    ...root.querySelectorAll<HTMLElement>("[data-projection-path]"),
  ].filter((element) => element.dataset.projectionPath === path);
  return (
    matches.find((element) => element.dataset.motionAnchor === "value") ??
    matches.find((element) => element.dataset.motionAnchor === "entity") ??
    matches.at(-1)
  );
}

function center(rect: DOMRect, rootRect: DOMRect) {
  return {
    x: rect.left - rootRect.left + rect.width / 2,
    y: rect.top - rootRect.top + rect.height / 2,
  };
}

function token(
  layer: HTMLElement,
  text: string,
  className: string,
  x: number,
  y: number,
): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = `operation-motion-token ${className}`;
  element.textContent = text;
  element.setAttribute("aria-hidden", "true");
  Object.assign(element.style, {
    left: `${x - TOKEN_SIZE / 2}px`,
    top: `${y - TOKEN_SIZE / 2}px`,
  });
  layer.append(element);
  return element;
}

function finished(animation: Animation): Promise<void> {
  return animation.finished.then(() => undefined).catch(() => undefined);
}

export function useOperationMotion(
  rootRef: RefObject<HTMLElement | null>,
  frameIndex: number | undefined,
  plan: OperationMotionPlan | undefined,
  durationMs: number,
): void {
  const playedRef = useRef<string | undefined>(undefined);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!plan) {
      playedRef.current = undefined;
      return;
    }
    if (
      !root ||
      frameIndex === undefined ||
      typeof root.animate !== "function"
    ) {
      return;
    }
    const playbackKey = `${frameIndex}:${plan.id}`;
    if (
      playedRef.current === playbackKey ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      playedRef.current = playbackKey;
      return;
    }
    playedRef.current = playbackKey;

    const rootRect = root.getBoundingClientRect();
    const canvasRect =
      root.querySelector<HTMLElement>(".primary-variables")
        ?.getBoundingClientRect() ?? rootRect;
    const stage = {
      x: canvasRect.left - rootRect.left + canvasRect.width / 2,
      y:
        canvasRect.top -
        rootRect.top +
        Math.max(80, Math.min(canvasRect.height - 80, canvasRect.height * 0.58)),
    };
    const spread = Math.min(92, Math.max(64, canvasRect.width * 0.08));
    const unary = plan.operandTexts.length === 1;
    const slotXs = plan.operandTexts.map((_, index) =>
      unary
        ? stage.x + spread * 0.45
        : stage.x + (index - (plan.operandTexts.length - 1) / 2) * spread * 2,
    );
    const operatorX = unary ? stage.x - spread * 0.45 : stage.x;

    const layer = document.createElement("div");
    layer.className = "operation-motion-layer";
    layer.setAttribute("aria-hidden", "true");
    layer.dataset.operationExpression = plan.expression;
    if (plan.targetPath) {
      layer.dataset.operationTarget = plan.targetPath;
    }
    root.append(layer);

    const sourceElements = plan.sourcePaths.map((path) =>
      pathElement(root, path ?? undefined),
    );
    const operandTokens = plan.operandTexts.map((text, index) => {
      const sourceRect = sourceElements[index]?.getBoundingClientRect();
      const origin = sourceRect
        ? center(sourceRect, rootRect)
        : { x: slotXs[index], y: stage.y };
      const element = token(
        layer,
        text,
        "operation-motion-operand",
        origin.x,
        origin.y,
      );
      element.dataset.origin = sourceRect ? "source" : "literal";
      return { element, origin, targetX: slotXs[index] };
    });
    const operator = token(
      layer,
      plan.operatorToken,
      "operation-motion-operator",
      operatorX,
      stage.y,
    );
    operator.style.opacity = "0";
    const result = token(
      layer,
      plan.resultText,
      "operation-motion-result",
      stage.x,
      stage.y,
    );
    result.style.opacity = "0";

    const target = pathElement(root, plan.targetPath);
    const targetOpacity = target?.style.opacity ?? "";
    if (target) {
      target.style.opacity = "0";
    }

    const animations: Animation[] = [];
    let disposed = false;
    const gatherMs = Math.max(220, durationMs * 0.65);
    const resolveMs = Math.max(150, durationMs * 0.38);
    const settleMs = Math.max(240, durationMs * 0.72);

    const play = async () => {
      const gather = operandTokens.map(({ element, origin, targetX }) => {
        const animation = element.animate(
          [
            {
              transform: "translate(0, 0) scale(0.34)",
              opacity: element.dataset.origin === "source" ? 0.3 : 0,
            },
            {
              transform: `translate(${targetX - origin.x}px, ${stage.y - origin.y}px) scale(1)`,
              opacity: 1,
            },
          ],
          {
            duration: gatherMs,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            fill: "forwards",
          },
        );
        animations.push(animation);
        return animation;
      });
      const operatorIn = operator.animate(
        [
          { opacity: 0, transform: "scale(0.65)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        {
          delay: gatherMs * 0.45,
          duration: gatherMs * 0.55,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "forwards",
        },
      );
      animations.push(operatorIn);
      await Promise.all([...gather, operatorIn].map(finished));
      if (disposed) {
        return;
      }

      const resolveAnimations = [
        ...operandTokens.map(({ element, origin }) =>
          element.animate(
            [
              { opacity: 1, transform: getComputedStyle(element).transform },
              {
                opacity: 0,
                transform: `translate(${stage.x - origin.x}px, ${stage.y - origin.y}px) scale(0.72)`,
              },
            ],
            {
              duration: resolveMs,
              easing: "cubic-bezier(0.4, 0, 0.2, 1)",
              fill: "forwards",
            },
          ),
        ),
        operator.animate(
          [
            { opacity: 1, transform: "scale(1)" },
            { opacity: 0, transform: "scale(0.72)" },
          ],
          {
            duration: resolveMs,
            easing: "cubic-bezier(0.4, 0, 0.2, 1)",
            fill: "forwards",
          },
        ),
        result.animate(
          [
            { opacity: 0, transform: "scale(0.72)" },
            { opacity: 1, transform: "scale(1)" },
          ],
          {
            duration: resolveMs,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            fill: "forwards",
          },
        ),
      ];
      animations.push(...resolveAnimations);
      await Promise.all(resolveAnimations.map(finished));
      if (disposed) {
        return;
      }

      operandTokens.forEach(({ element }) => element.remove());
      operator.remove();
      if (target) {
        const targetPoint = center(target.getBoundingClientRect(), rootRect);
        const settle = result.animate(
          [
            { opacity: 1, transform: "translate(0, 0) scale(1)" },
            {
              opacity: 1,
                transform: `translate(${targetPoint.x - stage.x}px, ${targetPoint.y - stage.y}px) scale(0.3)`,
            },
          ],
          {
            duration: settleMs,
            easing: "cubic-bezier(0.65, 0, 0.35, 1)",
            fill: "forwards",
          },
        );
        animations.push(settle);
        await finished(settle);
        if (disposed) {
          return;
        }
        target.style.opacity = targetOpacity;
      } else {
        const linger = result.animate(
          [
            { opacity: 1, transform: "scale(1)" },
            { opacity: 0, transform: "scale(0.96)" },
          ],
          {
            delay: 180,
            duration: 180,
            fill: "forwards",
          },
        );
        animations.push(linger);
        await finished(linger);
      }
      layer.remove();
    };
    void play();

    return () => {
      disposed = true;
      animations.forEach((animation) => animation.cancel());
      if (target) {
        target.style.opacity = targetOpacity;
      }
      layer.remove();
    };
  }, [durationMs, frameIndex, plan, rootRef]);
}
