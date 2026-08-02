import type {
  BindingLocation,
  CallStackEntry,
  ExecutionTrace,
  ObservationProvenance,
  RuntimeLocation,
  SemanticEvent,
  SerializedValue,
  TraceFrame,
  ValueChange,
} from "./types";
import {
  locationForContainerAccess,
  resolveExpressionLocation,
  resolvePathLocation,
  runtimeLocationId,
} from "./locations";
import {
  debuggerStepCount,
  materializeDebuggerStep,
} from "./debugger";

export const EXECUTION_MODEL_VERSION = 2 as const;

export type FactProvenance = ObservationProvenance;

export interface ActivationFact {
  id: string;
  kind: "activation";
  provenance: FactProvenance;
  activationId: string;
  parentActivationId?: string;
  functionName: string;
  line: number;
}

export interface BindingFact {
  id: string;
  kind: "binding";
  provenance: FactProvenance;
  location: BindingLocation;
  value: SerializedValue;
  parameter: boolean;
}

export interface ReturnFact {
  id: string;
  kind: "return";
  provenance: FactProvenance;
  activationId: string;
  value: SerializedValue;
}

export interface SemanticExecutionFact {
  id: string;
  kind: "semantic";
  provenance: FactProvenance;
  activationId: string;
  event: SemanticEvent;
  active: boolean;
}

export interface MutationFact {
  id: string;
  kind: "mutation";
  provenance: FactProvenance;
  activationId: string;
  location: RuntimeLocation;
  change: ValueChange;
}

export interface LifecycleFact {
  id: string;
  kind: "lifecycle";
  provenance: FactProvenance;
  activationId: string;
  event: "call" | "resume" | "yield" | "return" | "exception";
  value?: SerializedValue;
  exception?: string;
  exceptionId?: string;
}

export type ExecutionFact =
  | ActivationFact
  | BindingFact
  | ReturnFact
  | SemanticExecutionFact
  | MutationFact
  | LifecycleFact;

export interface ExecutionBinding {
  location: BindingLocation;
  value: SerializedValue;
  parameter: boolean;
}

export interface ActivationState {
  activationId: string;
  parentActivationId?: string;
  functionName: string;
  line: number;
  parameters: string[];
  bindings: ExecutionBinding[];
  status: "active" | "returning" | "suspended" | "failed";
  returnValue?: SerializedValue;
  yieldValue?: SerializedValue;
  exception?: string;
}

export interface ExecutionState {
  schemaVersion: typeof EXECUTION_MODEL_VERSION;
  stateVersionId: string;
  eventId: string;
  actorId: string;
  actorSequence: number;
  happensAfter: string[];
  activeActivationIds: string[];
  suspendedActivationIds: string[];
  activations: ActivationState[];
  suspendedActivations: ActivationState[];
  facts: ExecutionFact[];
}

function activeStack(frame: TraceFrame): CallStackEntry[] {
  const stack = [...frame.callStack];
  const current = stack.at(-1);
  if (current?.scopeId !== frame.scopeId) {
    stack.push({
      functionName: frame.functionName,
      scopeId: frame.scopeId,
      line: frame.source.line,
    });
  }
  return stack;
}

function normalizedEventLocations(
  event: SemanticEvent,
  frame: TraceFrame,
): Pick<SemanticEvent, "location" | "sourceLocations"> {
  const sourceExpressions = [
    ...(event.operandExpressions ?? []),
    ...(event.argumentExpressions ?? []),
    ...(event.kind === "read" ? [event.expression] : []),
  ];
  const sourceLocations = event.sourceLocations ?? sourceExpressions.map(
    (expression) =>
      resolveExpressionLocation(expression, frame.scopeId, frame.locals),
  );
  let location = event.location;
  if (!location && event.kind === "read" && event.accessContainer) {
    location = locationForContainerAccess(
      event.accessContainer,
      event.accessKey,
      frame.scopeId,
      event.expression,
    );
  }
  if (!location && event.kind === "mutation" && event.accessContainer) {
    const identity =
      event.accessContainer.kind === "reference"
        ? event.accessContainer.targetId
        : "id" in event.accessContainer
          ? event.accessContainer.id
          : undefined;
    if (identity) {
      location = { kind: "identity", objectId: identity };
    }
  }
  if (!location && event.target) {
    const target = event.target
      .split(/[=,]/)
      .map((part) => part.trim())
      .find(Boolean);
    if (target) {
      location = resolveExpressionLocation(
        target,
        frame.scopeId,
        frame.locals,
      );
    }
  }
  return {
    ...(location === undefined ? {} : { location }),
    ...(sourceLocations.length === 0 ? {} : { sourceLocations }),
  };
}

