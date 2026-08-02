import type { RawTraceFrame, SerializedValue, TraceFrame, ValueChange } from "./types";
import { mappingEntryId } from "./locations";

function fingerprint(value: SerializedValue | undefined): string {
  return value === undefined ? "__missing__" : JSON.stringify(value);
}

interface ChildEntry {
  identity: string;
  path: string;
  value: SerializedValue;
}

function childEntries(value: SerializedValue): ChildEntry[] {
  switch (value.kind) {
    case "sequence":
      return value.items.map((item, index) => ({
        identity: `index:${index}`,
        path: `[${index}]`,
        value: item,
      }));
    case "set":
      return value.items.map((item, index) => ({
        identity: value.itemIds?.[index] ?? `member:${JSON.stringify(item)}`,
        path: `[${index}]`,
        value: item,
      }));
    case "mapping":
      return value.entries.flatMap(([key, item], index) => {
        const entryId = mappingEntryId(value, index);
        return [
          {
            identity: `${entryId}:key`,
            path: `{${index}}.key`,
            value: key,
          },
          {
            identity: `${entryId}:value`,
            path: `{${index}}.value`,
            value: item,
          },
        ];
      });
    case "object":
      return Object.entries(value.fields).map(([key, item]) => ({
        identity: `field:${key}`,
        path: `.${key}`,
        value: item,
      }));
    default:
      return [];
  }
}

function collectChanges(
  path: string,
  before: SerializedValue | undefined,
  after: SerializedValue | undefined,
  changes: ValueChange[],
): void {
  if (fingerprint(before) === fingerprint(after)) {
    return;
  }
  if (before === undefined) {
    changes.push({ path, kind: "created", after });
    return;
  }
  if (after === undefined) {
    changes.push({ path, kind: "removed", before });
    return;
  }

  const sameContainer =
    before.kind === after.kind &&
    "id" in before &&
    "id" in after &&
    before.id === after.id;

  if (!sameContainer) {
    changes.push({ path, kind: "updated", before, after });
    return;
  }

  const beforeChildren = new Map(
    childEntries(before).map((entry) => [entry.identity, entry]),
  );
  const afterChildren = new Map(
    childEntries(after).map((entry) => [entry.identity, entry]),
  );
  const childKeys = new Set([...beforeChildren.keys(), ...afterChildren.keys()]);

  if (childKeys.size === 0) {
    changes.push({ path, kind: "updated", before, after });
    return;
  }

  for (const childKey of childKeys) {
    const beforeChild = beforeChildren.get(childKey);
    const afterChild = afterChildren.get(childKey);
    collectChanges(
      `${path}${afterChild?.path ?? beforeChild?.path ?? ""}`,
      beforeChild?.value,
      afterChild?.value,
      changes,
    );
  }
}

export function diffLocals(
  before: Record<string, SerializedValue>,
  after: Record<string, SerializedValue>,
): ValueChange[] {
  const changes: ValueChange[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    collectChanges(key, before[key], after[key], changes);
  }
  return changes;
}

export function annotateFrames(
  frames: Array<RawTraceFrame & { changes?: ValueChange[] }>,
): TraceFrame[] {
  const previousByScope = new Map<string, Record<string, SerializedValue>>();
  return frames.map((frame, index) => {
    const previous = previousByScope.get(frame.scopeId) ?? {};
    const changes = frame.changes ?? diffLocals(previous, frame.locals);
    previousByScope.set(frame.scopeId, frame.locals);
    return {
      ...frame,
      index,
      callStack: frame.callStack ?? [],
      changes,
      semanticEvents: frame.semanticEvents ?? [],
    };
  });
}

export function coalesceFrames(frames: RawTraceFrame[]): TraceFrame[] {
  return annotateFrames(frames);
}
