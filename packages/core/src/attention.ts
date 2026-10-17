import type { ExecutionTrace, ProjectionContractsV1, RuntimeLocation, ValueChange } from "./types";
import type { ExecutionState } from "./executionModel";
import { materializeExecutionTimeline } from "./executionModel";
import { debuggerStepCount, materializeDebuggerStep } from "./debugger";
import { indexRuntimeLocationPaths, resolvePathLocation, runtimeLocationId, serializedIdentity } from "./locations";
import { compileAttentionRequests } from "./lenses";
import { projectSceneVariables, ProjectionRegistry, type SceneProjection, type SceneVariable, type VisualScene } from "./scene";
import type { AttentionRequest } from "./lenses";

export type AttentionActivity = "changed" | "used" | "context" | "idle";

export interface AttentionView {
  id: string;
  path: string;
  label: string;
  type: string;
  kind: SceneProjection["kind"];
  aliases: string[];
  activity: AttentionActivity;
  changes: ValueChange[];
}

export interface AttentionSnapshot {
  stepIndex: number;
  views: AttentionView[];
  workingIds: string[];
}

export interface CompileAttentionOptions {
  maxWorkingViews?: number;
  projectionContracts?: ProjectionContractsV1;
  executionTimeline?: readonly ExecutionState[];
}

interface Candidate extends AttentionView {
  projection: SceneProjection;
  order: number;
  occurrences: Array<{ path: string; label: string }>;
}

const COMPOSITE_KINDS = new Set(["sequence", "grid", "mapping", "object", "graph"]);

function projectionChildren(projection: SceneProjection, path: string): Array<{ projection: SceneProjection; path: string; label: string }> {
  if (projection.kind === "sequence") {
    return projection.items.map((item, index) => ({ projection: item, path: `${path}[${index}]`, label: item.label || String(index) }));
  }
  if (projection.kind === "grid") {
    return projection.rows.flatMap((row, rowIndex) => row.map((item, columnIndex) => ({ projection: item, path: `${path}[${rowIndex}][${columnIndex}]`, label: item.label || `[${rowIndex}][${columnIndex}]` })));
  }
  if (projection.kind === "mapping") {
    return projection.entries.map(({ key, value }, index) => {
      const keyLabel = key.kind === "scalar" ? key.value : key.label;
      return { projection: value, path: `${path}{${index}}.value`, label: keyLabel || `entry ${index}` };
    });
  }
  if (projection.kind === "object") {
    return projection.fields.map(({ name, value }) => ({ projection: value, path: `${path}.${name}`, label: name }));
  }
  // A graph is one rendered unit. Its vertex values and adjacency rows are implementation details.
  return [];
}

function candidatesForVariables(variables: readonly SceneVariable[]): Candidate[] {
  const byKey = new Map<string, Candidate>();
  let order = 0;
  const visit = (projection: SceneProjection, path: string, label: string, root: boolean) => {
    const isCandidate = COMPOSITE_KINDS.has(projection.kind) || (root && projection.kind === "scalar");
    if (isCandidate) {
      const id = projection.key;
      const existing = byKey.get(id);
      if (existing) {
        if (!existing.occurrences.some((occurrence) => occurrence.path === path)) existing.occurrences.push({ path, label: label || projection.label });
      } else {
        byKey.set(id, {
          id, path, label: label || projection.label, type: projection.type,
          kind: projection.kind, aliases: [], activity: "idle", changes: [],
          projection, order: order++, occurrences: [{ path, label: label || projection.label }],
        });
      }
    }
    // Primitive values nested inside structures are not independently promoted.
    for (const child of projectionChildren(projection, path)) {
      visit(child.projection, child.path, child.label, false);
    }
  };
  variables.forEach(({ name, projection }) => visit(projection, name, projection.label || name, true));
  return [...byKey.values()];
}

function applyCanonicalOccurrences(candidates: Candidate[], prior: Map<string, { path: string; label: string }>): void {
  for (const candidate of candidates) {
    const previous = prior.get(candidate.id);
    const canonical = candidate.occurrences.find(({ path }) => path === previous?.path) ?? candidate.occurrences[0];
    if (!canonical) continue;
    candidate.path = canonical.path;
    candidate.label = canonical.label;
    candidate.aliases = candidate.occurrences.map(({ path }) => path).filter((path) => path !== canonical.path);
    prior.set(candidate.id, { path: candidate.path, label: candidate.label });
  }
}