function normalizeSemanticEvents(
  events: SemanticEvent[],
  frame: TraceFrame,
  producerByLocation = new Map<string, string>(),
  identityKind = "semantic",
  externalProducerIds: string[] = [],
): SemanticEvent[] {
  const eventSequence = frame.eventIndex ?? frame.index;
  let lastCallId: string | undefined;
  return events.map((event, index) => {
    const locations = normalizedEventLocations(event, frame);
    const producerEventIds = [
      ...new Set(
        [
          ...(locations.sourceLocations ?? [])
            .map((location) =>
              producerByLocation.get(runtimeLocationId(location))
            )
            .filter((id): id is string => id !== undefined),
          ...(event.kind === "mutation" && lastCallId ? [lastCallId] : []),
          ...(["call", "memo"].includes(event.kind)
            ? externalProducerIds
            : []),
        ],
      ),
    ];
    const normalized: SemanticEvent = {
      ...event,
      id: event.id ?? `event:${eventSequence}:${identityKind}:${index}`,
      activationId: event.activationId ?? frame.scopeId,
      actorId: event.actorId ?? frame.actorId ?? "main",
      actorSequence:
        event.actorSequence ??
        frame.actorSequence ??
        eventSequence,
      happensAfter:
        event.happensAfter ??
        frame.happensAfter ??
        (eventSequence > 0 ? [`event:${eventSequence - 1}`] : []),
      provenance: event.provenance ?? "observed",
      ...locations,
      ...(producerEventIds.length === 0 ? {} : { producerEventIds }),
    };
    if (
      normalized.location &&
      ["write", "swap", "mutation"].includes(normalized.kind)
    ) {
      producerByLocation.set(
        runtimeLocationId(normalized.location),
        normalized.id!,
      );
    }
    if (normalized.kind === "call") {
      lastCallId = normalized.id;
    }
    return normalized;
  });
}

function materializeFrameState(
  frame: TraceFrame,
  suspendedActivations: ActivationState[] = [],
  producerByLocation = new Map<string, string>(),
  externalProducerFacts: LifecycleFact[] = [],
): ExecutionState {
  const stack = activeStack(frame);
  const localsByActivation = new Map(
    (frame.ancestorScopes ?? []).map((scope) => [scope.scopeId, scope.locals]),
  );
  localsByActivation.set(frame.scopeId, frame.locals);

  const facts: ExecutionFact[] = [...externalProducerFacts];
  const activations = stack.map((entry, index): ActivationState => {
    const parentActivationId = stack[index - 1]?.scopeId;
    const locals = localsByActivation.get(entry.scopeId) ?? {};
    const parameters = entry.parameters ?? [];
    const parameterNames = new Set(parameters);
    const bindings = Object.entries(locals).map(([name, value]) => ({
      location: {
        kind: "binding" as const,
        activationId: entry.scopeId,
        name,
      },
      value,
      parameter: parameterNames.has(name),
    }));
    facts.push({
      id: `activation:${entry.scopeId}`,
      kind: "activation",
      provenance: "observed",
      activationId: entry.scopeId,
      ...(parentActivationId === undefined ? {} : { parentActivationId }),
      functionName: entry.functionName,
      line: entry.line,
    });
    bindings.forEach((binding) => {
      facts.push({
        id: `binding:${entry.scopeId}:${binding.location.name}`,
        kind: "binding",
        provenance: "observed",
        location: binding.location,
        value: binding.value,
        parameter: binding.parameter,
      });
    });
    const returning =
      entry.scopeId === frame.scopeId &&
      frame.event === "return" &&
      frame.returnValue !== undefined;
    const yielding =
      entry.scopeId === frame.scopeId &&
      frame.event === "yield";
    const failed =
      entry.scopeId === frame.scopeId &&
      frame.event === "exception";
    if (returning) {
      facts.push({
        id: `return:${entry.scopeId}:${frame.eventIndex ?? frame.index}`,
        kind: "return",
        provenance: "observed",
        activationId: entry.scopeId,
        value: frame.returnValue!,
      });
    }
    return {
      activationId: entry.scopeId,
      ...(parentActivationId === undefined ? {} : { parentActivationId }),
      functionName: entry.functionName,
      line: entry.line,
      parameters,
      bindings,
      status: returning ? "returning" : "active",
      ...(returning ? { returnValue: frame.returnValue } : {}),
      ...(yielding ? { status: "suspended", yieldValue: frame.yieldValue } : {}),
      ...(failed ? { status: "failed", exception: frame.exception } : {}),
    };
  });
  const eventSequence = frame.eventIndex ?? frame.index;
  const normalizedEvents = normalizeSemanticEvents(
    frame.semanticEvents,
    frame,
    producerByLocation,
    "semantic",
    externalProducerFacts.map(({ id }) => id),
  );
  const normalizedActiveEvents = normalizeSemanticEvents(
    frame.activeVisualEvents ?? [],
    frame,
    producerByLocation,
    "active",
  );
  normalizedEvents.forEach((event) => {
    facts.push({
      id: `fact:${event.id}`,
      kind: "semantic",
      provenance: event.provenance ?? "observed",
      activationId: event.activationId ?? frame.scopeId,
      event,
      active: false,
    });
  });
  const currentEventIds = new Set(normalizedEvents.map(({ id }) => id));
  normalizedActiveEvents
    .filter(({ id }) => !currentEventIds.has(id))
    .forEach((event) => {
      facts.push({
        id: `fact:${event.id}`,
        kind: "semantic",
        provenance: event.provenance ?? "observed",
        activationId: event.activationId ?? frame.scopeId,
        event,
        active: true,
      });
    });
  frame.changes.forEach((change, index) => {
    const location =
      change.location ??
      resolvePathLocation(change.path, frame.scopeId, frame.locals);
    const id = `mutation:${eventSequence}:${index}:${runtimeLocationId(location)}`;
    facts.push({
      id,
      kind: "mutation",
      provenance: change.location ? "observed" : "derived",
      activationId: frame.scopeId,
      location,
      change: { ...change, location },
    });
    producerByLocation.set(runtimeLocationId(location), id);
  });
  if (["call", "resume", "yield", "return", "exception"].includes(frame.event)) {
    facts.push({
      id: `lifecycle:${eventSequence}:${frame.scopeId}:${frame.event}`,
      kind: "lifecycle",
      provenance: "observed",
      activationId: frame.scopeId,
      event: frame.event as LifecycleFact["event"],
      ...(frame.returnValue === undefined ? {} : { value: frame.returnValue }),
      ...(frame.yieldValue === undefined ? {} : { value: frame.yieldValue }),
      ...(frame.exception === undefined ? {} : { exception: frame.exception }),
      ...(frame.exceptionId === undefined
        ? {}
        : { exceptionId: frame.exceptionId }),
    });
  }
  return {
    schemaVersion: EXECUTION_MODEL_VERSION,
    stateVersionId: `state:${eventSequence}:${frame.scopeId}`,
    eventId: `event:${eventSequence}`,
    actorId: frame.actorId ?? "main",
    actorSequence: frame.actorSequence ?? eventSequence,
    happensAfter:
      frame.happensAfter ??
      (eventSequence > 0 ? [`event:${eventSequence - 1}`] : []),
    activeActivationIds: activations.map(({ activationId }) => activationId),
    suspendedActivationIds: suspendedActivations.map(
      ({ activationId }) => activationId,
    ),
    activations,
    suspendedActivations,
    facts,
  };
}

