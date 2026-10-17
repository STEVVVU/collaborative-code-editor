export type Scalar = string | number | boolean | null;
export type JsonValue =
  | Scalar
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ObjectInputDescriptor {
  $kind: "object";
  type: string;
  id?: string;
  fields: Record<string, JsonValue>;
}

export interface ReferenceInputDescriptor {
  $kind: "reference";
  id: string;
}

export interface ConstructInputDescriptor {
  $kind: "construct";
  callable: string;
  arguments?: JsonValue[];
  keywordArguments?: Record<string, JsonValue>;
  fields?: Record<string, JsonValue>;
}

export interface ProjectionBindingRoot {
  kind: "binding";
  name: string;
}

export interface ProjectionFieldSegment {
  kind: "field";
  name: string;
}

export interface ProjectionIndexSegment {
  kind: "index";
  index: number;
}

export interface ProjectionMapKeySegment {
  kind: "mapKey";
  key: ScalarValue;
}

/** Selects each immediate value contained by a sequence, set, mapping, or object. */
export interface ProjectionEachSegment {
  kind: "each";
}

export type ProjectionTargetSegment =
  | ProjectionFieldSegment
  | ProjectionIndexSegment
  | ProjectionMapKeySegment
  | ProjectionEachSegment;

export interface ProjectionTarget {
  root: ProjectionBindingRoot;
  segments: ProjectionTargetSegment[];
}

export interface GraphProjectionConfiguration {
  kind: "graph";
  representation: "adjacency-list";
  directed: boolean;
}

export interface ProjectionContract {
  id: string;
  target: ProjectionTarget;
  configuration: GraphProjectionConfiguration;
}

export interface ProjectionContractsV1 {
  version: 1;
  declarations: ProjectionContract[];
}

export interface ScriptRunSpec {
  mode: "script";
  projectionContracts?: ProjectionContractsV1;
}

export interface FunctionRunSpec {
  mode: "function";
  entrypoint: string;
  arguments: JsonValue[];
  projectionContracts?: ProjectionContractsV1;
}

export type RunSpec = ScriptRunSpec | FunctionRunSpec;

export interface ScalarValue {
  kind: "scalar";
  type: string;
  value: Scalar;
}

export interface SequenceValue {
  kind: "sequence";
  id: string;
  type: string;
  items: SerializedValue[];
}

export interface MappingValue {
  kind: "mapping";
  id: string;
  type: string;
  entries: Array<[SerializedValue, SerializedValue]>;
  entryIds?: string[];
}

export interface SetValue {
  kind: "set";
  id: string;
  type: string;
  items: SerializedValue[];
  itemIds?: string[];
}

export interface ObjectValue {
  kind: "object";
  id: string;
  type: string;
  fields: Record<string, SerializedValue>;
}

export interface ReferenceValue {
  kind: "reference";
  targetId: string;
  type: string;
}

export interface TruncatedValue {
  kind: "truncated";
  type: string;
  reason: "depth" | "size" | "unsupported";
  preview: string;
}

export type SerializedValue =
  | ScalarValue
  | SequenceValue
  | MappingValue
  | SetValue
  | ObjectValue
  | ReferenceValue
  | TruncatedValue;

export type TraceEventKind =
  | "call"
  | "resume"
  | "line"
  | "yield"
  | "return"
  | "exception";

export interface SourceSpan {
  line: number;
  endLine?: number;
}

export interface CausalOrder {
  actorId?: string;
  actorSequence?: number;
  happensAfter?: string[];
}

export interface CallStackEntry {
  functionName: string;
  scopeId: string;
  line: number;
  parameters?: string[];
}

export interface ScopeSnapshot extends CallStackEntry {
  locals: Record<string, SerializedValue>;
}

export interface ValueChange {
  path: string;
  kind: "created" | "updated" | "removed";
  before?: SerializedValue;
  after?: SerializedValue;
  location?: RuntimeLocation;
}

