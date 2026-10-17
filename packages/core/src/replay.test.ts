import { describe, expect, it } from "vitest";
import {
  createReplayFile,
  parseReplay,
  serializeReplay,
} from "./replay";
import type { ExecutionTrace } from "./types";

const trace: ExecutionTrace = {
  source: "def double(value):\n    return value * 2\n",
  runSpec: {
    mode: "function",
    entrypoint: "double",
    arguments: [5],
  },
  frames: [
    {
      index: 0,
      event: "return",
      source: { line: 2 },
      functionName: "double",
      scopeId: "frame:1",
      depth: 1,
      callStack: [
        { functionName: "double", scopeId: "frame:1", line: 2 },
      ],
      locals: {
        value: { kind: "scalar", type: "int", value: 5 },
      },
      stdout: "",
      changes: [],
      semanticEvents: [],
      returnValue: { kind: "scalar", type: "int", value: 10 },
    },
  ],
  stdout: "",
  durationMs: 4.2,
};

describe("trace replay files", () => {
  it("round-trips a versioned execution trace", () => {
    const replay = parseReplay(serializeReplay(trace));
    expect(replay).toMatchObject({
      format: "traceframe-replay",
      version: 1,
      trace,
    });
  });

  it("supports deterministic creation metadata", () => {
    expect(createReplayFile(trace, "2026-08-01T20:00:00.000Z").createdAt).toBe(
      "2026-08-01T20:00:00.000Z",
    );
  });

  it("round-trips persistent bindings and rejects unknown binding names", () => {
    const persistentTrace = structuredClone(trace);
    persistentTrace.frames[0].persistentBindings = ["value"];
    expect(
      parseReplay(serializeReplay(persistentTrace)).trace.frames[0]
        .persistentBindings,
    ).toEqual(["value"]);

    const replay = createReplayFile(persistentTrace);
    replay.trace.frames[0].persistentBindings = ["missing"];
    expect(() => parseReplay(JSON.stringify(replay))).toThrow(
      "persistent bindings must reference frame locals",
    );
  });

  it("round-trips normalized primitive operations", () => {
    const operationTrace = structuredClone(trace);
    operationTrace.frames[0].semanticEvents = [{
      kind: "operation",
      source: { line: 2 },
      expression: "value * 2",
      operator: "multiply",
      operatorToken: "*",
      operationCategory: "arithmetic",
      operandExpressions: ["value", "2"],
      operands: [
        { kind: "scalar", type: "int", value: 5 },
        { kind: "scalar", type: "int", value: 2 },
      ],
      result: { kind: "scalar", type: "int", value: 10 },
    }];

    const [operation] =
      parseReplay(serializeReplay(operationTrace)).trace.frames[0]
        .semanticEvents;
    expect(operation).toMatchObject(operationTrace.frames[0].semanticEvents[0]);
    expect(operation).toMatchObject({
      id: "event:0:semantic:0",
      activationId: "frame:1",
      actorId: "main",
      actorSequence: 0,
      happensAfter: [],
      provenance: "observed",
    });
  });

  it("round-trips thrown calls without inventing a result", () => {
    const thrownTrace = structuredClone(trace);
    thrownTrace.frames[0].event = "exception";
    thrownTrace.frames[0].exception = "ValueError: bad value";
    delete thrownTrace.frames[0].returnValue;
    thrownTrace.frames[0].semanticEvents = [{
      kind: "call",
      phase: "throw",
      source: { line: 2 },
      expression: "helper()",
      callee: "helper",
      argumentExpressions: [],
      arguments: [],
      exception: "ValueError: bad value",
    }];

    const replay = parseReplay(serializeReplay(thrownTrace));
    expect(replay.trace.frames[0].semanticEvents[0]).toMatchObject({
      kind: "call",
      phase: "throw",
      exception: "ValueError: bad value",
    });
    expect(replay.trace.frames[0].event).toBe("exception");
  });

  it("round-trips memo events and requires cache metadata", () => {
    const memoTrace = structuredClone(trace);
    memoTrace.frames[0].semanticEvents = [{
      kind: "memo",
      source: { line: 2 },
      expression: "solve(index)",
      callee: "solve",
      cacheHit: true,
      argumentExpressions: ["index"],
      arguments: [{
        kind: "scalar",
        type: "int",
        value: 2,
      }],
      result: {
        kind: "scalar",
        type: "int",
        value: 7,
      },
    }];

    const replay = JSON.parse(serializeReplay(memoTrace)) as {
      trace: { frames: Array<{ semanticEvents: Array<Record<string, unknown>> }> };
    };
    const [memo] =
      parseReplay(JSON.stringify(replay)).trace.frames[0].semanticEvents;
    expect(memo).toMatchObject(memoTrace.frames[0].semanticEvents[0]);
    expect(memo).toMatchObject({
      id: "event:0:semantic:0",
      activationId: "frame:1",
      provenance: "observed",
    });

    delete replay.trace.frames[0].semanticEvents[0].cacheHit;
    expect(() => parseReplay(JSON.stringify(replay))).toThrow(
      "memo cache status is missing",
    );
  });

  it("rejects malformed primitive operation metadata", () => {
    const replay = createReplayFile(structuredClone(trace));
    replay.trace.frames[0].semanticEvents = [{
      kind: "operation",
      source: { line: 2 },
      expression: "value * 2",
      operator: "multiply",
      operatorToken: "*",
      operationCategory: "arithmetic",
    }];
    const malformed = replay as unknown as {
      trace: { frames: Array<{ semanticEvents: Array<Record<string, unknown>> }> };
    };
    malformed.trace.frames[0].semanticEvents[0].operationCategory = "numeric";

    expect(() => parseReplay(JSON.stringify(malformed))).toThrow(
      "semantic operation category is invalid",
    );

    malformed.trace.frames[0].semanticEvents[0].operationCategory = "arithmetic";
    delete malformed.trace.frames[0].semanticEvents[0].operands;
    expect(() => parseReplay(JSON.stringify(malformed))).toThrow(
      "semantic operation operands are invalid",
    );
  });

  it("requires adapter-authored operation tokens and event-specific fields", () => {
    const replay = createReplayFile(structuredClone(trace));
    const event = {
      kind: "operation",
      source: { line: 2 },
      expression: "value * 2",
      operator: "multiply",
      operatorToken: "*",
      operationCategory: "arithmetic",
      operandExpressions: ["value", "2"],
      operands: [
        { kind: "scalar", type: "int", value: 5 },
        { kind: "scalar", type: "int", value: 2 },
      ],
      result: { kind: "scalar", type: "int", value: 10 },
    };
    replay.trace.frames[0].semanticEvents = [event];
    const malformed = replay as unknown as {
      trace: { frames: Array<{ semanticEvents: Array<Record<string, unknown>> }> };
    };

    malformed.trace.frames[0].semanticEvents[0].operatorToken = "times";
    expect(() => parseReplay(JSON.stringify(malformed))).toThrow(
      "semantic operation token is invalid",
    );

    malformed.trace.frames[0].semanticEvents[0].operatorToken = "*";
    malformed.trace.frames[0].semanticEvents = [{
      kind: "write",
      source: { line: 2 },
      expression: "value = 10",
      result: { kind: "scalar", type: "int", value: 10 },
    }];
    expect(() => parseReplay(JSON.stringify(malformed))).toThrow(
      "write target is missing",
    );

    malformed.trace.frames[0].semanticEvents = [{
      kind: "iteration",
      source: { line: 2 },
      expression: "for value in values",
      target: "value",
      iterationIndex: 0,
      loopKind: "for",
    }];
    expect(() => parseReplay(JSON.stringify(malformed))).toThrow(
      "iteration iterator expression is missing",
    );
  });

  it("round-trips optional versioned projection contracts and accepts legacy replays", () => {
    const contracted = {
      ...trace,
      runSpec: {
        ...trace.runSpec,
        projectionContracts: {
          version: 1 as const,
          declarations: [{
            id: "graph",
            target: {
              root: { kind: "binding" as const, name: "graph" },
              segments: [{ kind: "each" as const }],
            },
            configuration: {
              kind: "graph" as const,
              representation: "adjacency-list" as const,
              directed: true,
            },
          }],
        },
      },
    };
    expect(parseReplay(serializeReplay(contracted)).trace.runSpec).toMatchObject(
      contracted.runSpec,
    );
    expect(parseReplay(serializeReplay(trace)).trace.runSpec).not.toHaveProperty(
      "projectionContracts",
    );
  });

  it("rejects duplicate and malformed projection contracts", () => {
    const replay = createReplayFile({
      ...trace,
      runSpec: {
        ...trace.runSpec,
        projectionContracts: {
          version: 1,
          declarations: [{
            id: "duplicate",
            target: { root: { kind: "binding", name: "graph" }, segments: [] },
            configuration: {
              kind: "graph",
              representation: "adjacency-list",
              directed: false,
            },
          }, {
            id: "duplicate",
            target: { root: { kind: "binding", name: "other" }, segments: [] },
            configuration: {
              kind: "graph",
              representation: "adjacency-list",
              directed: false,
            },
          }],
        },
      },
    });
    expect(() => parseReplay(JSON.stringify(replay))).toThrow(
      "Duplicate projection contract id",
    );

    const conflicting = structuredClone(replay);
    const declarations =
      conflicting.trace.runSpec.projectionContracts!.declarations;
    declarations[1] = {
      ...declarations[1],
      id: "child",
      target: {
        root: { kind: "binding", name: "graph" },
        segments: [{ kind: "index", index: 0 }],
      },
    };
    expect(() => parseReplay(JSON.stringify(conflicting))).toThrow(
      "Conflicting projection contract target",
    );
  });

  it("validates projection contract versions, targets, segments, and graph configuration", () => {
    const invalidVersion = {
      ...createReplayFile(trace),
      trace: {
        ...trace,
        runSpec: {
          ...trace.runSpec,
          projectionContracts: { version: 2, declarations: [] },
        },
      },
    };
    expect(() => parseReplay(JSON.stringify(invalidVersion))).toThrow(
      "Projection contracts must use version 1 with declarations",
    );

    const invalidBinding = {
      ...createReplayFile(trace),
      trace: {
        ...trace,
        runSpec: {
          ...trace.runSpec,
          projectionContracts: {
            version: 1,
            declarations: [{
              id: "invalid-binding",
              target: { root: { kind: "binding", name: "not valid" }, segments: [] },
              configuration: {
                kind: "graph",
                representation: "adjacency-list",
                directed: true,
              },
            }],
          },
        },
      },
    };
    expect(() => parseReplay(JSON.stringify(invalidBinding))).toThrow(
      "invalid binding target",
    );

    const invalidSegment = {
      ...createReplayFile(trace),
      trace: {
        ...trace,
        runSpec: {
          ...trace.runSpec,
          projectionContracts: {
            version: 1,
            declarations: [{
              id: "invalid-segment",
              target: {
                root: { kind: "binding", name: "graph" },
                segments: [{ kind: "index", index: -1 }],
              },
              configuration: {
                kind: "graph",
                representation: "adjacency-list",
                directed: true,
              },
            }],
          },
        },
      },
    };
    expect(() => parseReplay(JSON.stringify(invalidSegment))).toThrow(
      "invalid index segment",
    );

    const invalidGraphConfiguration = {
      ...createReplayFile(trace),
      trace: {
        ...trace,
        runSpec: {
          ...trace.runSpec,
          projectionContracts: {
            version: 1,
            declarations: [{
              id: "invalid-graph",
              target: { root: { kind: "binding", name: "graph" }, segments: [] },
              configuration: {
                kind: "graph",
                representation: "adjacency-list",
                directed: "yes",
              },
            }],
          },
        },
      },
    };
    expect(() => parseReplay(JSON.stringify(invalidGraphConfiguration))).toThrow(
      "invalid graph configuration",
    );
  });

  it("rejects malformed JSON and unsupported versions", () => {
    expect(() => parseReplay("{")).toThrow("not valid JSON");
    expect(() =>
      parseReplay(
        JSON.stringify({
          ...createReplayFile(trace),
          version: 2,
        }),
      ),
    ).toThrow("version is not supported");
  });

  it("rejects malformed values and noncontiguous frame indices", () => {
    const badIndex = createReplayFile({
      ...trace,
      frames: [{ ...trace.frames[0], index: 4 }],
    });
    expect(() => parseReplay(JSON.stringify(badIndex))).toThrow(
      "frame indices must be contiguous",
    );

    const badValue = createReplayFile({
      ...trace,
      frames: [
        {
          ...trace.frames[0],
          locals: {
            value: { kind: "mystery", type: "int" } as never,
          },
        },
      ],
    });
    expect(() => parseReplay(JSON.stringify(badValue))).toThrow(
      "unknown serialized value kind",
    );
  });

  it("validates every replay step call stack entry and semantic event", () => {
    const replay = createReplayFile({
      ...trace,
      steps: [{
        index: 0,
        event: "return",
        source: { line: 2 },
        functionName: "double",
        scopeId: "frame:1",
        depth: 1,
        callStack: [{
          functionName: "double",
          scopeId: "frame:1",
          line: 2,
        }],
        semanticEvents: [],
        frameIndex: 0,
      }],
    });
    const malformed = replay as unknown as {
      trace: {
        steps: Array<{
          callStack: Array<{ line: unknown }>;
          semanticEvents: unknown;
        }>;
      };
    };
    malformed.trace.steps[0].callStack[0].line = "2";

    expect(() => parseReplay(JSON.stringify(malformed))).toThrow(
      "call stack line is invalid",
    );

    malformed.trace.steps[0].callStack[0].line = 2;
    malformed.trace.steps[0].semanticEvents = {};
    expect(() => parseReplay(JSON.stringify(malformed))).toThrow(
      "step semantic events must be an array",
    );
  });

  it("normalizes legacy v1 steps without semantic events", () => {
    const replay = createReplayFile({
      ...trace,
      steps: [{
        index: 0,
        event: "return",
        source: { line: 2 },
        functionName: "double",
        scopeId: "frame:1",
        depth: 1,
        callStack: [],
        semanticEvents: [],
        frameIndex: 0,
      }],
    });
    const legacy = replay as unknown as {
      trace: { steps: Array<Record<string, unknown>> };
    };
    delete legacy.trace.steps[0].semanticEvents;

    expect(parseReplay(JSON.stringify(legacy)).trace.steps?.[0].semanticEvents)
      .toEqual([]);

    legacy.trace.steps[0].semanticEvents = [{
      kind: "operation",
      source: { line: 2 },
      expression: "value * 2",
      operator: "multiply",
      operatorToken: "times",
      operationCategory: "arithmetic",
      operandExpressions: ["value", "2"],
      operands: [
        { kind: "scalar", type: "int", value: 5 },
        { kind: "scalar", type: "int", value: 2 },
      ],
      result: { kind: "scalar", type: "int", value: 10 },
    }];
    expect(() => parseReplay(JSON.stringify(legacy))).toThrow(
      "semantic operation token is invalid",
    );
  });
});