export function materializeExecutionState(frame: TraceFrame): ExecutionState {
  return materializeFrameState(frame);
}

export function materializeExecutionTimeline(
  trace: ExecutionTrace,
): ExecutionState[] {
  const states: ExecutionState[] = [];
  const suspendedById = new Map<string, ActivationState>();
  const producerByLocation = new Map<string, string>();
  const pendingCompletionsByActivation = new Map<string, LifecycleFact[]>();
  const count = debuggerStepCount(trace);
  for (let stepIndex = 0; stepIndex < count; stepIndex += 1) {
    const frame = materializeDebuggerStep(trace, stepIndex);
    if (!frame) {
      continue;
    }
    if (frame.event === "resume") {
      suspendedById.delete(frame.scopeId);
    }
    const state = materializeFrameState(
      frame,
      [...suspendedById.values()],
      producerByLocation,
      pendingCompletionsByActivation.get(frame.scopeId) ?? [],
    );
    states.push(state);
    const current = state.activations.find(
      ({ activationId }) => activationId === frame.scopeId,
    );
    if (frame.event === "yield" && current) {
      suspendedById.set(frame.scopeId, {
        ...current,
        status: "suspended",
      });
    }
    if (frame.event === "return" || frame.event === "exception") {
      suspendedById.delete(frame.scopeId);
      const completing = state.activations.find(
        ({ activationId }) => activationId === frame.scopeId,
      );
      const lifecycle = state.facts.find(
        (fact): fact is LifecycleFact =>
          fact.kind === "lifecycle" &&
          fact.activationId === frame.scopeId &&
          fact.event === frame.event,
      );
      if (completing?.parentActivationId && lifecycle) {
        const pending =
          pendingCompletionsByActivation.get(
            completing.parentActivationId,
          ) ?? [];
        pendingCompletionsByActivation.set(
          completing.parentActivationId,
          [...pending, lifecycle],
        );
      }
    }
    if (
      state.facts.some(
        (fact) =>
          fact.kind === "semantic" &&
          ["call", "memo"].includes(fact.event.kind),
      )
    ) {
      pendingCompletionsByActivation.delete(frame.scopeId);
    }
  }
  return states;
}
