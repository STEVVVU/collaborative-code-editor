import { describe, expect, it } from "vitest";
import type { ExecutionTrace } from "./types";
import {
  debuggerStepCount,
  debuggerStepForFrame,
  expandSemanticSteps,
  materializeDebuggerStep,
} from "./debugger";

const trace: ExecutionTrace = {
  source: "value = 1",
  runSpec: { mode: "script" },
  frames: [
    {
      index: 0,
      eventIndex: 0,
      event: "call",
      source: { line: 1 },
      functionName: "<module>",
      scopeId: "module",
      depth: 0,
      callStack: [],
      locals: {},
      stdout: "",
      changes: [],
      semanticEvents: [],
    },
    {
      index: 1,
      eventIndex: 3,
      event: "line",
      source: { line: 3 },
      functionName: "solve",
      scopeId: "solve",
      depth: 0,
      callStack: [],
      locals: {
        value: { kind: "scalar", type: "int", value: 1 },
      },
      stdout: "",
      changes: [],
      semanticEvents: [],
    },
  ],
  steps: [
    {
      index: 0,
      event: "call",
      source: { line: 1 },
      functionName: "solve",
      scopeId: "solve",
      depth: 0,
      callStack: [],
      semanticEvents: [],
      frameIndex: 0,
    },
    {
      index: 1,
      event: "line",
      source: { line: 2 },
      functionName: "solve",
      scopeId: "solve",
      depth: 0,
      callStack: [],
      semanticEvents: [{
        kind: "read",
        source: { line: 2 },
        expression: "value",
      }],
      frameIndex: 0,
    },
    {
      index: 2,
      event: "line",
      source: { line: 3 },
      functionName: "solve",
      scopeId: "solve",
      depth: 0,
      callStack: [],
      semanticEvents: [],
      frameIndex: 1,
    },
  ],
  stdout: "",
  durationMs: 1,
};

