import { parseFunctionRunSpec, validateProjectionContracts } from "./run";
import { upgradeExecutionTrace } from "./traceUpgrade";
import type {
  ExecutionTrace,
  JsonValue,
  RunSpec,
  SemanticEvent,
  SerializedValue,
  TraceFrame,
  ValueChange,
} from "./types";

const REPLAY_FORMAT = "traceframe-replay";
const REPLAY_VERSION = 1;
const OPERATOR_METADATA: Record<string, {
  token: string;
  category: SemanticEvent["operationCategory"];
}> = {
  add: { token: "+", category: "arithmetic" },
  subtract: { token: "-", category: "arithmetic" },
  multiply: { token: "*", category: "arithmetic" },
  divide: { token: "/", category: "arithmetic" },
  "floor-divide": { token: "//", category: "arithmetic" },
  modulo: { token: "%", category: "arithmetic" },
  power: { token: "**", category: "arithmetic" },
  "matrix-multiply": { token: "@", category: "arithmetic" },
  "shift-left": { token: "<<", category: "bitwise" },
  "shift-right": { token: ">>", category: "bitwise" },
  "bitwise-or": { token: "|", category: "bitwise" },
  "bitwise-xor": { token: "^", category: "bitwise" },
  "bitwise-and": { token: "&", category: "bitwise" },
  "bitwise-not": { token: "~", category: "bitwise" },
  negate: { token: "-", category: "arithmetic" },
};