export type SemanticEventKind =
  | "read"
  | "call"
  | "memo"
  | "operation"
  | "write"
  | "swap"
  | "compare"
  | "branch"
  | "iteration"
  | "mutation"
  | "yield"
  | "resume"
  | "exception";

export type ObservationProvenance =
  | "observed"
  | "derived"
  | "declared"
  | "unknown"
  | "truncated";

export interface BindingLocation {
  kind: "binding";
  activationId: string;
  name: string;
}

export interface FieldLocation {
  kind: "field";
  objectId: string;
  name: string;
}

export interface IndexLocation {
  kind: "index";
  containerId: string;
  index: number;
}

export interface MappingEntryLocation {
  kind: "mapping-entry";
  mappingId: string;
  entryId: string;
  part: "key" | "value";
}

export interface SetMemberLocation {
  kind: "set-member";
  setId: string;
  memberId: string;
}

export interface ExpressionLocation {
  kind: "expression";
  activationId: string;
  expression: string;
}

export interface IdentityLocation {
  kind: "identity";
  objectId: string;
}

export type RuntimeLocation =
  | BindingLocation
  | FieldLocation
  | IndexLocation
  | MappingEntryLocation
  | SetMemberLocation
  | IdentityLocation
  | ExpressionLocation;

export type OperationCategory =
  | "arithmetic"
  | "bitwise"
  | "logical";

export interface SemanticEvent extends CausalOrder {
  kind: SemanticEventKind;
  id?: string;
  activationId?: string;
  provenance?: ObservationProvenance;
  source: SourceSpan;
  expression: string;
  phase?: "begin" | "end" | "throw" | "propagate" | "catch";
  target?: string;
  location?: RuntimeLocation;
  sourceLocations?: RuntimeLocation[];
  producerEventIds?: string[];
  operator?: string;
  operatorToken?: string;
  operationCategory?: OperationCategory;
  callee?: string;
  cacheHit?: boolean;
  operandExpressions?: string[];
  operands?: SerializedValue[];
  argumentExpressions?: string[];
  arguments?: SerializedValue[];
  iteratorExpression?: string;
  iterationIndex?: number;
  loopKind?: "for" | "while";
  accessExpressions?: string[];
  accessVariables?: string[];
  accessContainer?: SerializedValue;
  accessKey?: SerializedValue;
  before?: SerializedValue;
  result?: SerializedValue;
  exception?: string;
  exceptionId?: string;
}

export interface TraceFrame extends CausalOrder {
  index: number;
  eventIndex?: number;
  event: TraceEventKind;
  source: SourceSpan;
  functionName: string;
  scopeId: string;
  depth: number;
  callStack: CallStackEntry[];
  ancestorScopes?: ScopeSnapshot[];
  locals: Record<string, SerializedValue>;
  persistentBindings?: string[];
  stdout: string;
  changes: ValueChange[];
  semanticEvents: SemanticEvent[];
  activeVisualEvents?: SemanticEvent[];
  returnValue?: SerializedValue;
  yieldValue?: SerializedValue;
  exception?: string;
  exceptionId?: string;
}

export interface TraceStep extends CausalOrder {
  index: number;
  event: TraceEventKind;
  source: SourceSpan;
  functionName: string;
  scopeId: string;
  depth: number;
  callStack: CallStackEntry[];
  semanticEvents: SemanticEvent[];
  activeVisualEvents?: SemanticEvent[];
  frameIndex: number;
}

export type RawTraceStep = Omit<
  TraceStep,
  "index" | "frameIndex" | "activeVisualEvents"
>;

export type RawTraceFrame = Omit<
  TraceFrame,
  "index" | "changes" | "semanticEvents" | "callStack"
> & {
  callStack?: CallStackEntry[];
  semanticEvents?: SemanticEvent[];
};

export interface ExecutionTrace {
  irVersion?: 2;
  source: string;
  runSpec: RunSpec;
  frames: TraceFrame[];
  steps?: TraceStep[];
  stdout: string;
  durationMs: number;
  eventsObserved?: number;
  samplingStride?: number;
  error?: string;
}
