import { mappingEntryId, resolvePathLocation } from "./locations";
import type {
  ExecutionTrace,
  SemanticEvent,
  SerializedValue,
  TraceFrame,
  TraceStep,
} from "./types";

function upgradeValue(value: SerializedValue): SerializedValue {
  if (value.kind === "sequence") {
    return { ...value, items: value.items.map(upgradeValue) };
  }
  if (value.kind === "set") {
    const items = value.items.map(upgradeValue);
    return {
      ...value,
      items,
      itemIds:
        value.itemIds ??
        items.map(
          (item) => `${value.id}:member:${JSON.stringify(item)}`,
        ),
    };
  }
  if (value.kind === "mapping") {
    const entries = value.entries.map(
      ([key, item]) =>
        [upgradeValue(key), upgradeValue(item)] as [
          SerializedValue,
          SerializedValue,
        ],
    );
    const upgraded = { ...value, entries };
    return {
      ...upgraded,
      entryIds:
        value.entryIds ??
        entries.map((_, index) => mappingEntryId(upgraded, index)),
    };
  }
  if (value.kind === "object") {
    return {
      ...value,
      fields: Object.fromEntries(
        Object.entries(value.fields).map(([name, field]) => [
          name,
          upgradeValue(field),
        ]),
      ),
    };
  }
  return value;
}

function upgradeLocals(
  locals: Record<string, SerializedValue>,
): Record<string, SerializedValue> {
  return Object.fromEntries(
    Object.entries(locals).map(([name, value]) => [name, upgradeValue(value)]),
  );
}

function upgradeEvent(
  event: SemanticEvent,
  id: string,
  activationId: string,
  actorId: string,
  actorSequence: number,
  happensAfter: string[],
): SemanticEvent {
  return {
    ...event,
    id: event.id ?? id,
    activationId: event.activationId ?? activationId,
    actorId: event.actorId ?? actorId,
    actorSequence: event.actorSequence ?? actorSequence,
    happensAfter: event.happensAfter ?? happensAfter,
    provenance: event.provenance ?? "observed",
    ...(event.operands
      ? { operands: event.operands.map(upgradeValue) }
      : {}),
    ...(event.arguments
      ? { arguments: event.arguments.map(upgradeValue) }
      : {}),
    ...(event.result ? { result: upgradeValue(event.result) } : {}),
    ...(event.accessContainer
      ? { accessContainer: upgradeValue(event.accessContainer) }
      : {}),
    ...(event.accessKey ? { accessKey: upgradeValue(event.accessKey) } : {}),
    ...(event.before ? { before: upgradeValue(event.before) } : {}),
  };
}

function upgradeFrame(frame: TraceFrame): TraceFrame {
  const locals = upgradeLocals(frame.locals);
  const eventSequence = frame.eventIndex ?? frame.index;
  const actorId = frame.actorId ?? "main";
  const actorSequence = frame.actorSequence ?? eventSequence;
  const happensAfter =
    frame.happensAfter ??
    (actorSequence > 0 ? [`event:${actorSequence - 1}`] : []);
  return {
    ...frame,
    actorId,
    actorSequence,
    happensAfter,
    locals,
    ancestorScopes: frame.ancestorScopes?.map((scope) => ({
      ...scope,
      locals: upgradeLocals(scope.locals),
    })),
    changes: frame.changes.map((change) => ({
      ...change,
      ...(change.before ? { before: upgradeValue(change.before) } : {}),
      ...(change.after ? { after: upgradeValue(change.after) } : {}),
      location:
        change.location ??
        resolvePathLocation(change.path, frame.scopeId, locals),
    })),
    semanticEvents: frame.semanticEvents.map((event, index) =>
      upgradeEvent(
        event,
        `event:${eventSequence}:semantic:${index}`,
        frame.scopeId,
        actorId,
        actorSequence,
        happensAfter,
      )
    ),
    activeVisualEvents: frame.activeVisualEvents?.map((event, index) =>
      upgradeEvent(
        event,
        `event:${eventSequence}:active:${index}`,
        frame.scopeId,
        actorId,
        actorSequence,
        happensAfter,
      )
    ),
    ...(frame.returnValue
      ? { returnValue: upgradeValue(frame.returnValue) }
      : {}),
    ...(frame.yieldValue
      ? { yieldValue: upgradeValue(frame.yieldValue) }
      : {}),
  };
}

function upgradeStep(step: TraceStep): TraceStep {
  const actorId = step.actorId ?? "main";
  const actorSequence = step.actorSequence ?? step.index;
  const happensAfter =
    step.happensAfter ??
    (actorSequence > 0 ? [`event:${actorSequence - 1}`] : []);
  return {
    ...step,
    actorId,
    actorSequence,
    happensAfter,
    semanticEvents: step.semanticEvents.map((event, index) =>
      upgradeEvent(
        event,
        `step:${step.index}:semantic:${index}`,
        step.scopeId,
        actorId,
        actorSequence,
        happensAfter,
      )
    ),
    activeVisualEvents: step.activeVisualEvents?.map((event, index) =>
      upgradeEvent(
        event,
        `step:${step.index}:active:${index}`,
        step.scopeId,
        actorId,
        actorSequence,
        happensAfter,
      )
    ),
  };
}

export function upgradeExecutionTrace(trace: ExecutionTrace): ExecutionTrace {
  return {
    ...trace,
    irVersion: 2,
    frames: trace.frames.map(upgradeFrame),
    steps: trace.steps?.map(upgradeStep),
  };
}
