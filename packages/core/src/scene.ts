import type {
  GraphProjectionConfiguration,
  MappingValue,
  ObjectValue,
  ProjectionContractsV1,
  ProjectionTargetSegment,
  SequenceValue,
  SerializedValue,
  SetValue,
  SemanticEvent,
  TraceFrame,
  ValueChange,
} from "./types";
import { compileMotionPlan, type SceneMotionPlan } from "./motion";
import {
  type CallFlowProjection,
} from "./callLens";
import {
  materializeExecutionState,
  type ExecutionState,
} from "./executionModel";
import {
  indexRuntimeLocationPaths,
  mappingEntryId,
  resolveExpressionLocation,
  runtimeLocationId,
} from "./locations";
import {
  compileExecutionLenses,
  type AttentionRequest,
  type ControlFlowProjection,
  type DataFlowProjection,
} from "./lenses";

export const SCENE_IR_VERSION = 2 as const;

export interface ScalarProjection {
  kind: "scalar";
  key: string;
  label: string;
  type: string;
  value: string;
}

export interface SequenceProjection {
  kind: "sequence";
  key: string;
  label: string;
  type: string;
  items: SceneProjection[];
}

export interface GridProjection {
  kind: "grid";
  key: string;
  label: string;
  type: string;
  rows: SceneProjection[][];
}

export interface GraphVertexProjection {
  id: string;
  label: string;
  value: SceneProjection;
  adjacency: SceneProjection;
}

export interface GraphEdgeProjection {
  id: string;
  sourceId: string;
  targetId: string;
}

export interface GraphProjection {
  kind: "graph";
  key: string;
  label: string;
  type: string;
  layout: "tree" | "network";
  rootId?: string;
  directed: boolean;
  vertices: GraphVertexProjection[];
  edges: GraphEdgeProjection[];
}

export interface MappingProjection {
  kind: "mapping";
  key: string;
  label: string;
  type: string;
  entries: Array<{ key: SceneProjection; value: SceneProjection }>;
}

export interface ObjectProjection {
  kind: "object";
  key: string;
  label: string;
  type: string;
  fields: Array<{ name: string; value: SceneProjection }>;
}

export interface ReferenceProjection {
  kind: "reference";
  key: string;
  label: string;
  type: string;
  targetId: string;
}

export interface TruncatedProjection {
  kind: "truncated";
  key: string;
  label: string;
  type: string;
  preview: string;
}

export type SceneProjection =
  | ScalarProjection
  | SequenceProjection
  | GridProjection
  | GraphProjection
  | MappingProjection
  | ObjectProjection
  | ReferenceProjection
  | TruncatedProjection;

export interface SceneVariable {
  name: string;
  projection: SceneProjection;
  changed: boolean;
  changeCount: number;
  graphFacet?: GraphFacet;
}

export interface GraphFacet {
  directed: boolean;
  provenance: "runtime-evidence";
}

export interface RelationEntity {
  id: string;
  type: string;
  label: string;
  projection: ObjectProjection;
}

export interface RelationEdge {
  sourceId: string;
  targetId: string;
  label: string;
}

export interface RelationGraph {
  layout: "tree" | "network" | "cycle";
  roots: string[];
  entities: RelationEntity[];
  edges: RelationEdge[];
}

export interface VisualScene {
  schemaVersion: typeof SCENE_IR_VERSION;
  frameIndex: number;
  line: number;
  event: TraceFrame["event"];
  functionName: string;
  callStack: TraceFrame["callStack"];
  entityBindings: EntityBinding[];
  variables: SceneVariable[];
  changes: ValueChange[];
  operations: SemanticEvent[];
  focusPaths: string[];
  variableMarkers: VariableMarker[];
  focusedGraphVertexIds: string[];
  graphMemberships: GraphMembership[];
  motionPlan: SceneMotionPlan;
  operationMotion?: OperationMotionPlan;
  focusedEntityIds: string[];
  focusedRelationKeys: string[];
  causalLinks: CausalLink[];
  stdout: string;
  exception?: string;
  relationGraph?: RelationGraph;
  callFlow?: CallFlowProjection;
  controlFlow: ControlFlowProjection;
  dataFlow: DataFlowProjection;
  attention: AttentionRequest[];
  /** @deprecated Use callFlow. */
  recursion?: RecursionProjection;
}

/** @deprecated Use CallFrameProjection. */
export interface RecursionFrameProjection {
  scopeId: string;
  functionName: string;
  line: number;
  bindings: Array<{ name: string; value: string }>;
  returnValue?: string;
}

/** @deprecated Use CallFlowProjection. */
export interface RecursionProjection {
  frames: RecursionFrameProjection[];
}

export interface OperationMotionPlan {
  id: string;
  expression: string;
  operandTexts: string[];
  sourcePaths: Array<string | null>;
  operatorToken: string;
  resultText: string;
  targetPath?: string;
}

export interface VariableMarker {
  id: string;
  label: string;
  path: string;
}

export interface EntityBinding {
  entityId: string;
  label: string;
}

export interface GraphMembership {
  graphKey: string;
  variableName: string;
  vertexIds: string[];
}

export interface CausalLink {
  source: string;
  target: string;
  sourceKind: "value" | "call";
  sourceLocationId?: string;
  targetLocationId?: string;
  sourceLabel?: string;
  targetLabel?: string;
}

export interface ProjectionContext {
  key: string;
  label: string;
  depth: number;
}

export interface ProjectionRule {
  id: string;
  priority: number;
  matches(
    value: SerializedValue,
    context: ProjectionContext,
    registry: ProjectionRegistry,
  ): boolean;
  project(
    value: SerializedValue,
    context: ProjectionContext,
    registry: ProjectionRegistry,
  ): SceneProjection;
}

function scalarText(value: SerializedValue): string {
  if (value.kind !== "scalar") {
    return "";
  }
  if (value.value === null) {
    return "null";
  }
  if (typeof value.value === "string") {
    return JSON.stringify(value.value);
  }
  return String(value.value);
}

function projectionScalarToken(
  projection: SceneProjection,
): string | undefined {
  return projection.kind === "scalar"
    ? `${projection.type}:${projection.value}`
    : undefined;
}

export function inferGraphFacet(
  projection: SceneProjection,
): GraphFacet | undefined {
  let vertices: string[];
  let rows: SceneProjection[][];
  if (projection.kind === "sequence") {
    if (projection.items.some((item) => item.kind !== "sequence")) {
      return undefined;
    }
    vertices = projection.items.map((_, index) => `int:${index}`);
    rows = projection.items.map((item) =>
      item.kind === "sequence" ? item.items : []
    );
  } else if (projection.kind === "grid") {
    vertices = projection.rows.map((_, index) => `int:${index}`);
    rows = projection.rows;
  } else if (projection.kind === "mapping") {
    const entries = projection.entries.map((entry) => ({
      vertex: projectionScalarToken(entry.key),
      adjacency:
        entry.value.kind === "sequence" ? entry.value.items : undefined,
    }));
    if (
      entries.some(
        (entry) => entry.vertex === undefined || entry.adjacency === undefined,
      )
    ) {
      return undefined;
    }
    vertices = entries.map((entry) => entry.vertex!);
    rows = entries.map((entry) => entry.adjacency!);
  } else {
    return undefined;
  }
  if (vertices.length === 0) {
    return undefined;
  }
  const vertexSet = new Set(vertices);
  const edges = new Set<string>();
  rows.forEach((row, sourceIndex) => {
    row.forEach((neighbor) => {
      const target = projectionScalarToken(neighbor);
      if (target) {
        edges.add(JSON.stringify([vertices[sourceIndex], target]));
      }
    });
  });
  if (
    edges.size === 0 ||
    rows.flat().some((neighbor) => {
      const target = projectionScalarToken(neighbor);
      return target === undefined || !vertexSet.has(target);
    })
  ) {
    return undefined;
  }
  return {
    directed: [...edges].some((edge) => {
      const [source, target] = JSON.parse(edge) as [string, string];
      return (
        source !== target &&
        !edges.has(JSON.stringify([target, source]))
      );
    }),
    provenance: "runtime-evidence",
  };
}

function isRectangularGrid(value: SequenceValue): boolean {
  if (value.items.length < 2 || !value.items.every((item) => item.kind === "sequence")) {
    return false;
  }
  const widths = value.items.map((item) => (item as SequenceValue).items.length);
  return widths[0] > 0 && widths.every((width) => width === widths[0]);
}

