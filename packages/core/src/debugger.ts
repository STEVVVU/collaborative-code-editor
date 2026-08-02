import type {
  ExecutionTrace,
  RunSpec,
  SemanticEvent,
  TraceFrame,
  TraceStep,
} from "./types";

export type DebuggerStatus = "idle" | "loading" | "ready" | "running";

export interface DebuggerExecutionLimits {
  snapshotBudget?: number;
  executionTimeoutMs?: number;
  visualizationTimeoutMs?: number;
  memoryLimitBytes?: number;
}

export interface DebuggerLaunchRequest {
  source: string;
  runSpec?: RunSpec;
  limits?: DebuggerExecutionLimits;
}

export interface DebuggerAdapter {
  readonly languageId: string;
  readonly status: DebuggerStatus;
  execute(request: DebuggerLaunchRequest): Promise<ExecutionTrace>;
  subscribe(listener: (status: DebuggerStatus) => void): () => void;
  dispose(): void;
}

export function debuggerStepCount(trace: ExecutionTrace | undefined): number {
  return trace?.steps?.length ?? trace?.frames.length ?? 0;
}

function sameSourceLine(left: SemanticEvent, right: SemanticEvent): boolean {
  return (
    left.source.line === right.source.line &&
    left.source.endLine === right.source.endLine
  );
}

function iterationTargetNames(target: string | undefined): string[] {
  return (target ?? "")
    .replace(/^[[(]\s*|\s*[\])]$/g, "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function visualEventIdentity(event: SemanticEvent): string {
  return [
    event.kind,
    event.source.line,
    event.expression,
    event.accessVariables?.join(",") ?? "",
  ].join(":");
}

function sameCallStack(left: TraceStep, right: TraceStep): boolean {
  return (
    left.callStack.length === right.callStack.length &&
    left.callStack.every((entry, index) => {
      const candidate = right.callStack[index];
      return (
        entry.functionName === candidate.functionName &&
        entry.scopeId === candidate.scopeId &&
        entry.line === candidate.line
      );
    })
  );
}

function redundantEmptyStep(left: TraceStep, right: TraceStep): boolean {
  return (
    left.semanticEvents.length === 0 &&
    right.semanticEvents.length === 0 &&
    left.event === right.event &&
    left.source.line === right.source.line &&
    left.source.endLine === right.source.endLine &&
    left.scopeId === right.scopeId &&
    left.frameIndex === right.frameIndex &&
    sameCallStack(left, right) &&
    JSON.stringify(left.activeVisualEvents ?? []) ===
      JSON.stringify(right.activeVisualEvents ?? [])
  );
}

export function expandSemanticSteps(steps: TraceStep[]): TraceStep[] {
  const expanded: TraceStep[] = [];
  const persistentByScope = new Map<
    string,
    Map<string, SemanticEvent>
  >();
  for (const step of steps) {
    const persistent =
      persistentByScope.get(step.scopeId) ?? new Map<string, SemanticEvent>();
    persistentByScope.set(step.scopeId, persistent);
    const activeIterations = step.semanticEvents.filter(
      (event) => event.kind === "iteration",
    );
    const iterationBindings = new Set(
      activeIterations.flatMap((event) =>
        iterationTargetNames(event.target)
      ),
    );
    for (const [identity, event] of persistent) {
      if (
        event.accessVariables?.some((name) => iterationBindings.has(name))
      ) {
        persistent.delete(identity);
      }
    }
    const activeVisualEvents = () => [
      ...persistent.values(),
      ...activeIterations,
    ];

    if (step.semanticEvents.length === 0) {
      expanded.push({
        ...step,
        activeVisualEvents: activeVisualEvents(),
      });
      if (step.event === "return") {
        persistentByScope.delete(step.scopeId);
      }
      continue;
    }

    const groups: SemanticEvent[][] = [];
    for (const event of step.semanticEvents) {
      const current = groups.at(-1);
      if (current && sameSourceLine(current[0], event)) {
        current.push(event);
      } else {
        groups.push([event]);
      }
    }

    for (const semanticEvents of groups) {
      for (const event of semanticEvents) {
        if (
          event.kind !== "iteration" &&
          event.accessVariables &&
          event.accessVariables.length > 0 &&
          !event.accessVariables.some((name) => iterationBindings.has(name))
        ) {
          persistent.set(visualEventIdentity(event), event);
        }
      }
      const source = semanticEvents[0].source;
      const semanticStep = {
        ...step,
        event: "line" as const,
        source,
        callStack: step.callStack.map((entry, index) =>
          index === step.callStack.length - 1
            ? { ...entry, line: source.line }
            : entry,
        ),
        semanticEvents,
        activeVisualEvents: activeVisualEvents(),
      };
      const previous = expanded.at(-1);
      if (
        previous?.event === "line" &&
        previous.scopeId === semanticStep.scopeId &&
        previous.source.line === semanticStep.source.line &&
        previous.semanticEvents.length === 0
      ) {
        expanded[expanded.length - 1] = semanticStep;
      } else {
        expanded.push(semanticStep);
      }
    }
    const plainStep = {
      ...step,
      semanticEvents: [],
      activeVisualEvents: activeVisualEvents(),
    };
    const lastExpanded = expanded.at(-1);
    const semanticAlreadyShowsLine =
      step.event === "line" &&
      lastExpanded !== undefined &&
      lastExpanded.semanticEvents.length !== 0 &&
      lastExpanded.scopeId === plainStep.scopeId &&
      lastExpanded.source.line === plainStep.source.line &&
      lastExpanded.source.endLine === plainStep.source.endLine;
    if (!semanticAlreadyShowsLine) {
      expanded.push(plainStep);
    }
    if (step.event === "return") {
      persistentByScope.delete(step.scopeId);
    }
  }

  const compacted = expanded.filter(
    (step, index) =>
      index === 0 || !redundantEmptyStep(expanded[index - 1], step),
  );
  return compacted.map((step, index) => ({ ...step, index }));
}

export function materializeDebuggerStep(
  trace: ExecutionTrace | undefined,
  stepIndex: number,
): TraceFrame | undefined {
  if (!trace) {
    return undefined;
  }
  const step = trace.steps?.[stepIndex];
  const stateFrame = step
    ? trace.frames[step.frameIndex]
    : trace.frames[stepIndex];
  if (!stateFrame) {
    return undefined;
  }
  if (!step) {
    return stateFrame;
  }
  return {
    ...stateFrame,
    index: step.index,
    eventIndex: step.index,
    actorId: step.actorId ?? stateFrame.actorId ?? "main",
    actorSequence: step.actorSequence ?? step.index,
    happensAfter:
      step.happensAfter ??
      (step.index > 0 ? [`event:${step.index - 1}`] : []),
    event: step.event,
    source: step.source,
    functionName: step.functionName,
    scopeId: step.scopeId,
    depth: step.depth,
    callStack: step.callStack,
    semanticEvents: step.semanticEvents,
    activeVisualEvents: step.activeVisualEvents,
  };
}

export function debuggerStepForFrame(
  trace: ExecutionTrace,
  frameIndex: number,
): number {
  const stepIndex = trace.steps?.findIndex(
    (step) => step.frameIndex >= frameIndex,
  );
  return Math.max(0, stepIndex ?? frameIndex);
}
