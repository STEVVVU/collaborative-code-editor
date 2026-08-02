import { describe, expect, it } from "vitest";
import {
  materializeExecutionState,
  materializeExecutionTimeline,
} from "./executionModel";
import type {
  ExecutionTrace,
  SerializedValue,
  TraceFrame,
} from "./types";

const scalar = (value: number): SerializedValue => ({
  kind: "scalar",
  type: "int",
  value,
});

describe("execution model", () => {
  it("materializes stable activation, parameter binding, and return facts", () => {
    const frame: TraceFrame = {
      index: 8,
      eventIndex: 12,
      event: "return",
      source: { line: 3 },
      functionName: "factorial",
      scopeId: "factorial:2",
      depth: 1,
      callStack: [
        {
          functionName: "factorial",
          scopeId: "factorial:1",
          line: 4,
          parameters: ["number"],
        },
        {
          functionName: "factorial",
          scopeId: "factorial:2",
          line: 3,
          parameters: ["number"],
        },
      ],
      ancestorScopes: [{
        functionName: "factorial",
        scopeId: "factorial:1",
        line: 4,
        parameters: ["number"],
        locals: { number: scalar(2) },
      }],
      locals: { number: scalar(1) },
      returnValue: scalar(1),
      stdout: "",
      changes: [],
      semanticEvents: [],
    };

    const state = materializeExecutionState(frame);
    expect(state).toMatchObject({
      schemaVersion: 2,
      stateVersionId: "state:12:factorial:2",
      activeActivationIds: ["factorial:1", "factorial:2"],
      activations: [
        {
          activationId: "factorial:1",
          status: "active",
          parameters: ["number"],
        },
        {
          activationId: "factorial:2",
          parentActivationId: "factorial:1",
          status: "returning",
          parameters: ["number"],
          returnValue: scalar(1),
        },
      ],
    });
    expect(state.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "binding",
        id: "binding:factorial:2:number",
        parameter: true,
      }),
      expect.objectContaining({
        kind: "return",
        id: "return:factorial:2:12",
        activationId: "factorial:2",
      }),
    ]));
  });

  it("retains yielded activations until they resume", () => {
    const baseFrame = {
      source: { line: 2 },
      functionName: "numbers",
      scopeId: "generator:1",
      depth: 1,
      callStack: [
        { functionName: "consume", scopeId: "consume:1", line: 7 },
        { functionName: "numbers", scopeId: "generator:1", line: 2 },
      ],
      ancestorScopes: [{
        functionName: "consume",
        scopeId: "consume:1",
        line: 7,
        locals: {},
      }],
      locals: { index: scalar(0) },
      stdout: "",
      changes: [],
      semanticEvents: [],
    } satisfies Omit<TraceFrame, "index" | "event">;
    const trace: ExecutionTrace = {
      irVersion: 2,
      source: "",
      runSpec: { mode: "function", entrypoint: "consume", arguments: [2] },
      frames: [
        {
          ...baseFrame,
          index: 0,
          eventIndex: 0,
          event: "yield",
          yieldValue: scalar(0),
        },
        {
          ...baseFrame,
          index: 1,
          eventIndex: 1,
          event: "resume",
        },
      ],
      steps: [
        {
          index: 0,
          frameIndex: 0,
          event: "yield",
          source: { line: 2 },
          functionName: "numbers",
          scopeId: "generator:1",
          depth: 1,
          callStack: baseFrame.callStack,
          semanticEvents: [],
        },
        {
          index: 1,
          frameIndex: 1,
          event: "resume",
          source: { line: 2 },
          functionName: "numbers",
          scopeId: "generator:1",
          depth: 1,
          callStack: baseFrame.callStack,
          semanticEvents: [],
        },
      ],
      stdout: "",
      durationMs: 1,
    };

    const timeline = materializeExecutionTimeline(trace);
    expect(timeline[0].activations.at(-1)).toMatchObject({
      activationId: "generator:1",
      status: "suspended",
      yieldValue: scalar(0),
    });
    expect(timeline[1].suspendedActivationIds).toEqual([]);
    expect(timeline[1].facts).toContainEqual(
      expect.objectContaining({
        kind: "lifecycle",
        event: "resume",
        activationId: "generator:1",
      }),
    );
  });

  it("links a callee return to the caller's observed result", () => {
    const callerStack = [
      { functionName: "solve", scopeId: "solve:1", line: 5 },
    ];
    const calleeStack = [
      ...callerStack,
      { functionName: "helper", scopeId: "helper:1", line: 2 },
    ];
    const trace: ExecutionTrace = {
      irVersion: 2,
      source: "",
      runSpec: { mode: "function", entrypoint: "solve", arguments: [] },
      frames: [
        {
          index: 0,
          eventIndex: 0,
          event: "return",
          source: { line: 2 },
          functionName: "helper",
          scopeId: "helper:1",
          depth: 1,
          callStack: calleeStack,
          ancestorScopes: [{
            ...callerStack[0],
            locals: {},
          }],
          locals: {},
          returnValue: scalar(7),
          stdout: "",
          changes: [],
          semanticEvents: [],
        },
        {
          index: 1,
          eventIndex: 1,
          event: "line",
          source: { line: 5 },
          functionName: "solve",
          scopeId: "solve:1",
          depth: 0,
          callStack: callerStack,
          locals: {},
          stdout: "",
          changes: [],
          semanticEvents: [{
            kind: "call",
            source: { line: 5 },
            expression: "helper()",
            callee: "helper",
            result: scalar(7),
          }],
        },
      ],
      steps: [
        {
          index: 0,
          frameIndex: 0,
          event: "return",
          source: { line: 2 },
          functionName: "helper",
          scopeId: "helper:1",
          depth: 1,
          callStack: calleeStack,
          semanticEvents: [],
        },
        {
          index: 1,
          frameIndex: 1,
          event: "line",
          source: { line: 5 },
          functionName: "solve",
          scopeId: "solve:1",
          depth: 0,
          callStack: callerStack,
          semanticEvents: [{
            kind: "call",
            source: { line: 5 },
            expression: "helper()",
            callee: "helper",
            result: scalar(7),
          }],
        },
      ],
      stdout: "",
      durationMs: 1,
    };

    const callerState = materializeExecutionTimeline(trace)[1];
    const call = callerState.facts.find(
      (fact) =>
        fact.kind === "semantic" &&
        fact.event.kind === "call",
    );
    expect(call).toMatchObject({
      kind: "semantic",
      event: {
        producerEventIds: [
          "lifecycle:0:helper:1:return",
        ],
      },
    });
    expect(callerState.facts).toContainEqual(
      expect.objectContaining({
        id: "lifecycle:0:helper:1:return",
        kind: "lifecycle",
      }),
    );
  });

  it("links a callee exception to the caller's thrown call", () => {
    const callerStack = [
      { functionName: "solve", scopeId: "solve:1", line: 5 },
    ];
    const calleeStack = [
      ...callerStack,
      { functionName: "helper", scopeId: "helper:1", line: 2 },
    ];
    const trace: ExecutionTrace = {
      irVersion: 2,
      source: "",
      runSpec: { mode: "function", entrypoint: "solve", arguments: [] },
      frames: [
        {
          index: 0,
          eventIndex: 0,
          event: "exception",
          source: { line: 2 },
          functionName: "helper",
          scopeId: "helper:1",
          depth: 1,
          callStack: calleeStack,
          ancestorScopes: [{ ...callerStack[0], locals: {} }],
          locals: {},
          exception: "ValueError: bad value",
          stdout: "",
          changes: [],
          semanticEvents: [],
        },
        {
          index: 1,
          eventIndex: 1,
          event: "exception",
          source: { line: 5 },
          functionName: "solve",
          scopeId: "solve:1",
          depth: 0,
          callStack: callerStack,
          locals: {},
          exception: "ValueError: bad value",
          stdout: "",
          changes: [],
          semanticEvents: [{
            kind: "call",
            phase: "throw",
            source: { line: 5 },
            expression: "helper()",
            callee: "helper",
            argumentExpressions: [],
            arguments: [],
            exception: "ValueError: bad value",
          }],
        },
      ],
      stdout: "",
      durationMs: 1,
    };

    const callerState = materializeExecutionTimeline(trace)[1];
    const thrownCall = callerState.facts.find(
      (fact) =>
        fact.kind === "semantic" &&
        fact.event.kind === "call",
    );
    expect(thrownCall).toMatchObject({
      kind: "semantic",
      event: {
        phase: "throw",
        producerEventIds: [
          "lifecycle:0:helper:1:exception",
        ],
      },
    });
    expect(callerState.facts).toContainEqual(
      expect.objectContaining({
        id: "lifecycle:0:helper:1:exception",
        kind: "lifecycle",
      }),
    );
  });
});