interface AdjacencyCandidate {
  vertices: Array<{
    id: string;
    label: string;
    value: SerializedValue;
    adjacency: SequenceValue | SetValue;
  }>;
  edges: GraphEdgeProjection[];
  layout: "tree" | "network";
  rootId?: string;
  directed: boolean;
}

function scalarIdentity(value: SerializedValue): string | undefined {
  return value.kind === "scalar"
    ? `${value.type}:${JSON.stringify(value.value)}`
    : undefined;
}

function adjacencyCandidate(
  value: SerializedValue,
  directed: boolean,
): AdjacencyCandidate | undefined {
  const records: Array<{
    value: SerializedValue;
    adjacency: SequenceValue | SetValue;
  }> = [];

  if (value.kind === "sequence") {
    for (const [index, adjacency] of value.items.entries()) {
      if (adjacency.kind !== "sequence" && adjacency.kind !== "set") {
        return undefined;
      }
      records.push({
        value: { kind: "scalar", type: "int", value: index },
        adjacency,
      });
    }
  } else if (value.kind === "mapping") {
    for (const [key, adjacency] of value.entries) {
      if (
        scalarIdentity(key) === undefined ||
        (adjacency.kind !== "sequence" && adjacency.kind !== "set")
      ) {
        return undefined;
      }
      records.push({ value: key, adjacency });
    }
  } else {
    return undefined;
  }

  const vertexIndex = new Map<string, number>();
  for (const [index, record] of records.entries()) {
    const identity = scalarIdentity(record.value);
    if (identity === undefined || vertexIndex.has(identity)) {
      return undefined;
    }
    vertexIndex.set(identity, index);
  }
  const vertexIds = records.map((record, index) =>
    value.kind === "sequence"
      ? `${value.id}:vertex:${index}`
      : `${value.id}:vertex:${encodeURIComponent(scalarIdentity(record.value)!)}`,
  );

  const rawEdges: Array<{ source: number; target: number }> = [];
  for (const [source, record] of records.entries()) {
    for (const neighbor of record.adjacency.items) {
      const target = vertexIndex.get(scalarIdentity(neighbor) ?? "");
      if (target === undefined) {
        return undefined;
      }
      rawEdges.push({ source, target });
    }
  }
  const edgePairs = new Set(rawEdges.map(({ source, target }) => `${source}:${target}`));
  if (
    !directed &&
    rawEdges.some(({ source, target }) => source !== target && !edgePairs.has(`${target}:${source}`))
  ) {
    return undefined;
  }
  const seenEdges = new Set<string>();
  const edges = rawEdges.flatMap(({ source, target }) => {
    const sourceId = vertexIds[source];
    const targetId = vertexIds[target];
    const endpoints = directed
      ? `${sourceId}->${targetId}`
      : [sourceId, targetId].sort().join("<->");
    if (seenEdges.has(endpoints)) {
      return [];
    }
    seenEdges.add(endpoints);
    return [{
      id: `${value.id}:edge:${endpoints}`,
      sourceId,
      targetId,
    }];
  });
  const adjacency = records.map(() => new Set<number>());
  const indegrees = records.map(() => 0);
  rawEdges.forEach(({ source, target }) => {
    adjacency[source].add(target);
    if (!directed) {
      adjacency[target].add(source);
    }
    indegrees[target] += 1;
  });
  const rootIndex = directed
    ? indegrees.findIndex((degree) => degree === 0)
    : 0;
  const uniqueDirectedRoot =
    !directed || indegrees.filter((degree) => degree === 0).length === 1;
  const visited = new Set<number>();
  const pending = rootIndex >= 0 ? [rootIndex] : [];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    adjacency[current].forEach((target) => pending.push(target));
  }
  const isTree =
    edges.length === records.length - 1 &&
    uniqueDirectedRoot &&
    visited.size === records.length &&
    (!directed || indegrees.every((degree, index) => index === rootIndex ? degree === 0 : degree === 1));

  return {
    vertices: records.map((record, index) => ({
      id: vertexIds[index],
      label: scalarText(record.value),
      value: record.value,
      adjacency: record.adjacency,
    })),
    edges,
    layout: isTree ? "tree" : "network",
    rootId: isTree ? vertexIds[rootIndex] : undefined,
    directed,
  };
}

const rules: ProjectionRule[] = [
  {
    id: "contract-graph",
    priority: 130,
    matches: (value, _context, registry) =>
      registry.isInvalidGraphValue(value) || registry.graphConfiguration(value) !== undefined,
    project: (value, context, registry): SceneProjection => {
      if (registry.isInvalidGraphValue(value)) {
        return {
          kind: "truncated",
          key: context.key,
          label: context.label,
          type: value.type,
          preview: "Invalid adjacency-list graph contract",
        };
      }
      const configuration = registry.graphConfiguration(value)!;
      const graphValue = registry.graphValue(value);
      const candidate = graphValue
        ? adjacencyCandidate(graphValue, configuration.directed)
        : undefined;
      if (!candidate) {
        return {
          kind: "truncated",
          key: context.key,
          label: context.label,
          type: graphValue?.type ?? value.type,
          preview: "Invalid adjacency-list graph contract",
        };
      }
      return {
        kind: "graph",
        key: graphValue!.id,
        label: context.label,
        type: graphValue!.type,
        layout: candidate.layout,
        rootId: candidate.rootId,
        directed: candidate.directed,
        vertices: candidate.vertices.map((vertex) => ({
          id: vertex.id,
          label: vertex.label,
          value: registry.project(vertex.value, {
            key: `${vertex.id}:value`,
            label: vertex.label,
            depth: context.depth + 1,
          }),
          adjacency: registry.project(vertex.adjacency, {
            key: `${vertex.id}:adjacency`,
            label: `Neighbors of ${vertex.label}`,
            depth: context.depth + 1,
          }),
        })),
        edges: candidate.edges,
      };
    },
  },
  {
    id: "grid",
    priority: 120,
    matches: (value) =>
      value.kind === "sequence" &&
      isRectangularGrid(value),
    project: (rawValue, context, registry): GridProjection => {
      const value = rawValue as SequenceValue;
      return {
      kind: "grid",
      key: value.id,
      label: context.label,
      type: value.type,
      rows: value.items.map((row, rowIndex) =>
        (row as SequenceValue).items.map((item, columnIndex) =>
          registry.project(item, {
            key: `${value.id}:${rowIndex}:${columnIndex}`,
            label: `[${rowIndex}][${columnIndex}]`,
            depth: context.depth + 1,
          }),
        ),
      ),
      };
    },
  },
  {
    id: "sequence",
    priority: 90,
    matches: (value) => value.kind === "sequence",
    project: (rawValue, context, registry): SequenceProjection => {
      const value = rawValue as SequenceValue;
      return {
      kind: "sequence",
      key: value.id,
      label: context.label,
      type: value.type,
      items: value.items.map((item, index) =>
        registry.project(item, {
          key: `${value.id}:${index}`,
          label: String(index),
          depth: context.depth + 1,
        }),
      ),
      };
    },
  },
  {
    id: "mapping",
    priority: 80,
    matches: (value) => value.kind === "mapping",
    project: (rawValue, context, registry): MappingProjection => {
      const value = rawValue as MappingValue;
      return {
      kind: "mapping",
      key: value.id,
      label: context.label,
      type: value.type,
      entries: value.entries.map(([key, item], index) => ({
        key: registry.project(key, {
          key: `${mappingEntryId(value, index)}:key`,
          label: "key",
          depth: context.depth + 1,
        }),
        value: registry.project(item, {
          key: `${mappingEntryId(value, index)}:value`,
          label: "value",
          depth: context.depth + 1,
        }),
      })),
      };
    },
  },
  {
    id: "set",
    priority: 70,
    matches: (value) => value.kind === "set",
    project: (rawValue, context, registry): SequenceProjection => {
      const value = rawValue as SetValue;
      return {
      kind: "sequence",
      key: value.id,
      label: context.label,
      type: value.type,
      items: value.items.map((item, index) =>
        registry.project(item, {
          key:
            value.itemIds?.[index] ??
            `${value.id}:member:${JSON.stringify(item)}`,
          label: String(index),
          depth: context.depth + 1,
        }),
      ),
      };
    },
  },
  {
    id: "object",
    priority: 60,
    matches: (value) => value.kind === "object",
    project: (rawValue, context, registry): ObjectProjection => {
      const value = rawValue as ObjectValue;
      return {
      kind: "object",
      key: value.id,
      label: context.label,
      type: value.type,
      fields: Object.entries(value.fields).map(([name, item]) => ({
        name,
        value: registry.project(item, {
          key: `${value.id}:${name}`,
          label: name,
          depth: context.depth + 1,
        }),
      })),
      };
    },
  },
  {
    id: "reference",
    priority: 50,
    matches: (value) => value.kind === "reference",
    project: (rawValue, context): ReferenceProjection => {
      const value = rawValue as Extract<SerializedValue, { kind: "reference" }>;
      return {
      kind: "reference",
      key: context.key,
      label: context.label,
      type: value.type,
      targetId: value.targetId,
      };
    },
  },
  {
    id: "scalar",
    priority: 40,
    matches: (value) => value.kind === "scalar",
    project: (rawValue, context): ScalarProjection => {
      const value = rawValue as Extract<SerializedValue, { kind: "scalar" }>;
      return {
      kind: "scalar",
      key: context.key,
      label: context.label,
      type: value.type,
      value: scalarText(value),
      };
    },
  },
  {
    id: "truncated",
    priority: 0,
    matches: (value) => value.kind === "truncated",
    project: (rawValue, context): TruncatedProjection => {
      const value = rawValue as Extract<SerializedValue, { kind: "truncated" }>;
      return {
      kind: "truncated",
      key: context.key,
      label: context.label,
      type: value.type,
      preview: value.preview,
      };
    },
  },
];