describe("debugger recording playback", () => {
  it("uses exact debugger steps as the playback clock", () => {
    expect(debuggerStepCount(trace)).toBe(3);
    expect(materializeDebuggerStep(trace, 1)).toMatchObject({
      index: 1,
      source: { line: 2 },
      functionName: "solve",
      locals: {},
      semanticEvents: [{
        kind: "read",
        source: { line: 2 },
        expression: "value",
      }],
    });
  });

  it("maps retained snapshots back to their first debugger step", () => {
    expect(debuggerStepForFrame(trace, 1)).toBe(2);
  });

  it("turns completed semantics into source-aligned playback steps", () => {
    const operation = {
      kind: "operation" as const,
      source: { line: 3 },
      expression: "nums[0] + nums[1]",
      operator: "add",
      operatorToken: "+",
      operationCategory: "arithmetic" as const,
      operandExpressions: ["nums[0]", "nums[1]"],
      operands: [
        { kind: "scalar" as const, type: "int", value: 3 },
        { kind: "scalar" as const, type: "int", value: 8 },
      ],
      result: { kind: "scalar" as const, type: "int", value: 11 },
    };
    const callStack = [{
      functionName: "calculate",
      scopeId: "calculate",
      line: 3,
    }];
    const expanded = expandSemanticSteps([
      {
        index: 3,
        event: "line",
        source: { line: 3 },
        functionName: "calculate",
        scopeId: "calculate",
        depth: 0,
        callStack,
        semanticEvents: [],
        frameIndex: 1,
      },
      {
        index: 4,
        event: "line",
        source: { line: 4 },
        functionName: "calculate",
        scopeId: "calculate",
        depth: 0,
        callStack: [{ ...callStack[0], line: 4 }],
        semanticEvents: [operation],
        frameIndex: 2,
      },
    ]);

    expect(expanded).toHaveLength(2);
    expect(expanded[0]).toMatchObject({
      index: 0,
      event: "line",
      source: { line: 3 },
      callStack: [{ line: 3 }],
      semanticEvents: [operation],
      frameIndex: 2,
    });
    expect(expanded[1]).toMatchObject({
      index: 1,
      source: { line: 4 },
      semanticEvents: [],
      frameIndex: 2,
    });
  });

  it("keeps loop-owned visual bindings active across operation substeps", () => {
    const iteration = {
      kind: "iteration" as const,
      source: { line: 2 },
      expression: "for index in range(len(nums))",
      target: "index",
      iteratorExpression: "range(len(nums))",
      iterationIndex: 1,
      loopKind: "for" as const,
      accessExpressions: ["nums[index]", "nums[index + 1]"],
      result: { kind: "scalar" as const, type: "int", value: 1 },
    };
    const comparison = {
      kind: "compare" as const,
      source: { line: 3 },
      expression: "nums[index] > nums[index + 1]",
      result: { kind: "scalar" as const, type: "bool", value: true },
    };
    const expanded = expandSemanticSteps([{
      index: 0,
      event: "line",
      source: { line: 4 },
      functionName: "sort",
      scopeId: "sort:1",
      depth: 0,
      callStack: [],
      semanticEvents: [iteration, comparison],
      frameIndex: 0,
    }]);

    expect(expanded).toHaveLength(3);
    expect(expanded.every((step) =>
      step.activeVisualEvents?.includes(iteration)
    )).toBe(true);
  });

  it("does not append an empty duplicate of a semantic line", () => {
    const access = {
      kind: "read" as const,
      source: { line: 3 },
      expression: "values[index]",
      accessVariables: ["index"],
      result: { kind: "scalar" as const, type: "int", value: 8 },
    };
    const expanded = expandSemanticSteps([{
      index: 0,
      event: "line",
      source: { line: 3 },
      functionName: "lookup",
      scopeId: "lookup:1",
      depth: 0,
      callStack: [{
        functionName: "lookup",
        scopeId: "lookup:1",
        line: 3,
      }],
      semanticEvents: [access],
      frameIndex: 0,
    }]);

    expect(expanded).toHaveLength(1);
    expect(expanded[0].semanticEvents).toEqual([access]);
  });

  it("removes consecutive empty steps with identical visible state", () => {
    const base: TraceStep = {
      index: 0,
      event: "line",
      source: { line: 3 },
      functionName: "lookup",
      scopeId: "lookup:1",
      depth: 0,
      callStack: [{
        functionName: "lookup",
        scopeId: "lookup:1",
        line: 3,
      }],
      semanticEvents: [],
      frameIndex: 0,
    };

    expect(expandSemanticSteps([
      base,
      { ...base, index: 1 },
    ])).toHaveLength(1);
  });

  it("keeps ordinary variable bindings until their scope returns", () => {
    const access = {
      kind: "read" as const,
      source: { line: 2 },
      expression: "values[selected]",
      accessVariables: ["selected"],
      result: { kind: "scalar" as const, type: "int", value: 8 },
    };
    const expanded = expandSemanticSteps([
      {
        index: 0,
        event: "line",
        source: { line: 3 },
        functionName: "lookup",
        scopeId: "lookup:1",
        depth: 0,
        callStack: [],
        semanticEvents: [access],
        frameIndex: 0,
      },
      {
        index: 1,
        event: "line",
        source: { line: 4 },
        functionName: "lookup",
        scopeId: "lookup:1",
        depth: 0,
        callStack: [],
        semanticEvents: [],
        frameIndex: 1,
      },
      {
        index: 2,
        event: "return",
        source: { line: 4 },
        functionName: "lookup",
        scopeId: "lookup:1",
        depth: 0,
        callStack: [],
        semanticEvents: [],
        frameIndex: 1,
      },
      {
        index: 3,
        event: "call",
        source: { line: 1 },
        functionName: "lookup",
        scopeId: "lookup:1",
        depth: 0,
        callStack: [],
        semanticEvents: [],
        frameIndex: 2,
      },
    ]);

    expect(expanded[2].activeVisualEvents).toEqual([access]);
    expect(expanded.at(-1)?.activeVisualEvents).toEqual([]);
  });

  it("supports recordings created before debugger steps were introduced", () => {
    const legacy = { ...trace, steps: undefined };
    expect(debuggerStepCount(legacy)).toBe(2);
    expect(materializeDebuggerStep(legacy, 1)).toBe(legacy.frames[1]);
  });
});
