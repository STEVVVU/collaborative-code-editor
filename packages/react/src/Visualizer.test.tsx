import { compileScene, type TraceFrame } from "@traceframe/core";
import { act, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Visualizer } from "./Visualizer";

function scalar(value: number) {
  return {
    kind: "scalar" as const,
    type: "int",
    value,
  };
}

function frame(semanticEvents: TraceFrame["semanticEvents"]): TraceFrame {
  return {
    index: 0,
    event: "line",
    source: { line: 2 },
    functionName: "solve",
    scopeId: "solve:1",
    depth: 0,
    callStack: [],
    locals: {},
    stdout: "",
    changes: [],
    semanticEvents,
  };
}

describe("Visualizer primitive operations", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows only the outer completed expression as an accessible equation", () => {
    const scene = compileScene(frame([
      {
        kind: "operation",
        source: { line: 2 },
        expression: "-count",
        operator: "negate",
        operatorToken: "-",
        operationCategory: "arithmetic",
        operandExpressions: ["count"],
        operands: [scalar(2)],
        result: scalar(-2),
      },
      {
        kind: "operation",
        source: { line: 2 },
        expression: "-count + value",
        operator: "add",
        operatorToken: "+",
        operationCategory: "arithmetic",
        operandExpressions: ["-count", "value"],
        operands: [scalar(-2), scalar(5)],
        result: scalar(3),
      },
      {
        kind: "write",
        source: { line: 2 },
        expression: "total = -count + value",
        target: "total",
        result: scalar(3),
      },
    ]));

    const { container } = render(
      <Visualizer scene={scene} loading={false} statusText="" />,
    );

    expect(container.querySelectorAll(".operation")).toHaveLength(1);
    expect(screen.getByLabelText(
      "Operation: -2 + 5 equals 3",
    )).toHaveTextContent("-2 + 5 -> 3");
  });

  it("prioritizes cache reuse over surrounding arithmetic", () => {
    const scene = compileScene(frame([
      {
        kind: "memo",
        source: { line: 2 },
        expression: "solve(index + 1)",
        callee: "solve",
        cacheHit: true,
        argumentExpressions: ["index + 1"],
        arguments: [scalar(2)],
        result: scalar(7),
      },
      {
        kind: "operation",
        source: { line: 2 },
        expression: "value - solve(index + 1)",
        operator: "subtract",
        operatorToken: "-",
        operationCategory: "arithmetic",
        operandExpressions: ["value", "solve(index + 1)"],
        operands: [scalar(10), scalar(7)],
        result: scalar(3),
      },
    ]));

    const { container } = render(
      <Visualizer scene={scene} loading={false} statusText="" />,
    );

    expect(container.querySelector(".operation-memo")).toHaveTextContent(
      "reuse solve(index + 1) -> 7",
    );
    expect(container.querySelector(".operation-operation")).toBeNull();
  });

  it("keeps the equation row at a fixed height beside causal flow", () => {
    const scene = compileScene(frame([{
      kind: "operation",
      source: { line: 2 },
      expression: "count + value",
      operator: "add",
      operatorToken: "+",
      operationCategory: "arithmetic",
      operandExpressions: ["count", "value"],
      operands: [scalar(2), scalar(5)],
      result: scalar(7),
    }]));

    const { container } = render(
      <Visualizer scene={scene} loading={false} statusText="" />,
    );

    expect(container.querySelector(".operation-list")).not.toBeNull();
    expect(
      readFileSync("packages/react/src/styles.css", "utf8"),
    ).toMatch(
      /\.operation-list[\s\S]*?height: 25px;[\s\S]*?max-height: 25px;[\s\S]*?overflow: hidden;/,
    );
  });

  it("does not surface literal-only iterator setup as an equation", () => {
    const scene = compileScene({
      ...frame([
        {
          kind: "iteration",
          source: { line: 2 },
          expression: "for end in range(limit - 1, 0, -1)",
          target: "end",
          iteratorExpression: "range(limit - 1, 0, -1)",
          iterationIndex: 0,
          loopKind: "for",
          result: scalar(4),
        },
        {
          kind: "operation",
          source: { line: 2 },
          expression: "-1",
          operator: "negate",
          operatorToken: "-",
          operationCategory: "arithmetic",
          operandExpressions: ["1"],
          operands: [scalar(1)],
          result: scalar(-1),
        },
      ]),
      locals: { end: scalar(4) },
    });

    const { container } = render(
      <Visualizer scene={scene} loading={false} statusText="" />,
    );

    expect(container.querySelector(".operation-operation")).toBeNull();
  });

  it("retains outgoing and incoming equations during the cross-fade", () => {
    vi.useFakeTimers();
    const first = compileScene(frame([{
      kind: "operation",
      source: { line: 2 },
      expression: "left + right",
      operator: "add",
      operatorToken: "+",
      operationCategory: "arithmetic",
      operandExpressions: ["left", "right"],
      operands: [scalar(2), scalar(5)],
      result: scalar(7),
    }]));
    const second = compileScene(frame([{
      kind: "operation",
      source: { line: 3 },
      expression: "total * scale",
      operator: "multiply",
      operatorToken: "*",
      operationCategory: "arithmetic",
      operandExpressions: ["total", "scale"],
      operands: [scalar(7), scalar(3)],
      result: scalar(21),
    }]));
    const { container, rerender } = render(
      <Visualizer scene={first} loading={false} statusText="" />,
    );

    rerender(<Visualizer scene={second} loading={false} statusText="" />);

    const equations = container.querySelectorAll(".operation");
    expect(equations).toHaveLength(2);
    expect(equations[0]).toHaveAttribute("data-operation-phase", "outgoing");
    expect(equations[0]).toHaveAttribute("aria-hidden", "true");
    expect(equations[1]).toHaveAttribute("data-operation-phase", "incoming");
    expect(equations[1]).toHaveAccessibleName(
      "Operation: 7 * 3 equals 21",
    );

    act(() => {
      vi.advanceTimersByTime(180);
    });
    expect(container.querySelectorAll(".operation")).toHaveLength(1);
    expect(container.querySelector(".operation")).toHaveAttribute(
      "data-operation-phase",
      "current",
    );
  });
});