export class ProjectionRegistry {
  private readonly rules: ProjectionRule[];
  private readonly contracts?: ProjectionContractsV1;
  private readonly graphConfigurations = new Map<string, GraphProjectionConfiguration>();
  private readonly valuesByIdentity = new Map<string, SerializedValue>();
  private readonly invalidGraphValues = new WeakSet<object>();
  private readonly graphEvidence = new Set<string>();

  constructor(
    customRules: ProjectionRule[] = [],
    contracts?: ProjectionContractsV1,
    bindings: Record<string, SerializedValue> = {},
  ) {
    this.rules = [...customRules, ...rules].sort((left, right) => right.priority - left.priority);
    this.contracts = contracts;
    this.observeBindings(bindings);
  }

  project(value: SerializedValue, context: ProjectionContext): SceneProjection {
    return this.projectWithRules(value, context, this.rules);
  }

  projectStructural(value: SerializedValue, context: ProjectionContext): SceneProjection {
    return this.projectWithRules(
      value,
      context,
      this.rules.filter((rule) => rule.id !== "contract-graph"),
    );
  }

  graphConfiguration(
    value: SerializedValue,
  ): GraphProjectionConfiguration | undefined {
    const identity = valueIdentity(value);
    return identity ? this.graphConfigurations.get(identity) : undefined;
  }

  isInvalidGraphValue(value: SerializedValue): boolean {
    return this.invalidGraphValues.has(value);
  }

  observeRuntimeEvidence(
    events: SemanticEvent[],
    bindings: Record<string, SerializedValue>,
  ): void {
    for (const event of events) {
      const expressions = [
        event.kind === "iteration" ? event.iteratorExpression : undefined,
        event.kind === "mutation" || event.kind === "call"
          ? event.expression
          : undefined,
      ].filter((value): value is string => value !== undefined);
      for (const expression of expressions) {
        const match = /^([A-Za-z_]\w*)\s*\[/.exec(expression.trim());
        const value = match ? bindings[match[1]] : undefined;
        const identity = valueIdentity(value);
        if (identity) {
          this.graphEvidence.add(identity);
        }
      }
    }
  }

  hasGraphEvidence(value: SerializedValue): boolean {
    const identity = valueIdentity(value);
    return identity !== undefined && this.graphEvidence.has(identity);
  }

  graphValue(
    value: SerializedValue,
  ): SequenceValue | MappingValue | undefined {
    const identity = valueIdentity(value);
    const resolved = identity ? this.valuesByIdentity.get(identity) : undefined;
    return resolved?.kind === "sequence" || resolved?.kind === "mapping"
      ? resolved
      : undefined;
  }

  observeBindings(bindings: Record<string, SerializedValue>): void {
    indexConcreteValues(Object.values(bindings), this.valuesByIdentity);
    const resolvedContracts = resolveGraphConfigurations(this.contracts, bindings);
    resolvedContracts.invalidTargets.forEach((target) => this.invalidGraphValues.add(target));
    for (const [identity, configuration] of resolvedContracts.configurations) {
      const existing = this.graphConfigurations.get(identity);
      if (
        existing &&
        (
          existing.kind !== configuration.kind ||
          existing.representation !== configuration.representation ||
          existing.directed !== configuration.directed
        )
      ) {
        throw new Error(
          `Conflicting projection contracts resolve to identity '${identity}'`,
        );
      }
      this.graphConfigurations.set(identity, configuration);
    }
  }

  private projectWithRules(
    value: SerializedValue,
    context: ProjectionContext,
    availableRules: ProjectionRule[],
  ): SceneProjection {
    const rule = availableRules.find((candidate) =>
      candidate.matches(value, context, this)
    );
    if (!rule) {
      return {
        kind: "truncated",
        key: context.key,
        label: context.label,
        type: "unknown",
        preview: "Unsupported value",
      };
    }
    return rule.project(value, context, this);
  }
}

function indexConcreteValues(
  roots: SerializedValue[],
  values: Map<string, SerializedValue>,
): void {
  const pending = [...roots];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const value = pending.pop()!;
    const identity = valueIdentity(value);
    if (identity && value.kind !== "reference") {
      values.set(identity, value);
      if (visited.has(identity)) {
        continue;
      }
      visited.add(identity);
    }
    if (value.kind === "sequence" || value.kind === "set") {
      pending.push(...value.items);
    } else if (value.kind === "mapping") {
      value.entries.forEach(([key, item]) => pending.push(key, item));
    } else if (value.kind === "object") {
      pending.push(...Object.values(value.fields));
    }
  }
}

function scalarValuesEqual(
  left: SerializedValue,
  right: SerializedValue,
): boolean {
  return (
    left.kind === "scalar" &&
    right.kind === "scalar" &&
    left.type === right.type &&
    left.value === right.value
  );
}

function resolveContractTarget(
  bindings: Record<string, SerializedValue>,
  root: string,
  segments: ProjectionTargetSegment[],
): SerializedValue | undefined {
  let current: SerializedValue | undefined = bindings[root];
  for (const segment of segments) {
    if (!current) {
      return undefined;
    }
    if (segment.kind === "field") {
      current = current.kind === "object" ? current.fields[segment.name] : undefined;
      continue;
    }
    if (segment.kind === "index") {
      current =
        current.kind === "sequence" || current.kind === "set"
          ? current.items[segment.index]
          : undefined;
      continue;
    }
    if (current.kind !== "mapping") {
      return undefined;
    }
    current = current.entries.find(([key]) =>
      scalarValuesEqual(key, segment.key)
    )?.[1];
  }
  return current;
}

function resolveGraphConfigurations(
  contracts: ProjectionContractsV1 | undefined,
  bindings: Record<string, SerializedValue>,
): {
  configurations: ReadonlyMap<string, GraphProjectionConfiguration>;
  invalidTargets: SerializedValue[];
} {
  const declarationsByIdentity = new Map<
    string,
    Array<{
      id: string;
      configuration: GraphProjectionConfiguration;
    }>
  >();
  const invalidTargets: SerializedValue[] = [];
  for (const declaration of contracts?.declarations ?? []) {
    const target = resolveContractTarget(
      bindings,
      declaration.target.root.name,
      declaration.target.segments,
    );
    const identity = valueIdentity(target);
    if (!identity) {
      if (target) {
        invalidTargets.push(target);
      }
      continue;
    }
    const declarations = declarationsByIdentity.get(identity) ?? [];
    declarations.push({
      id: declaration.id,
      configuration: declaration.configuration,
    });
    declarationsByIdentity.set(identity, declarations);
  }

  const configurations = new Map<string, GraphProjectionConfiguration>();
  for (const [identity, declarations] of declarationsByIdentity) {
    const orderedDeclarations = [...declarations].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    );
    const configuration = orderedDeclarations[0].configuration;
    if (
      orderedDeclarations.some((declaration) =>
        !graphConfigurationsEqual(configuration, declaration.configuration)
      )
    ) {
      // Different paths can resolve to aliases of the same runtime container.
      throw new Error(
        `Projection contracts ${orderedDeclarations
          .map((declaration) => `'${declaration.id}'`)
          .join(", ")} ` +
          `resolve to identity '${identity}'`,
      );
    }
    configurations.set(identity, configuration);
  }
  return { configurations, invalidTargets };
}