function pathContains(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}.`) || child.startsWith(`${parent}[`) || child.startsWith(`${parent}{`);
}

function ownerForLocation(location: RuntimeLocation, paths: Map<string, string>, candidates: Candidate[]): Candidate | undefined {
  const path = paths.get(runtimeLocationId(location));
  if (!path) return undefined;
  return ownerForPath(path, candidates);
}

function ownerForPath(path: string, candidates: Candidate[]): Candidate | undefined {
  const matches = candidates.flatMap((candidate) =>
    [candidate.path, ...candidate.aliases]
      .filter((candidatePath) => pathContains(candidatePath, path))
      .map((candidatePath) => ({ candidate, candidatePath }))
  );
  return matches.sort((left, right) => right.candidatePath.length - left.candidatePath.length || left.candidate.order - right.candidate.order)[0]?.candidate;
}

function ownerForMutation(location: RuntimeLocation, paths: Map<string, string>, candidates: Candidate[]): Candidate | undefined {
  const containerId = location.kind === "field" ? location.objectId
    : location.kind === "index" ? location.containerId
    : location.kind === "mapping-entry" ? location.mappingId
    : location.kind === "set-member" ? location.setId
    : location.kind === "identity" ? location.objectId
    : undefined;
  // A write changes a slot owned by its container. The assigned child can be
  // newly created and should remain context rather than receiving the mutation.
  const container = containerId === undefined ? undefined : candidates.find(({ id }) => id === containerId);
  return container ?? ownerForLocation(location, paths, candidates);
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isActualChange(change: ValueChange): boolean {
  if (change.kind === "created" || change.kind === "removed") return true;
  return change.before !== undefined && change.after !== undefined && !sameValue(change.before, change.after);
}

function frameChanges(candidates: Candidate[], frame: ReturnType<typeof materializeDebuggerStep>, paths: Map<string, string>): void {
  if (!frame) return;
  for (const change of frame.changes.filter(isActualChange)) {
    const location = change.location ?? resolvePathLocation(change.path, frame.scopeId, frame.locals);
    const owner = ownerForMutation(location, paths, candidates);
    if (!owner) continue;
    owner.changes.push(change);
    owner.activity = "changed";
  }
}

function applyEvidence(candidates: Candidate[], frame: NonNullable<ReturnType<typeof materializeDebuggerStep>>, _state: ExecutionState): Map<string, number> {
  const paths = indexRuntimeLocationPaths(frame.locals, frame.scopeId);
  const ranks = new Map<string, number>();
  const requests = compileAttentionRequests({ frame, state: _state });
  const priorityFor = (location: RuntimeLocation, role: AttentionRequest["role"]): number => requests
    .filter((request) => request.subject.kind === "location"
      && runtimeLocationId(request.subject.location) === runtimeLocationId(location)
      && request.role === role)
    .reduce((highest, request) => Math.max(highest, request.priority), 0);
  const record = (location: RuntimeLocation | undefined, activity: "used" | "context", priority: number) => {
    if (!location) return;
    const owner = ownerForLocation(location, paths, candidates);
    if (!owner || owner.activity === "changed") return;
    if (activity === "used" || owner.activity === "idle") owner.activity = activity;
    ranks.set(owner.id, Math.max(ranks.get(owner.id) ?? 0, priority));
  };

  // Attention requests retain semantic role and priority. Only locations from events on this
  // presentation step refresh recency; persistent visual events contribute context only.
  const direct = new Map<string, RuntimeLocation>();
  const context = new Map<string, RuntimeLocation>();
  const events = frame.semanticEvents ?? [];
  const eventSequence = frame.eventIndex ?? frame.index;
  const eventFactIds = new Map(events.map((event, index) => [
    event,
    event.id ?? `event:${eventSequence}:semantic:${index}`,
  ]));
  const currentIds = new Set(eventFactIds.values());
  const currentFacts = _state.facts.flatMap((fact) =>
    fact.kind === "semantic" && currentIds.has(fact.event.id ?? "")
      ? [fact]
      : []
  );
  for (const event of events) {
    const normalized = currentFacts.find((fact) => fact.event.id === eventFactIds.get(event))?.event;
    // An explicit runtime location is authoritative. Otherwise use the normalized semantic
    // location (including sequence/map slot resolution) and only fall back to the actual
    // access container identity when that location has no visible owner.
    if (event.location) {
      direct.set(runtimeLocationId(event.location), event.location);
    } else if (normalized?.location) {
      const location = normalized.location;
      const owner = ownerForLocation(location, paths, candidates);
      if (owner) direct.set(runtimeLocationId(location), location);
      else {
        const identity = serializedIdentity(event.accessContainer);
        if (identity) {
          const containerLocation: RuntimeLocation = { kind: "identity", objectId: identity };
          direct.set(runtimeLocationId(containerLocation), containerLocation);
        }
      }
    } else if (event.accessContainer) {
      const identity = serializedIdentity(event.accessContainer);
      if (identity) {
        const containerLocation: RuntimeLocation = { kind: "identity", objectId: identity };
        direct.set(runtimeLocationId(containerLocation), containerLocation);
      }
    }
    for (const location of normalized?.sourceLocations ?? event.sourceLocations ?? []) context.set(runtimeLocationId(location), location);
  }
  for (const event of frame.activeVisualEvents ?? []) {
    if (event.location) context.set(runtimeLocationId(event.location), event.location);
    for (const location of event.sourceLocations ?? []) context.set(runtimeLocationId(location), location);
  }
  for (const [id, location] of direct) {
    record(location, "used", priorityFor(location, "mustShow"));
    context.delete(id);
  }
  for (const change of frame.changes.filter(isActualChange)) {
    const location = change.location ?? resolvePathLocation(change.path, frame.scopeId, frame.locals);
    const owner = ownerForMutation(location, paths, candidates);
    if (owner) ranks.set(owner.id, Math.max(ranks.get(owner.id) ?? 0, priorityFor(location, "mustShow")));
  }
  for (const location of context.values()) {
    record(location, "context", priorityFor(location, "context"));
  }
  for (const event of frame.semanticEvents ?? []) {
    for (const producerId of event.producerEventIds ?? []) {
      const producer = _state.facts.find((fact) => fact.kind === "semantic" && fact.event.id === producerId);
      if (producer?.kind === "semantic" && producer.event.location) {
        const location = producer.event.location;
        record(location, "context", priorityFor(location, "context"));
      }
    }
  }
  return ranks;
}

export function indexAttentionViews(variables: readonly SceneVariable[]): Array<AttentionView & { projection: SceneProjection }> {
  const candidates = candidatesForVariables(variables);
  applyCanonicalOccurrences(candidates, new Map());
  return candidates.map(({ projection, order: _order, occurrences: _occurrences, ...view }) => ({ ...view, projection }));
}

export function deriveSceneAttention(scene: VisualScene): AttentionSnapshot {
  const candidates = candidatesForVariables(scene.variables);
  for (const change of scene.changes.filter(isActualChange)) {
    const owner = (change.location ? ownerForMutation(change.location, new Map(), candidates) : undefined)
      ?? ownerForMutationPath(change.path, candidates);
    if (owner) {
      owner.changes.push(change);
      owner.activity = "changed";
    }
  }
  // Scene-only fallback has no runtime locations; its canonical focus paths remain usable.
  for (const path of scene.focusPaths) {
    if (scene.changes.some((change) => pathContains(change.path, path) || pathContains(path, change.path))) continue;
    const owner = ownerForPath(path, candidates);
    if (owner && owner.activity === "idle") owner.activity = "used";
  }
  const cap = 3;
  const hasStructural = candidates.some(({ kind }) => kind !== "scalar");
  const eligible = candidates.filter((candidate) => !hasStructural || candidate.kind !== "scalar")
    .sort((left, right) => activityTier(right.activity) - activityTier(left.activity) || left.path.localeCompare(right.path) || left.id.localeCompare(right.id));
  const workingIds = eligible.filter(({ activity }) => activity !== "idle").slice(0, cap).map(({ id }) => id);
  if (workingIds.length === 0 && eligible[0]) workingIds.push(eligible[0].id);
  return { stepIndex: scene.frameIndex, views: candidates.map(toAttentionView), workingIds };
}

function ownerForMutationPath(path: string, candidates: Candidate[]): Candidate | undefined {
  const slot = path.replace(/(?:\.[A-Za-z_]\w*|\[-?\d+\])$/, "");
  const matches = candidates.flatMap((candidate) => [candidate.path, ...candidate.aliases]
    .filter((candidatePath) => pathContains(candidatePath, slot))
    .map((candidatePath) => ({ candidate, candidatePath })));
  return matches.sort((left, right) => right.candidatePath.length - left.candidatePath.length || left.candidate.order - right.candidate.order)[0]?.candidate;
}

function toAttentionView(candidate: Candidate): AttentionView {
  const { projection: _projection, order: _order, occurrences: _occurrences, ...view } = candidate;
  return view;
}

export function compileAttentionTimeline(trace: ExecutionTrace, options: CompileAttentionOptions = {}): AttentionSnapshot[] {
  const maxWorkingViews = Math.max(1, options.maxWorkingViews ?? 3);
  const states = options.executionTimeline ?? materializeExecutionTimeline(trace);
  const contracts = options.projectionContracts ?? trace.runSpec.projectionContracts;
  const snapshots: AttentionSnapshot[] = [];
  const lastRelevant = new Map<string, number>();
  const lastPriority = new Map<string, number>();
  const lastTier = new Map<string, number>();
  const canonicalById = new Map<string, { path: string; label: string }>();
  let working: string[] = [];
  for (let stepIndex = 0; stepIndex < debuggerStepCount(trace); stepIndex += 1) {
    const frame = materializeDebuggerStep(trace, stepIndex);
    const state = states[stepIndex];
    if (!frame || !state) continue;
    const registry = new ProjectionRegistry([], contracts);
    const candidates = candidatesForVariables(projectSceneVariables(frame, registry));
    applyCanonicalOccurrences(candidates, canonicalById);
    const paths = indexRuntimeLocationPaths(frame.locals, frame.scopeId);
    frameChanges(candidates, frame, paths);
    const priorities = applyEvidence(candidates, frame, state);
    const present = new Set(candidates.map(({ id }) => id));
    working = working.filter((id) => present.has(id));

    const hasStructural = candidates.some(({ kind }) => kind !== "scalar");
    if (hasStructural) working = working.filter((id) => candidates.find(({ id: candidateId }) => candidateId === id)?.kind !== "scalar");
    const rankedDirect = candidates.filter((candidate) =>
      candidate.activity === "changed" || candidate.activity === "used"
    ).filter((candidate) => !hasStructural || candidate.kind !== "scalar")
      .sort((left, right) => activityTier(right.activity) - activityTier(left.activity)
        || (priorities.get(right.id) ?? 0) - (priorities.get(left.id) ?? 0)
        || left.path.localeCompare(right.path) || left.id.localeCompare(right.id));
    for (const candidate of rankedDirect) {
      lastRelevant.set(candidate.id, stepIndex);
      lastPriority.set(candidate.id, priorities.get(candidate.id) ?? 0);
      lastTier.set(candidate.id, activityTier(candidate.activity));
    }
    for (const candidate of rankedDirect) {
      if (working.includes(candidate.id)) continue;
      if (working.length < maxWorkingViews) {
        working.push(candidate.id);
        continue;
      }
      const least = [...working].sort((leftId, rightId) => compareAttentionStrength(
        candidates.find(({ id }) => id === leftId)!, candidates.find(({ id }) => id === rightId)!,
        lastRelevant, lastTier, lastPriority,
      ))[0];
      const victim = least && candidates.find(({ id }) => id === least);
      if (least && victim && compareAttentionStrength(candidate, victim, lastRelevant, lastTier, lastPriority) > 0) {
        working[working.indexOf(least)] = candidate.id;
      }
    }
    // Context can use spare room, but cannot displace directly evidenced views.
    if (working.length < maxWorkingViews) {
      for (const candidate of candidates.filter((candidate) => !hasStructural || candidate.kind !== "scalar")
        .filter(({ activity }) => activity === "context")
        .sort((left, right) => (priorities.get(right.id) ?? 0) - (priorities.get(left.id) ?? 0) || left.path.localeCompare(right.path) || left.id.localeCompare(right.id))) {
        if (!working.includes(candidate.id) && working.length < maxWorkingViews) working.push(candidate.id);
      }
    }
    if (working.length === 0 && candidates.length) {
      const initial = candidates.find(({ kind }) => !hasStructural || kind !== "scalar") ?? candidates[0];
      working.push(initial.id);
    }

    const visibleCandidates = candidates.map(toAttentionView);
    snapshots.push({ stepIndex, views: visibleCandidates, workingIds: [...working] });
  }
  return snapshots;
}

function activityTier(activity: AttentionActivity): number {
  return activity === "changed" ? 3 : activity === "used" ? 2 : activity === "context" ? 1 : 0;
}

function compareAttentionStrength(
  left: Candidate,
  right: Candidate,
  lastRelevant: Map<string, number>,
  lastTier: Map<string, number>,
  lastPriority: Map<string, number>,
): number {
  return (lastRelevant.get(left.id) ?? -1) - (lastRelevant.get(right.id) ?? -1)
    || (lastTier.get(left.id) ?? 0) - (lastTier.get(right.id) ?? 0)
    || (lastPriority.get(left.id) ?? 0) - (lastPriority.get(right.id) ?? 0)
    || right.path.localeCompare(left.path)
    || right.id.localeCompare(left.id);
}
