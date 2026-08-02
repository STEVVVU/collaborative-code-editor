import type { CausalLink } from "./scene";
import type { SemanticEvent } from "./types";

export interface SceneMotion {
  id: string;
  kind: "move" | "swap";
  sourcePath: string;
  targetPath: string;
  durationMs: number;
  easing: string;
}

export interface SceneMotionPlan {
  motions: SceneMotion[];
}

export function compileMotionPlan(
  links: CausalLink[],
  operations: SemanticEvent[],
): SceneMotionPlan {
  const valueLinks = links.filter(
    (link) =>
      link.sourceKind === "value" &&
      link.source !== link.target,
  );
  const linkKeys = new Set(
    valueLinks.map((link) => `${link.source}->${link.target}`),
  );
  const hasSwapEvent = operations.some((operation) => operation.kind === "swap");
  const motions = valueLinks.flatMap((link) => {
    const isSwap =
      hasSwapEvent &&
      linkKeys.has(`${link.target}->${link.source}`);
    const isStructuralTransfer =
      /[\[{]/.test(link.source) &&
      /[\[{]/.test(link.target);
    if (!isSwap && !isStructuralTransfer) {
      return [];
    }
      return [{
      id:
        `${link.sourceLocationId ?? link.source}->` +
        `${link.targetLocationId ?? link.target}`,
      kind: isSwap ? "swap" as const : "move" as const,
      sourcePath: link.source,
      targetPath: link.target,
      durationMs: isSwap ? 480 : 360,
      easing: "cubic-bezier(0.45, 0, 0.55, 1)",
    }];
  });

  return {
    motions: [...new Map(motions.map((motion) => [motion.id, motion])).values()],
  };
}