function graphConfigurationsEqual(
  left: GraphProjectionConfiguration,
  right: GraphProjectionConfiguration,
): boolean {
  return (
    left.kind === right.kind &&
    left.representation === right.representation &&
    left.directed === right.directed
  );
}

function variableChanged(name: string, changes: ValueChange[]): ValueChange[] {
  return changes.filter(
    (change) =>
      change.path === name ||
      change.path.startsWith(`${name}[`) ||
      change.path.startsWith(`${name}.`) ||
      change.path.startsWith(`${name}{`),
  );
}

function scalarNumber(value: SerializedValue | undefined): number | undefined {
  if (value?.kind !== "scalar" || typeof value.value !== "number") {
    return undefined;
  }
  return value.value;
}

function resolveIndexExpression(
  expression: string,
  locals: Record<string, SerializedValue>,
): number | undefined {
  const trimmed = expression.trim();
  if (/^-?\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  const variable = /^([A-Za-z_]\w*)$/.exec(trimmed);
  if (variable) {
    return scalarNumber(locals[variable[1]]);
  }
  const offset = /^([A-Za-z_]\w*)\s*([+-])\s*(\d+)$/.exec(trimmed);
  if (offset) {
    const base = scalarNumber(locals[offset[1]]);
    if (base === undefined) {
      return undefined;
    }
    return offset[2] === "+" ? base + Number(offset[3]) : base - Number(offset[3]);
  }
  return undefined;
}

function expressionValue(
  expression: string,
  locals: Record<string, SerializedValue>,
): SerializedValue | undefined {
  const trimmed = expression.trim();
  if (/^[A-Za-z_]\w*$/.test(trimmed)) {
    return locals[trimmed];
  }
  const number = resolveIndexExpression(trimmed, locals);
  if (number !== undefined) {
    return { kind: "scalar", type: "int", value: number };
  }
  if (trimmed === "True" || trimmed === "False") {
    return { kind: "scalar", type: "bool", value: trimmed === "True" };
  }
  if (trimmed === "None") {
    return { kind: "scalar", type: "NoneType", value: null };
  }
  const quoted = /^(["'])(.*)\1$/.exec(trimmed);
  if (quoted) {
    const value = quoted[2].replace(
      /\\(["'\\nrt])/g,
      (_, escaped: string) =>
        ({ n: "\n", r: "\r", t: "\t" })[escaped] ?? escaped,
    );
    return { kind: "scalar", type: "str", value };
  }
  return undefined;
}

function serializedKeysEqual(
  left: SerializedValue,
  right: SerializedValue,
): boolean {
  if (left.kind === "scalar" && right.kind === "scalar") {
    const leftNumeric =
      typeof left.value === "number" || typeof left.value === "boolean";
    const rightNumeric =
      typeof right.value === "number" || typeof right.value === "boolean";
    if (leftNumeric && rightNumeric) {
      return Number(left.value) === Number(right.value);
    }
    return Object.is(left.value, right.value);
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function resolveAccessPath(
  expression: string,
  locals: Record<string, SerializedValue>,
): string | undefined {
  const normalized = expression.trim();
  const root = /^([A-Za-z_]\w*)/.exec(normalized);
  if (!root || !(root[1] in locals)) {
    return undefined;
  }

  let cursor = root[0].length;
  let path = root[1];
  let current: SerializedValue | undefined = locals[root[1]];
  while (cursor < normalized.length) {
    const remaining = normalized.slice(cursor);
    const field = /^\.([A-Za-z_]\w*)/.exec(remaining);
    if (field) {
      path += `.${field[1]}`;
      current =
        current?.kind === "object"
          ? current.fields[field[1]]
          : undefined;
      cursor += field[0].length;
      continue;
    }
    const index = /^\[([^\]]+)\]/.exec(remaining);
    if (index) {
      if (current?.kind === "mapping") {
        const key = expressionValue(index[1], locals);
        if (!key) {
          return undefined;
        }
        const entryIndex = current.entries.findIndex(([candidate]) =>
          serializedKeysEqual(candidate, key),
        );
        if (entryIndex < 0) {
          return undefined;
        }
        path += `{${entryIndex}}.value`;
        current = current.entries[entryIndex][1];
        cursor += index[0].length;
        continue;
      }
      const resolved = resolveIndexExpression(index[1], locals);
      if (resolved === undefined) {
        return undefined;
      }
      path += `[${resolved}]`;
      current =
        current?.kind === "sequence"
          ? current.items[resolved]
          : undefined;
      cursor += index[0].length;
      continue;
    }
    return undefined;
  }
  return path;
}

function valueAtAccessPath(
  path: string,
  locals: Record<string, SerializedValue>,
): SerializedValue | undefined {
  const root = /^([A-Za-z_]\w*)/.exec(path);
  if (!root) {
    return undefined;
  }
  let current = locals[root[1]];
  let cursor = root[0].length;
  while (current && cursor < path.length) {
    const remaining = path.slice(cursor);
    const mapping = /^\{(\d+)\}\.(key|value)/.exec(remaining);
    if (mapping && current.kind === "mapping") {
      const entry: [SerializedValue, SerializedValue] | undefined =
        current.entries[Number(mapping[1])];
      current = entry?.[mapping[2] === "key" ? 0 : 1];
      cursor += mapping[0].length;
      continue;
    }
    const field = /^\.([A-Za-z_]\w*)/.exec(remaining);
    if (field && current.kind === "object") {
      current = current.fields[field[1]];
      cursor += field[0].length;
      continue;
    }
    const index = /^\[(-?\d+)\]/.exec(remaining);
    if (index && (current.kind === "sequence" || current.kind === "set")) {
      current = current.items[Number(index[1])];
      cursor += index[0].length;
      continue;
    }
    return undefined;
  }
  return current;
}

function splitTopLevelArguments(expression: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index];
    if (quote) {
      if (character === quote && expression[index - 1] !== "\\") {
        quote = "";
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if ("([{".includes(character)) {
      depth += 1;
    } else if (")]}".includes(character)) {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      parts.push(expression.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(expression.slice(start).trim());
  return parts;
}

interface IteratorSource {
  collectionExpression: string;
  indexFromResult: boolean;
  resultItemIndex?: number;
}

function iteratorSource(expression: string): IteratorSource | undefined {
  const trimmed = expression.trim();
  const enumerate = /^enumerate\((.*)\)$/.exec(trimmed);
  if (enumerate) {
    return {
      collectionExpression: splitTopLevelArguments(enumerate[1])[0],
      indexFromResult: true,
      resultItemIndex: 0,
    };
  }
  const rangeCollection = /len\(([^()]+)\)/.exec(trimmed);
  if (trimmed.startsWith("range(") && rangeCollection) {
    return {
      collectionExpression: rangeCollection[1].trim(),
      indexFromResult: true,
    };
  }
  const wrapper = /^(?:reversed|iter)\((.*)\)$/.exec(trimmed);
  if (wrapper) {
    const nested = iteratorSource(wrapper[1]);
    return nested ?? {
      collectionExpression: wrapper[1].trim(),
      indexFromResult: false,
    };
  }
  const mappingMethod = /^(.*)\.(?:items|keys|values)\(\)$/.exec(trimmed);
  return {
    collectionExpression: mappingMethod?.[1].trim() ?? trimmed,
    indexFromResult: false,
  };
}

function iterationTargetNames(target: string | undefined): string[] {
  return (target ?? "item")
    .replace(/^[[(]\s*|\s*[\])]$/g, "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function scalarResultAt(
  event: SemanticEvent,
  itemIndex: number | undefined,
): SerializedValue | undefined {
  if (
    itemIndex !== undefined &&
    event.result?.kind === "sequence"
  ) {
    return event.result.items[itemIndex];
  }
  return event.result;
}

function markerIndex(
  event: SemanticEvent,
  source: IteratorSource,
): number | undefined {
  if (!source.indexFromResult) {
    return event.iterationIndex;
  }
  const result = scalarResultAt(event, source.resultItemIndex);
  return result?.kind === "scalar" && typeof result.value === "number"
    ? result.value
    : event.iterationIndex;
}

function markerPathForProjection(
  path: string,
  variables: SceneVariable[],
): string {
  const root = /^([A-Za-z_]\w*)/.exec(path)?.[1];
  const graphVariable = variables.find(
    (variable) =>
      variable.name === root &&
      variable.projection.kind === "graph",
  );
  if (graphVariable && root) {
    const graphIndex =
      new RegExp(`^${root}\\[(\\d+)\\]`).exec(path)?.[1] ??
      new RegExp(`^${root}\\{(\\d+)\\}\\.value`).exec(path)?.[1];
    if (graphIndex !== undefined) {
      return `${root}[${graphIndex}]`;
    }
  }
  return path.replace(/\.value$/, "");
}

function eventAccessExpressions(event: SemanticEvent): string[] {
  return [
    ...(event.accessExpressions ?? []),
    ...(event.operandExpressions ?? []),
    ...(event.argumentExpressions ?? []),
    event.expression,
  ].filter((expression, index, expressions) =>
    expression.length > 0 && expressions.indexOf(expression) === index
  );
}

function valueIdentity(value: SerializedValue | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.kind === "reference") {
    return value.targetId;
  }
  return "id" in value ? value.id : undefined;
}

function findIdentityPath(
  targetId: string,
  value: SerializedValue,
  path: string,
  visited: Set<string>,
): string | undefined {
  const identity = valueIdentity(value);
  if (identity === targetId) {
    return path;
  }
  if (identity && visited.has(identity)) {
    return undefined;
  }
  if (identity) {
    visited.add(identity);
  }
  if (value.kind === "sequence" || value.kind === "set") {
    for (const [index, item] of value.items.entries()) {
      const found = findIdentityPath(
        targetId,
        item,
        `${path}[${index}]`,
        visited,
      );
      if (found) {
        return found;
      }
    }
  } else if (value.kind === "mapping") {
    for (const [index, [key, item]] of value.entries.entries()) {
      const keyPath = findIdentityPath(
        targetId,
        key,
        `${path}{${index}}.key`,
        visited,
      );
      if (keyPath) {
        return keyPath;
      }
      const valuePath = findIdentityPath(
        targetId,
        item,
        `${path}{${index}}.value`,
        visited,
      );
      if (valuePath) {
        return valuePath;
      }
    }
  } else if (value.kind === "object") {
    for (const [name, field] of Object.entries(value.fields)) {
      const found = findIdentityPath(
        targetId,
        field,
        `${path}.${name}`,
        visited,
      );
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

function runtimeAccessPath(
  event: SemanticEvent,
  locals: Record<string, SerializedValue>,
): string | undefined {
  const containerId = valueIdentity(event.accessContainer);
  if (!containerId || !event.accessKey) {
    return undefined;
  }
  let containerPath: string | undefined;
  for (const [name, value] of Object.entries(locals)) {
    containerPath = findIdentityPath(containerId, value, name, new Set());
    if (containerPath) {
      break;
    }
  }
  if (!containerPath) {
    return undefined;
  }
  const container = valueAtAccessPath(containerPath, locals);
  if (
    container?.kind === "sequence" &&
    event.accessKey.kind === "scalar" &&
    typeof event.accessKey.value === "number" &&
    Number.isInteger(event.accessKey.value)
  ) {
    const rawIndex = event.accessKey.value;
    const index = rawIndex < 0 ? container.items.length + rawIndex : rawIndex;
    return index >= 0 && index < container.items.length
      ? `${containerPath}[${index}]`
      : undefined;
  }
  if (container?.kind === "mapping") {
    const entryIndex = container.entries.findIndex(([candidate]) =>
      serializedKeysEqual(candidate, event.accessKey!)
    );
    return entryIndex >= 0
      ? `${containerPath}{${entryIndex}}.value`
      : undefined;
  }
  return undefined;
}

function compileRuntimeAccessMarkers(
  event: SemanticEvent,
  locals: Record<string, SerializedValue>,
  variables: SceneVariable[],
): VariableMarker[] {
  const dependencies = (event.accessVariables ?? []).filter(
    (name) => locals[name]?.kind === "scalar",
  );
  const resolved = runtimeAccessPath(event, locals);
  if (!resolved || dependencies.length === 0) {
    return [];
  }
  const indexExpression =
    [...event.expression.matchAll(/\[([^\]]+)\]/g)].at(-1)?.[1].trim() ??
    dependencies.join(", ");
  const path = markerPathForProjection(resolved, variables);
  return dependencies.map((dependency) => ({
    id: `${event.source.line}:runtime-binding:${dependency}:${event.expression}`,
    label: indexExpression,
    path,
  }));
}

function compileVariableAccessMarkers(
  event: SemanticEvent,
  locals: Record<string, SerializedValue>,
  variables: SceneVariable[],
): VariableMarker[] {
  const targetNames =
    event.kind === "iteration" && event.loopKind === "for"
      ? iterationTargetNames(event.target)
      : Object.entries(locals)
          .filter(([, value]) => value.kind === "scalar")
          .map(([name]) => name);
  const markers: VariableMarker[] = [];

  for (const expression of eventAccessExpressions(event)) {
    const brackets = [...expression.matchAll(/\[([^\]]+)\]/g)];
    for (const [depth, bracket] of brackets.entries()) {
      const indexExpression = bracket[1].trim();
      const dependencies = targetNames.filter((name) =>
        new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
          .test(indexExpression)
      );
      if (dependencies.length === 0 || bracket.index === undefined) {
        continue;
      }
      const accessPrefix = expression.slice(
        0,
        bracket.index + bracket[0].length,
      );
      const resolved = resolveAccessPath(accessPrefix, locals);
      if (!resolved) {
        continue;
      }
      const path = markerPathForProjection(resolved, variables);
      for (const dependency of dependencies) {
        const label =
          indexExpression === dependency ? dependency : indexExpression;
        markers.push({
          id: `${event.source.line}:binding:${dependency}:${depth}:${expression}`,
          label,
          path,
        });
      }
    }
  }

  return markers;
}

function compileVariableMarkers(
  events: SemanticEvent[],
  locals: Record<string, SerializedValue>,
  variables: SceneVariable[],
): VariableMarker[] {
  const markers = events.flatMap((event): VariableMarker[] => {
    const accessMarkers = [
      ...compileRuntimeAccessMarkers(event, locals, variables),
      ...compileVariableAccessMarkers(event, locals, variables),
    ];
    if (
      event.kind !== "iteration" ||
      event.iteratorExpression === undefined
    ) {
      return accessMarkers;
    }
    const source = iteratorSource(event.iteratorExpression);
    if (!source) {
      return accessMarkers;
    }
    const sourcePath = resolveAccessPath(source.collectionExpression, locals);
    if (!sourcePath) {
      return accessMarkers;
    }
    const sourceValue = valueAtAccessPath(sourcePath, locals);
    const targetNames = iterationTargetNames(event.target);
    const label =
      source.resultItemIndex !== undefined
        ? targetNames[source.resultItemIndex] ?? targetNames[0]
        : targetNames[0];
    const id = `${event.source.line}:${event.iteratorExpression}:${label}`;
    const activeValue = scalarResultAt(
      event,
      source.resultItemIndex === 0 ? 1 : source.resultItemIndex,
    );
    const graphVariable = variables.find(
      (variable) =>
        variable.projection.kind === "graph" &&
        (sourcePath === variable.name ||
          sourcePath.startsWith(`${variable.name}[`) ||
          sourcePath.startsWith(`${variable.name}{`)),
    );
    if (
      graphVariable?.projection.kind === "graph" &&
      activeValue?.kind === "scalar"
    ) {
      const vertexIndex = graphVariable.projection.vertices.findIndex(
        (vertex) =>
          vertex.value.kind === "scalar" &&
          vertex.value.type === activeValue.type &&
          vertex.value.value === scalarText(activeValue),
      );
      if (vertexIndex >= 0) {
        return [...accessMarkers, {
          id,
          label,
          path: `${graphVariable.name}[${vertexIndex}]`,
        }];
      }
    }

    const index = markerIndex(event, source);
    if (index === undefined || index < 0 || !sourceValue) {
      return accessMarkers;
    }
    if (sourceValue.kind === "mapping") {
      return [
        ...accessMarkers,
        { id, label, path: `${sourcePath}{${index}}` },
      ];
    }
    if (sourceValue.kind === "sequence" || sourceValue.kind === "set") {
      return [
        ...accessMarkers,
        { id, label, path: `${sourcePath}[${index}]` },
      ];
    }
    return accessMarkers;
  });
  return [
    ...new Map(
      markers.map((marker) => [`${marker.label}:${marker.path}`, marker]),
    ).values(),
  ];
}

function compileEntityBindings(
  bindings: Record<string, SerializedValue>,
  relationGraph: RelationGraph | undefined,
): EntityBinding[] {
  if (!relationGraph) {
    return [];
  }
  const entityIds = new Set(
    relationGraph.entities.map((entity) => entity.id),
  );
  return Object.entries(bindings).flatMap(([label, value]) => {
    const entityId =
      value.kind === "object"
        ? value.id
        : value.kind === "reference"
          ? value.targetId
          : undefined;
    return entityId && entityIds.has(entityId) && label !== "self"
      ? [{ entityId, label }]
      : [];
  });
}

function displayMapKey(value: SerializedValue): string {
  if (value.kind !== "scalar") {
    return value.type;
  }
  if (typeof value.value === "string") {
    return JSON.stringify(value.value);
  }
  if (value.value === null) {
    return "null";
  }
  return String(value.value);
}

function displayAccessPath(
  path: string,
  locals: Record<string, SerializedValue>,
): string {
  const root = /^([A-Za-z_]\w*)/.exec(path);
  if (!root) {
    return path;
  }
  let display = root[1];
  let cursor = root[0].length;
  let current: SerializedValue | undefined = locals[root[1]];
  while (cursor < path.length) {
    const remaining = path.slice(cursor);
    const mapping = /^\{(\d+)\}\.(key|value)/.exec(remaining);
    if (mapping && current?.kind === "mapping") {
      const entry: [SerializedValue, SerializedValue] | undefined =
        current.entries[Number(mapping[1])];
      if (!entry) {
        return path;
      }
      display += `[${displayMapKey(entry[0])}]`;
      current = mapping[2] === "key" ? entry[0] : entry[1];
      cursor += mapping[0].length;
      continue;
    }
    const field = /^\.([A-Za-z_]\w*)/.exec(remaining);
    if (field) {
      display += field[0];
      current =
        current?.kind === "object"
          ? current.fields[field[1]]
          : undefined;
      cursor += field[0].length;
      continue;
    }
    const index = /^\[(-?\d+)\]/.exec(remaining);
    if (index) {
      display += index[0];
      current =
        current?.kind === "sequence"
          ? current.items[Number(index[1])]
          : undefined;
      cursor += index[0].length;
      continue;
    }
    return path;
  }
  return display;
}

function displayLabel(
  path: string,
  locals: Record<string, SerializedValue>,
): string | undefined {
  const display = displayAccessPath(path, locals);
  return display === path ? undefined : display;
}

function operationFocusPaths(
  events: SemanticEvent[],
  locals: Record<string, SerializedValue>,
): string[] {
  const expressions = events.flatMap((event) => {
    const candidates = [
      ...(event.operandExpressions ?? []),
      ...(event.argumentExpressions ?? []),
    ];
    if (event.kind === "read") {
      candidates.push(event.expression);
    }
    if (event.target) {
      candidates.push(...event.target.split(",").map((target) => target.trim()));
    }
    return candidates;
  });
  const memoPaths = events.flatMap((event): string[] => {
    if (
      event.kind !== "memo" ||
      !event.callee ||
      !event.arguments ||
      event.arguments.length === 0
    ) {
      return [];
    }
    const bindingName = `${event.callee}.memo`;
    const table = locals[bindingName];
    if (table?.kind !== "mapping") {
      return [];
    }
    const index = table.entries.findIndex(([key]) => {
      if (event.arguments!.length === 1) {
        return serializedKeysEqual(key, event.arguments![0]);
      }
      return (
        key.kind === "sequence" &&
        key.items.length === event.arguments!.length &&
        key.items.every((item, itemIndex) =>
          serializedKeysEqual(item, event.arguments![itemIndex])
        )
      );
    });
    return index < 0
      ? []
      : [
          `${bindingName}{${index}}.key`,
          `${bindingName}{${index}}.value`,
        ];
  });
  return [
    ...new Set(
      [
        ...expressions
          .map((expression) => resolveAccessPath(expression, locals))
          .filter((path): path is string => path !== undefined),
        ...memoPaths,
      ],
    ),
  ];
}

function sameOperationResult(
  left: SerializedValue | undefined,
  right: SerializedValue | undefined,
): boolean {
  if (left?.kind === "scalar" && right?.kind === "scalar") {
    return Object.is(left.value, right.value);
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function compileOperationMotion(
  events: SemanticEvent[],
  locals: Record<string, SerializedValue>,
  returnTarget: boolean,
): OperationMotionPlan | undefined {
  let operationIndex = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].kind === "operation") {
      operationIndex = index;
      break;
    }
  }
  if (operationIndex < 0) {
    return undefined;
  }
  const operation = events[operationIndex];
  const operandTexts = operation.operands?.map(scalarText) ?? [];
  const resultText = operation.result ? scalarText(operation.result) : "";
  if (
    !operation.operatorToken ||
    operandTexts.length === 0 ||
    operandTexts.some((text) => text.length === 0) ||
    resultText.length === 0
  ) {
    return undefined;
  }

  const sourcePaths = (operation.operandExpressions ?? []).map(
    (expression) => resolveAccessPath(expression, locals) ?? null,
  );
  while (sourcePaths.length < operandTexts.length) {
    sourcePaths.push(null);
  }

  const write = events.slice(operationIndex + 1).find(
    (event) =>
      event.kind === "write" &&
      event.source.line === operation.source.line &&
      sameOperationResult(event.result, operation.result),
  );
  const targetPath = write?.target
    ?.split(/[=,]/)
    .map((target) => resolveAccessPath(target.trim(), locals))
    .find((target): target is string => target !== undefined);

  return {
    id: [
      operation.source.line,
      operation.expression,
      operation.operatorToken,
      resultText,
    ].join(":"),
    expression: operation.expression,
    operandTexts,
    sourcePaths,
    operatorToken: operation.operatorToken,
    resultText,
    targetPath: targetPath ?? (returnTarget ? "$return" : undefined),
  };
}

function operationCausalLinks(
  events: SemanticEvent[],
  locals: Record<string, SerializedValue>,
  changes: ValueChange[],
): CausalLink[] {
  const links: CausalLink[] = [];
  let producers: Array<{
    source: string;
    sourceKind: CausalLink["sourceKind"];
    sourceLabel?: string;
  }> = [];
  const mostSpecificProducers = () =>
    producers.filter(
      (producer) =>
        producer.sourceKind === "call" ||
        !producers.some(
          (candidate) =>
            candidate.sourceKind === "value" &&
            candidate.source.length > producer.source.length &&
            candidate.source.startsWith(producer.source) &&
            [".", "[", "{"].includes(
              candidate.source[producer.source.length],
            ),
        ),
    );

  for (const event of events) {
    if (event.kind === "read") {
      const source = resolveAccessPath(event.expression, locals);
      if (source) {
        producers.push({
          source,
          sourceKind: "value",
          sourceLabel: displayLabel(source, locals),
        });
      }
      continue;
    }
    if (event.kind === "call" || event.kind === "memo") {
      for (const argumentExpression of event.argumentExpressions ?? []) {
        const source = resolveAccessPath(
          argumentExpression
            .replace(/^\*{1,2}/, "")
            .replace(/^[A-Za-z_]\w*=/, ""),
          locals,
        );
        if (source) {
          producers.push({
            source,
            sourceKind: "value",
            sourceLabel: displayLabel(source, locals),
          });
        }
      }
      producers.push({ source: event.expression, sourceKind: "call" });
      continue;
    }
    if (event.kind === "operation" || event.kind === "compare") {
      // Computed values are not structural transfers from their input paths.
      producers = [];
      continue;
    }
    if (event.kind !== "write" && event.kind !== "swap") {
      continue;
    }

    const targets = (event.target ?? "")
      .split(",")
      .map((target) => resolveAccessPath(target.trim(), locals))
      .filter((target): target is string => target !== undefined);
    const activeProducers = mostSpecificProducers();
    if (event.kind === "swap" && activeProducers.length === targets.length) {
      activeProducers.forEach((producer, index) => {
        links.push({
          ...producer,
          target: targets[index],
          targetLabel: displayLabel(targets[index], locals),
        });
      });
    } else {
      for (const producer of activeProducers) {
        for (const target of targets) {
          links.push({
            ...producer,
            target,
            targetLabel: displayLabel(target, locals),
          });
        }
      }
    }
    producers = [];
  }

  if (producers.length > 0) {
    const mutationTargets = changes
      .filter((change) => change.kind !== "removed")
      .map((change) => change.path);
    for (const producer of mostSpecificProducers()) {
      for (const target of mutationTargets) {
        links.push({
          ...producer,
          target,
          targetLabel: displayLabel(target, locals),
        });
      }
    }
  }

  return [
    ...new Map(
      links.map((link) => [
        `${link.sourceKind}:${link.source}:${link.target}`,
        link,
      ]),
    ).values(),
  ];
}

function relationFocus(
  variables: SceneVariable[],
  focusPaths: string[],
): { entityIds: string[]; relationKeys: string[] } {
  const entityIds = new Set<string>();
  const relationKeys = new Set<string>();
  const variablesByName = new Map(
    variables.map((variable) => [variable.name, variable.projection]),
  );

  for (const path of focusPaths) {
    const root = /^([A-Za-z_]\w*)/.exec(path);
    if (!root) {
      continue;
    }
    const rootProjection = variablesByName.get(root[1]);
    if (!rootProjection) {
      continue;
    }
    let projection: SceneProjection = rootProjection;
    if (projection.kind === "object") {
      entityIds.add(projection.key);
    } else if (projection.kind === "reference") {
      entityIds.add(projection.targetId);
    }

    const segments = path.slice(root[0].length).matchAll(/\.([A-Za-z_]\w*)|\[(-?\d+)\]/g);
    for (const segment of segments) {
      if (segment[1] && projection.kind === "object") {
        const sourceId = projection.key;
        const field = projection.fields.find(
          (candidate) => candidate.name === segment[1],
        );
        if (!field) {
          break;
        }
        const targetId =
          field.value.kind === "object"
            ? field.value.key
            : field.value.kind === "reference"
              ? field.value.targetId
              : undefined;
        if (targetId) {
          entityIds.add(targetId);
          relationKeys.add(`${sourceId}:${field.name}:${targetId}`);
        }
        projection = field.value;
        continue;
      }
      if (segment[2] && projection.kind === "sequence") {
        const item = projection.items[Number(segment[2])];
        if (!item) {
          break;
        }
        projection = item;
        if (projection.kind === "object") {
          entityIds.add(projection.key);
        } else if (projection.kind === "reference") {
          entityIds.add(projection.targetId);
        }
        continue;
      }
      break;
    }
  }

  return {
    entityIds: [...entityIds],
    relationKeys: [...relationKeys],
  };
}

function entityLabel(projection: ObjectProjection): string {
  const preferredNames = ["value", "val", "key", "label", "name"];
  for (const name of preferredNames) {
    const field = projection.fields.find((candidate) => candidate.name === name);
    if (field?.value.kind === "scalar") {
      return field.value.value.replace(/^"|"$/g, "");
    }
  }
  return projection.type.split(".").at(-1) ?? projection.type;
}

function activeScalarIdentities(
  events: SemanticEvent[],
  changes: ValueChange[],
): Set<string> {
  const identities = new Set<string>();
  const add = (value: SerializedValue | undefined) => {
    if (value?.kind === "scalar") {
      identities.add(`${value.type}:${scalarText(value)}`);
    }
  };
  events.forEach((event) => {
    event.operands?.forEach(add);
    event.arguments?.forEach(add);
    add(event.result);
  });
  changes.forEach((change) => add(change.after));
  return identities;
}

function graphOperationFocus(
  variables: SceneVariable[],
  events: SemanticEvent[],
  changes: ValueChange[],
): string[] {
  const identities = activeScalarIdentities(events, changes);
  variables.forEach((variable) => {
    if (variable.changed && variable.projection.kind === "scalar") {
      identities.add(
        `${variable.projection.type}:${variable.projection.value}`,
      );
    }
  });
  const focused = new Set<string>();

  const visit = (projection: SceneProjection): void => {
    if (projection.kind === "graph") {
      projection.vertices.forEach((vertex) => {
        if (
          vertex.value.kind === "scalar" &&
          identities.has(`${vertex.value.type}:${vertex.value.value}`)
        ) {
          focused.add(vertex.id);
        }
        visit(vertex.adjacency);
      });
      return;
    }
    if (projection.kind === "sequence") {
      projection.items.forEach(visit);
      return;
    }
    if (projection.kind === "grid") {
      projection.rows.flat().forEach(visit);
      return;
    }
    if (projection.kind === "mapping") {
      projection.entries.forEach((entry) => {
        visit(entry.key);
        visit(entry.value);
      });
      return;
    }
    if (projection.kind === "object") {
      projection.fields.forEach((field) => visit(field.value));
    }
  };

  variables.forEach((variable) => visit(variable.projection));
  return [...focused];
}

function graphMemberships(variables: SceneVariable[]): GraphMembership[] {
  const graphs: GraphProjection[] = [];
  const collectGraphs = (projection: SceneProjection): void => {
    if (projection.kind === "graph") {
      graphs.push(projection);
      projection.vertices.forEach((vertex) => collectGraphs(vertex.adjacency));
      return;
    }
    if (projection.kind === "sequence") {
      projection.items.forEach(collectGraphs);
      return;
    }
    if (projection.kind === "grid") {
      projection.rows.flat().forEach(collectGraphs);
      return;
    }
    if (projection.kind === "mapping") {
      projection.entries.forEach((entry) => {
        collectGraphs(entry.key);
        collectGraphs(entry.value);
      });
      return;
    }
    if (projection.kind === "object") {
      projection.fields.forEach((field) => collectGraphs(field.value));
    }
  };
  variables.forEach((variable) => collectGraphs(variable.projection));

  return graphs.flatMap((graph) => {
    const vertexIdsByIdentity = new Map(
      graph.vertices.flatMap((vertex) =>
        vertex.value.kind === "scalar"
          ? [[`${vertex.value.type}:${vertex.value.value}`, vertex.id] as const]
          : [],
      ),
    );
    return variables.flatMap((variable) => {
      if (
        variable.projection.kind !== "sequence" ||
        variable.projection.items.length === 0 ||
        variable.projection.items.some((item) => item.kind !== "scalar")
      ) {
        return [];
      }
      const vertexIds = variable.projection.items.map((item) =>
        item.kind === "scalar"
          ? vertexIdsByIdentity.get(`${item.type}:${item.value}`)
          : undefined,
      );
      if (vertexIds.some((id) => id === undefined)) {
        return [];
      }
      return [{
        graphKey: graph.key,
        variableName: variable.name,
        vertexIds: [...new Set(vertexIds as string[])],
      }];
    });
  });
}

function buildRelationGraph(variables: SceneVariable[]): RelationGraph | undefined {
  const entities = new Map<string, RelationEntity>();
  const edges = new Map<string, RelationEdge>();
  const objectRoots = new Set<string>();
  const referenceRoots = new Set<string>();

  const addEdge = (sourceId: string, targetId: string, label: string) => {
    const key = `${sourceId}:${label}:${targetId}`;
    edges.set(key, { sourceId, targetId, label });
  };

  const visitContained = (
    projection: SceneProjection,
    ownerId: string,
    path: string,
  ): void => {
    if (projection.kind === "object") {
      addEdge(ownerId, projection.key, path);
      visitObject(projection);
      return;
    }
    if (projection.kind === "reference") {
      addEdge(ownerId, projection.targetId, path);
      return;
    }
    if (projection.kind === "sequence") {
      projection.items.forEach((item, index) =>
        visitContained(item, ownerId, `${path}[${index}]`),
      );
      return;
    }
    if (projection.kind === "grid") {
      projection.rows.forEach((row, rowIndex) =>
        row.forEach((item, columnIndex) =>
          visitContained(item, ownerId, `${path}[${rowIndex}][${columnIndex}]`),
        ),
      );
      return;
    }
    if (projection.kind === "mapping") {
      projection.entries.forEach((entry, index) => {
        visitContained(entry.key, ownerId, `${path}{${index}}.key`);
        visitContained(entry.value, ownerId, `${path}{${index}}.value`);
      });
    }
  };

  const visitObject = (projection: ObjectProjection): void => {
    if (entities.has(projection.key)) {
      return;
    }
    entities.set(projection.key, {
      id: projection.key,
      type: projection.type,
      label: entityLabel(projection),
      projection,
    });
    projection.fields.forEach((field) => {
      visitContained(field.value, projection.key, field.name);
    });
  };

  const visitRoot = (projection: SceneProjection): void => {
    if (projection.kind === "object") {
      objectRoots.add(projection.key);
      visitObject(projection);
      return;
    }
    if (projection.kind === "reference") {
      referenceRoots.add(projection.targetId);
      return;
    }
    if (projection.kind === "sequence") {
      projection.items.forEach(visitRoot);
      return;
    }
    if (projection.kind === "grid") {
      projection.rows.flat().forEach(visitRoot);
      return;
    }
    if (projection.kind === "mapping") {
      projection.entries.forEach(({ key, value }) => {
        visitRoot(key);
        visitRoot(value);
      });
    }
  };

  variables.forEach((variable) => {
    visitRoot(variable.projection);
  });

  const validEdges = [...edges.values()].filter(
    (edge) => entities.has(edge.sourceId) && entities.has(edge.targetId),
  );
  if (validEdges.length === 0) {
    if (entities.size !== 1) {
      return undefined;
    }
    const entity = entities.values().next().value as RelationEntity;
    if (entity.projection.fields.length === 0) {
      return undefined;
    }
    return {
      layout: "tree",
      roots: [entity.id],
      entities: [entity],
      edges: [],
    };
  }
  const connectedIds = new Set(
    validEdges.flatMap((edge) => [edge.sourceId, edge.targetId]),
  );

  const connectedEntities = [...entities.values()].filter((entity) =>
    connectedIds.has(entity.id),
  );
  const incoming = new Set(validEdges.map((edge) => edge.targetId));
  const preferredRoots = objectRoots.size > 0 ? objectRoots : referenceRoots;
  const resolvedRoots = [...preferredRoots].filter(
    (id) => connectedIds.has(id) && !incoming.has(id),
  );
  if (resolvedRoots.length === 0) {
    for (const id of connectedIds) {
      if (!incoming.has(id)) {
        resolvedRoots.push(id);
      }
    }
  }
  if (resolvedRoots.length === 0) {
    resolvedRoots.push(connectedIds.values().next().value as string);
  }
  const indegrees = new Map(connectedEntities.map((entity) => [entity.id, 0]));
  validEdges.forEach((edge) => {
    indegrees.set(edge.targetId, (indegrees.get(edge.targetId) ?? 0) + 1);
  });
  const isTree =
    resolvedRoots.length === 1 &&
    validEdges.length === connectedEntities.length - 1 &&
    connectedEntities.every((entity) =>
      entity.id === resolvedRoots[0]
        ? (indegrees.get(entity.id) ?? 0) === 0
        : (indegrees.get(entity.id) ?? 0) === 1,
    );
  const outgoing = new Map<string, RelationEdge[]>();
  validEdges.forEach((edge) => {
    outgoing.set(edge.sourceId, [
      ...(outgoing.get(edge.sourceId) ?? []),
      edge,
    ]);
  });
  const cycleStart = connectedEntities[0]?.id;
  const cycleVisited = new Set<string>();
  let cycleCursor = cycleStart;
  while (
    cycleCursor &&
    !cycleVisited.has(cycleCursor) &&
    (outgoing.get(cycleCursor)?.length ?? 0) === 1
  ) {
    cycleVisited.add(cycleCursor);
    cycleCursor = outgoing.get(cycleCursor)![0].targetId;
  }
  const isCycle =
    connectedEntities.length > 1 &&
    validEdges.length === connectedEntities.length &&
    connectedEntities.every(
      (entity) =>
        (indegrees.get(entity.id) ?? 0) === 1 &&
        (outgoing.get(entity.id)?.length ?? 0) === 1,
    ) &&
    cycleVisited.size === connectedEntities.length &&
    cycleCursor === cycleStart;

  return {
    layout: isTree ? "tree" : isCycle ? "cycle" : "network",
    roots: resolvedRoots,
    entities: connectedEntities,
    edges: validEdges,
  };
}

export function compileScene(
  frame: TraceFrame,
  registry = new ProjectionRegistry(),
  executionState: ExecutionState = materializeExecutionState(frame),
): VisualScene {
  frame.ancestorScopes?.forEach((scope) => {
    registry.observeBindings(scope.locals);
  });
  registry.observeBindings(frame.locals);
  registry.observeRuntimeEvidence(
    [...(frame.activeVisualEvents ?? []), ...frame.semanticEvents],
    frame.locals,
  );
  const variables: SceneVariable[] = Object.entries(frame.locals).map(([name, value]) => {
    const changes = variableChanged(name, frame.changes);
    return {
      name,
      projection: registry.project(value, {
        key: name,
        label: name,
        depth: 0,
      }),
      changed: changes.length > 0,
      changeCount: changes.length,
    };
  });
  variables.forEach((variable) => {
    const value = frame.locals[variable.name];
    if (value && registry.hasGraphEvidence(value)) {
      variable.graphFacet = inferGraphFacet(variable.projection);
    }
  });
  if (
    frame.event === "return" &&
    frame.functionName !== "<module>" &&
    frame.returnValue
  ) {
    variables.push({
      name: "$return",
      projection: registry.project(frame.returnValue, {
        key: "$return",
        label: "$return",
        depth: 0,
      }),
      changed: true,
      changeCount: 1,
    });
  }
  const contextVariables: SceneVariable[] =
    frame.ancestorScopes?.flatMap((scope) =>
      Object.entries(scope.locals).map(([name, value]) => ({
        name: `${scope.scopeId}:${name}`,
        projection: registry.project(value, {
          key: `${scope.scopeId}:${name}`,
          label: name,
          depth: 0,
        }),
        changed: false,
        changeCount: 0,
      })),
    ) ?? [];
  const legacyFocusPaths = operationFocusPaths(
    frame.semanticEvents,
    frame.locals,
  );
  const lenses = compileExecutionLenses({ frame, state: executionState });
  const locationPaths = indexRuntimeLocationPaths(frame.locals, frame.scopeId);
  const attentionPaths = lenses.attention.flatMap((request) => {
    if (request.subject.kind !== "location") {
      return [];
    }
    const path = locationPaths.get(
      runtimeLocationId(request.subject.location),
    );
    return path === undefined ? [] : [path];
  });
  const focusPaths = [...new Set([...legacyFocusPaths, ...attentionPaths])];
  const variableMarkers = compileVariableMarkers(
    [
      ...(frame.activeVisualEvents ?? []),
      ...frame.semanticEvents,
    ],
    frame.locals,
    variables,
  );
  const causalLinks = operationCausalLinks(
    frame.semanticEvents,
    frame.locals,
    frame.changes,
  ).map((link) => {
    const targetLocation = resolveExpressionLocation(
      link.target,
      frame.scopeId,
      frame.locals,
    );
    const sourceLocation =
      link.sourceKind === "value"
        ? resolveExpressionLocation(
            link.source,
            frame.scopeId,
            frame.locals,
          )
        : undefined;
    return {
      ...link,
      targetLocationId: runtimeLocationId(targetLocation),
      ...(sourceLocation === undefined
        ? {}
        : { sourceLocationId: runtimeLocationId(sourceLocation) }),
    };
  });
  const relationGraph = buildRelationGraph([
    ...contextVariables,
    ...variables,
  ]);
  const entityBindings = compileEntityBindings(
    {
      ...frame.locals,
      ...(frame.event === "return" &&
      frame.functionName !== "<module>" &&
      frame.returnValue !== undefined
        ? { $return: frame.returnValue }
        : {}),
    },
    relationGraph,
  );
  const focusedRelations = relationFocus(variables, focusPaths);
  const focusedGraphVertexIds = graphOperationFocus(
    variables,
    frame.semanticEvents,
    frame.changes,
  );
  const memberships = graphMemberships(variables);
  const motionPlan = compileMotionPlan(causalLinks, frame.semanticEvents);
  const operationMotion = compileOperationMotion(
    frame.semanticEvents,
    frame.locals,
    frame.event === "return" &&
      frame.functionName !== "<module>" &&
      frame.returnValue !== undefined,
  );
  const callFlow = lenses.callFlow;
  const recursion: RecursionProjection | undefined = callFlow?.recursive
    ? {
        frames: callFlow.frames.map((activation) => ({
          scopeId: activation.activationId,
          functionName: activation.functionName,
          line: activation.line,
          bindings: activation.bindings.map(({ name, value }) => ({
            name,
            value,
          })),
          ...(activation.returnValue === undefined
            ? {}
            : { returnValue: activation.returnValue }),
        })),
      }
    : undefined;

  return {
    schemaVersion: SCENE_IR_VERSION,
    frameIndex: frame.index,
    line: frame.source.line,
    event: frame.event,
    functionName: frame.functionName,
    callStack: frame.callStack,
    entityBindings,
    variables,
    changes: frame.changes,
    operations: frame.semanticEvents,
    focusPaths,
    variableMarkers,
    focusedGraphVertexIds,
    graphMemberships: memberships,
    motionPlan,
    operationMotion,
    focusedEntityIds: focusedRelations.entityIds,
    focusedRelationKeys: focusedRelations.relationKeys,
    causalLinks,
    stdout: frame.stdout,
    exception: frame.exception,
    relationGraph,
    callFlow,
    controlFlow: lenses.controlFlow,
    dataFlow: lenses.dataFlow,
    attention: lenses.attention,
    recursion,
  };
}