export interface ReplayFile {
  format: typeof REPLAY_FORMAT;
  version: typeof REPLAY_VERSION;
  createdAt: string;
  trace: ExecutionTrace;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Invalid replay: ${message}`);
  }
}

function validateSerializedValue(value: unknown, depth = 0): asserts value is SerializedValue {
  assert(depth <= 20, "serialized value nesting is too deep");
  assert(isRecord(value), "serialized value must be an object");
  assert(typeof value.kind === "string", "serialized value kind is missing");
  assert(typeof value.type === "string", "serialized value type is missing");

  if (value.kind === "scalar") {
    assert(
      value.value === null ||
        ["string", "number", "boolean"].includes(typeof value.value),
      "scalar value is invalid",
    );
    return;
  }
  if (value.kind === "sequence" || value.kind === "set") {
    assert(typeof value.id === "string", `${value.kind} identity is missing`);
    assert(Array.isArray(value.items), `${value.kind} items must be an array`);
    value.items.forEach((item) => validateSerializedValue(item, depth + 1));
    if (value.kind === "set" && value.itemIds !== undefined) {
      assert(
        Array.isArray(value.itemIds) &&
          value.itemIds.length === value.items.length &&
          value.itemIds.every((id) => typeof id === "string"),
        "set member identities are invalid",
      );
    }
    return;
  }
  if (value.kind === "mapping") {
    assert(typeof value.id === "string", "mapping identity is missing");
    assert(Array.isArray(value.entries), "mapping entries must be an array");
    value.entries.forEach((entry) => {
      assert(Array.isArray(entry) && entry.length === 2, "mapping entry is invalid");
      validateSerializedValue(entry[0], depth + 1);
      validateSerializedValue(entry[1], depth + 1);
    });
    if (value.entryIds !== undefined) {
      assert(
        Array.isArray(value.entryIds) &&
          value.entryIds.length === value.entries.length &&
          value.entryIds.every((id) => typeof id === "string"),
        "mapping entry identities are invalid",
      );
    }
    return;
  }
  if (value.kind === "object") {
    assert(typeof value.id === "string", "object identity is missing");
    assert(isRecord(value.fields), "object fields must be an object");
    Object.values(value.fields).forEach((field) =>
      validateSerializedValue(field, depth + 1),
    );
    return;
  }
  if (value.kind === "reference") {
    assert(typeof value.targetId === "string", "reference target is missing");
    return;
  }
  if (value.kind === "truncated") {
    assert(
      ["depth", "size", "unsupported"].includes(String(value.reason)),
      "truncation reason is invalid",
    );
    assert(typeof value.preview === "string", "truncation preview is missing");
    return;
  }
  throw new Error(`Invalid replay: unknown serialized value kind '${value.kind}'`);
}

function validateRunSpec(value: unknown): asserts value is RunSpec {
  assert(isRecord(value), "run specification must be an object");
  if (value.mode === "script") {
    if (value.projectionContracts !== undefined) {
      validateProjectionContracts(value.projectionContracts);
    }
    return;
  }
  assert(value.mode === "function", "run mode is invalid");
  assert(typeof value.entrypoint === "string", "entry point is missing");
  assert(Array.isArray(value.arguments), "function arguments must be an array");
  parseFunctionRunSpec(
    value.entrypoint,
    JSON.stringify(value.arguments as JsonValue[]),
    value.projectionContracts,
  );
}

function validateChange(value: unknown): asserts value is ValueChange {
  assert(isRecord(value), "state change must be an object");
  assert(typeof value.path === "string", "state change path is missing");
  assert(
    ["created", "updated", "removed"].includes(String(value.kind)),
    "state change kind is invalid",
  );
  if (value.before !== undefined) {
    validateSerializedValue(value.before);
  }
  if (value.after !== undefined) {
    validateSerializedValue(value.after);
  }
  if (value.location !== undefined) {
    validateRuntimeLocation(value.location);
  }
  if (value.before !== undefined) {
    validateSerializedValue(value.before);
  }
}

function validateRuntimeLocation(value: unknown): void {
  assert(isRecord(value), "runtime location must be an object");
  if (value.kind === "binding") {
    assert(typeof value.activationId === "string", "binding activation is invalid");
    assert(typeof value.name === "string", "binding name is invalid");
    return;
  }
  if (value.kind === "field") {
    assert(typeof value.objectId === "string", "field object is invalid");
    assert(typeof value.name === "string", "field name is invalid");
    return;
  }
  if (value.kind === "index") {
    assert(typeof value.containerId === "string", "index container is invalid");
    assert(Number.isInteger(value.index), "index value is invalid");
    return;
  }
  if (value.kind === "mapping-entry") {
    assert(typeof value.mappingId === "string", "mapping identity is invalid");
    assert(typeof value.entryId === "string", "mapping entry identity is invalid");
    assert(["key", "value"].includes(String(value.part)), "mapping entry part is invalid");
    return;
  }
  if (value.kind === "set-member") {
    assert(typeof value.setId === "string", "set identity is invalid");
    assert(typeof value.memberId === "string", "set member identity is invalid");
    return;
  }
  if (value.kind === "identity") {
    assert(typeof value.objectId === "string", "object identity location is invalid");
    return;
  }
  if (value.kind === "expression") {
    assert(typeof value.activationId === "string", "expression activation is invalid");
    assert(typeof value.expression === "string", "expression location is invalid");
    return;
  }
  throw new Error(`Invalid replay: unknown runtime location '${String(value.kind)}'`);
}

function validateCallStackEntry(
  value: unknown,
): asserts value is TraceFrame["callStack"][number] {
  assert(isRecord(value), "call stack entry must be an object");
  assert(
    typeof value.functionName === "string",
    "call stack function name is missing",
  );
  assert(typeof value.scopeId === "string", "call stack scope identity is missing");
  assert(Number.isInteger(value.line), "call stack line is invalid");
  if (value.parameters !== undefined) {
    assert(
      Array.isArray(value.parameters) &&
        value.parameters.every((parameter) => typeof parameter === "string"),
      "call stack parameters are invalid",
    );
  }
}

function validateSemanticEvent(value: unknown): asserts value is SemanticEvent {
  assert(isRecord(value), "semantic event must be an object");
  assert(
    ["read", "call", "memo", "operation", "write", "swap", "compare", "branch", "iteration", "mutation", "yield", "resume", "exception"].includes(
      String(value.kind),
    ),
    "semantic event kind is invalid",
  );
  assert(isRecord(value.source), "semantic event source is missing");
  assert(Number.isInteger(value.source.line), "semantic event line is invalid");
  assert(typeof value.expression === "string", "semantic event expression is missing");
  if (value.id !== undefined) {
    assert(typeof value.id === "string", "semantic event identity is invalid");
  }
  if (value.activationId !== undefined) {
    assert(typeof value.activationId === "string", "semantic activation is invalid");
  }
  if (value.exceptionId !== undefined) {
    assert(typeof value.exceptionId === "string", "semantic exception identity is invalid");
  }
  validateCausalOrder(value, "semantic event");
  if (value.provenance !== undefined) {
    assert(
      ["observed", "derived", "declared", "unknown", "truncated"].includes(
        String(value.provenance),
      ),
      "semantic provenance is invalid",
    );
  }
  if (value.location !== undefined) {
    validateRuntimeLocation(value.location);
  }
  if (value.sourceLocations !== undefined) {
    assert(Array.isArray(value.sourceLocations), "semantic source locations are invalid");
    value.sourceLocations.forEach(validateRuntimeLocation);
  }
  if (value.operator !== undefined) {
    assert(typeof value.operator === "string", "semantic operator is invalid");
  }
  if (value.operatorToken !== undefined) {
    assert(typeof value.operatorToken === "string", "semantic operator token is invalid");
  }
  if (value.operationCategory !== undefined) {
    assert(
      ["arithmetic", "bitwise", "logical"].includes(
        String(value.operationCategory),
      ),
      "semantic operation category is invalid",
    );
  }
  if (value.operandExpressions !== undefined) {
    assert(
      Array.isArray(value.operandExpressions) &&
        value.operandExpressions.every((item) => typeof item === "string"),
      "semantic operand expressions are invalid",
    );
  }
  if (value.argumentExpressions !== undefined) {
    assert(
      Array.isArray(value.argumentExpressions) &&
        value.argumentExpressions.every((item) => typeof item === "string"),
      "call argument expressions are invalid",
    );
  }
  if (value.operands !== undefined) {
    assert(Array.isArray(value.operands), "semantic operands must be an array");
    value.operands.forEach((operand) => validateSerializedValue(operand));
  }
  if (value.kind === "operation") {
    assert(typeof value.operator === "string", "semantic operation operator is missing");
    const metadata = OPERATOR_METADATA[value.operator];
    assert(
      typeof value.operatorToken === "string" &&
        metadata?.token === value.operatorToken &&
        metadata.category === value.operationCategory,
      "semantic operation token is invalid",
    );
    assert(
      value.operationCategory !== undefined,
      "semantic operation category is missing",
    );
    assert(
      Array.isArray(value.operandExpressions) &&
        Array.isArray(value.operands) &&
        value.operandExpressions.length === value.operands.length,
      "semantic operation operands are invalid",
    );
    assert(value.result !== undefined, "semantic operation result is missing");
  }
  if (value.kind === "read" || value.kind === "compare") {
    assert(value.result !== undefined, `${value.kind} result is missing`);
  }
  if (value.kind === "call") {
    assert(typeof value.callee === "string", "call callee is missing");
    assert(
      Array.isArray(value.argumentExpressions) &&
        Array.isArray(value.arguments) &&
        value.argumentExpressions.length === value.arguments.length,
      "call arguments are invalid",
    );
    if (value.phase === "throw") {
      assert(typeof value.exception === "string", "thrown call exception is missing");
    } else {
      assert(value.result !== undefined, "call result is missing");
    }
  }
  if (value.kind === "memo") {
    assert(typeof value.callee === "string", "memo callee is missing");
    assert(typeof value.cacheHit === "boolean", "memo cache status is missing");
    assert(
      Array.isArray(value.argumentExpressions) &&
        Array.isArray(value.arguments),
      "memo arguments are invalid",
    );
    if (value.phase === "throw") {
      assert(typeof value.exception === "string", "thrown memo exception is missing");
    } else {
      assert(value.result !== undefined, "memo result is missing");
    }
  }
  if (value.kind === "write" || value.kind === "swap") {
    assert(typeof value.target === "string", `${value.kind} target is missing`);
    assert(value.result !== undefined, `${value.kind} result is missing`);
  }
  if (value.kind === "branch") {
    assert(value.result !== undefined, "branch result is missing");
  }
  if (value.kind === "iteration") {
    assert(typeof value.target === "string", "iteration target is missing");
    assert(
      typeof value.iteratorExpression === "string",
      "iteration iterator expression is missing",
    );
    assert(
      typeof value.iterationIndex === "number" &&
        Number.isInteger(value.iterationIndex) &&
        value.iterationIndex >= 0,
      "iteration index is missing",
    );
    assert(
      value.loopKind === "for" || value.loopKind === "while",
      "iteration loop kind is missing",
    );
  }
  if (value.arguments !== undefined) {
    assert(Array.isArray(value.arguments), "call arguments must be an array");
    value.arguments.forEach((argument) => validateSerializedValue(argument));
  }
  if (value.callee !== undefined) {
    assert(typeof value.callee === "string", "call callee is invalid");
  }
  if (value.cacheHit !== undefined) {
    assert(typeof value.cacheHit === "boolean", "memo cache status is invalid");
  }
  if (value.iteratorExpression !== undefined) {
    assert(
      typeof value.iteratorExpression === "string",
      "iterator expression is invalid",
    );
  }
  if (value.iterationIndex !== undefined) {
    assert(
      typeof value.iterationIndex === "number" &&
        Number.isInteger(value.iterationIndex) &&
        value.iterationIndex >= 0,
      "iteration index is invalid",
    );
  }
  if (value.loopKind !== undefined) {
    assert(
      value.loopKind === "for" || value.loopKind === "while",
      "loop kind is invalid",
    );
  }
  if (value.accessExpressions !== undefined) {
    assert(
      Array.isArray(value.accessExpressions) &&
        value.accessExpressions.every((item) => typeof item === "string"),
      "variable access expressions are invalid",
    );
  }
  if (value.accessVariables !== undefined) {
    assert(
      Array.isArray(value.accessVariables) &&
        value.accessVariables.every((item) => typeof item === "string"),
      "variable access dependencies are invalid",
    );
  }
  if (value.accessContainer !== undefined) {
    validateSerializedValue(value.accessContainer);
  }
  if (value.accessKey !== undefined) {
    validateSerializedValue(value.accessKey);
  }
  if (value.result !== undefined) {
    validateSerializedValue(value.result);
  }
}

function validateCausalOrder(
  value: Record<string, unknown>,
  label: string,
): void {
  if (value.actorId !== undefined) {
    assert(typeof value.actorId === "string" && value.actorId.length > 0, `${label} actor is invalid`);
  }
  if (value.actorSequence !== undefined) {
    assert(
      Number.isInteger(value.actorSequence) &&
        (value.actorSequence as number) >= 0,
      `${label} actor sequence is invalid`,
    );
  }
  if (value.happensAfter !== undefined) {
    assert(
      Array.isArray(value.happensAfter) &&
        value.happensAfter.every((id) => typeof id === "string"),
      `${label} causal predecessors are invalid`,
    );
  }
}

function validateFrame(value: unknown): asserts value is TraceFrame {
  assert(isRecord(value), "trace frame must be an object");
  assert(Number.isInteger(value.index), "frame index is invalid");
  if (value.eventIndex !== undefined) {
    assert(Number.isInteger(value.eventIndex), "frame event index is invalid");
  }
  validateCausalOrder(value, "frame");
  assert(
    ["call", "resume", "line", "yield", "return", "exception"].includes(
      String(value.event),
    ),
    "frame event is invalid",
  );
  assert(isRecord(value.source), "frame source is missing");
  assert(Number.isInteger(value.source.line), "frame source line is invalid");
  assert(typeof value.functionName === "string", "frame function name is missing");
  assert(typeof value.scopeId === "string", "frame scope identity is missing");
  assert(Number.isInteger(value.depth), "frame depth is invalid");
  assert(Array.isArray(value.callStack), "frame call stack must be an array");
  value.callStack.forEach(validateCallStackEntry);
  if (value.ancestorScopes !== undefined) {
    assert(
      Array.isArray(value.ancestorScopes),
      "ancestor scopes must be an array",
    );
    value.ancestorScopes.forEach((scope) => {
      assert(isRecord(scope), "ancestor scope must be an object");
      assert(
        typeof scope.functionName === "string",
        "ancestor scope function name is missing",
      );
      assert(
        typeof scope.scopeId === "string",
        "ancestor scope identity is missing",
      );
      assert(Number.isInteger(scope.line), "ancestor scope line is invalid");
      assert(isRecord(scope.locals), "ancestor scope locals must be an object");
      Object.values(scope.locals).forEach((local) =>
        validateSerializedValue(local),
      );
    });
  }
  assert(isRecord(value.locals), "frame locals must be an object");
  Object.values(value.locals).forEach((local) => validateSerializedValue(local));
  if (value.persistentBindings !== undefined) {
    assert(
      Array.isArray(value.persistentBindings) &&
        value.persistentBindings.every(
          (binding) =>
            typeof binding === "string" &&
            Object.prototype.hasOwnProperty.call(value.locals, binding),
        ),
      "persistent bindings must reference frame locals",
    );
  }
  assert(typeof value.stdout === "string", "frame output is invalid");
  assert(Array.isArray(value.changes), "frame changes must be an array");
  value.changes.forEach(validateChange);
  assert(Array.isArray(value.semanticEvents), "semantic events must be an array");
  value.semanticEvents.forEach(validateSemanticEvent);
  if (value.activeVisualEvents !== undefined) {
    assert(
      Array.isArray(value.activeVisualEvents),
      "active visual events must be an array",
    );
    value.activeVisualEvents.forEach(validateSemanticEvent);
  }
  if (value.returnValue !== undefined) {
    validateSerializedValue(value.returnValue);
  }
  if (value.yieldValue !== undefined) {
    validateSerializedValue(value.yieldValue);
  }
  if (value.exception !== undefined) {
    assert(typeof value.exception === "string", "frame exception is invalid");
  }
  if (value.exceptionId !== undefined) {
    assert(typeof value.exceptionId === "string", "frame exception identity is invalid");
  }
}

function validateTrace(value: unknown): asserts value is ExecutionTrace {
  assert(isRecord(value), "trace must be an object");
  if (value.irVersion !== undefined) {
    assert(value.irVersion === 2, "trace IR version is not supported");
  }
  assert(typeof value.source === "string", "trace source is missing");
  validateRunSpec(value.runSpec);
  assert(Array.isArray(value.frames), "trace frames must be an array");
  const frames = value.frames;
  frames.forEach((frame, index) => {
    validateFrame(frame);
    assert(frame.index === index, "frame indices must be contiguous");
  });
  if (value.steps !== undefined) {
    assert(Array.isArray(value.steps), "trace steps must be an array");
    value.steps.forEach((step, index) => {
      assert(isRecord(step), "trace step must be an object");
      assert(step.index === index, "step indices must be contiguous");
      validateCausalOrder(step, "step");
      assert(
        ["call", "resume", "line", "yield", "return", "exception"].includes(
          String(step.event),
        ),
        "step event is invalid",
      );
      assert(isRecord(step.source), "step source is missing");
      assert(Number.isInteger(step.source.line), "step source line is invalid");
      assert(
        typeof step.functionName === "string",
        "step function name is missing",
      );
      assert(typeof step.scopeId === "string", "step scope identity is missing");
      assert(Number.isInteger(step.depth), "step depth is invalid");
      assert(Array.isArray(step.callStack), "step call stack must be an array");
      step.callStack.forEach(validateCallStackEntry);
      // Early v1 debugger steps predate semantic events. Normalize them while
      // parsing so the runtime contract remains a required array.
      if (step.semanticEvents === undefined) {
        step.semanticEvents = [];
      }
      assert(Array.isArray(step.semanticEvents), "step semantic events must be an array");
      step.semanticEvents.forEach(validateSemanticEvent);
      if (step.activeVisualEvents !== undefined) {
        assert(
          Array.isArray(step.activeVisualEvents),
          "active visual events must be an array",
        );
        step.activeVisualEvents.forEach(validateSemanticEvent);
      }
      const frameIndex = step.frameIndex;
      assert(
        typeof frameIndex === "number" &&
          Number.isInteger(frameIndex) &&
          frameIndex >= 0 &&
          frameIndex < frames.length,
        "step frame index is invalid",
      );
    });
  }
  assert(typeof value.stdout === "string", "trace output is invalid");
  assert(
    typeof value.durationMs === "number" && Number.isFinite(value.durationMs),
    "trace duration is invalid",
  );
  if (value.eventsObserved !== undefined) {
    const eventsObserved = value.eventsObserved;
    assert(
      typeof eventsObserved === "number" &&
        Number.isInteger(eventsObserved) &&
        eventsObserved >= 0,
      "observed event count is invalid",
    );
  }
  if (value.samplingStride !== undefined) {
    const samplingStride = value.samplingStride;
    assert(
      typeof samplingStride === "number" &&
        Number.isInteger(samplingStride) &&
        samplingStride > 0,
      "sampling stride is invalid",
    );
  }
  if (value.error !== undefined) {
    assert(typeof value.error === "string", "trace error is invalid");
  }
}

export function createReplayFile(
  trace: ExecutionTrace,
  createdAt = new Date().toISOString(),
): ReplayFile {
  return {
    format: REPLAY_FORMAT,
    version: REPLAY_VERSION,
    createdAt,
    trace,
  };
}

export function serializeReplay(trace: ExecutionTrace): string {
  return JSON.stringify(createReplayFile(trace), null, 2);
}

export function parseReplay(contents: string): ReplayFile {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error("Invalid replay: file is not valid JSON");
  }
  assert(isRecord(value), "file root must be an object");
  assert(value.format === REPLAY_FORMAT, "file format is not supported");
  assert(value.version === REPLAY_VERSION, "file version is not supported");
  assert(typeof value.createdAt === "string", "creation time is missing");
  assert(!Number.isNaN(Date.parse(value.createdAt)), "creation time is invalid");
  validateTrace(value.trace);
  const replay = value as unknown as ReplayFile;
  replay.trace = upgradeExecutionTrace(replay.trace);
  return replay;
}
