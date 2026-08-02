import { describe, expect, it } from "vitest";
import { compileMotionPlan } from "./motion";
import type { CausalLink } from "./scene";
import type { SemanticEvent } from "./types";

describe("compileMotionPlan", () => {
  it("compiles reciprocal swap flows into paired swap tweens", () => {
    const links: CausalLink[] = [
      {
        source: "nums[1]",
        target: "nums[0]",
        sourceKind: "value",
      },
      {
        source: "nums[0]",
        target: "nums[1]",
        sourceKind: "value",
      },
    ];
    const operations: SemanticEvent[] = [{
      kind: "swap",
      source: { line: 4 },
      expression: "nums[0], nums[1] = nums[1], nums[0]",
      target: "nums[0], nums[1]",
    }];

    expect(compileMotionPlan(links, operations).motions).toMatchObject([
      {
        kind: "swap",
        sourcePath: "nums[1]",
        targetPath: "nums[0]",
        durationMs: 480,
        easing: "cubic-bezier(0.45, 0, 0.55, 1)",
      },
      {
        kind: "swap",
        sourcePath: "nums[0]",
        targetPath: "nums[1]",
        durationMs: 480,
        easing: "cubic-bezier(0.45, 0, 0.55, 1)",
      },
    ]);
  });

  it("moves structural transfers but ignores scalar and call-only links", () => {
    const links: CausalLink[] = [
      {
        source: "nums[0]",
        target: "result",
        sourceKind: "value",
      },
      {
        source: "nums[0]",
        target: "output[0]",
        sourceKind: "value",
      },
      {
        source: "transform(nums[0])",
        target: "result",
        sourceKind: "call",
      },
    ];

    const operations: SemanticEvent[] = [{
      kind: "operation",
      source: { line: 2 },
      expression: "left + right",
      operator: "add",
      operationCategory: "arithmetic",
      operands: [],
    }];

    expect(compileMotionPlan(links, operations).motions).toMatchObject([
      {
        kind: "move",
        sourcePath: "nums[0]",
        targetPath: "output[0]",
        durationMs: 360,
        easing: "cubic-bezier(0.45, 0, 0.55, 1)",
      },
    ]);
  });
});
