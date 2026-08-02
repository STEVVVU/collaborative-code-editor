import {
  compileCallFlow,
  type CallFlowProjection,
} from "./callLens";
import type {
  ActivationState,
  ExecutionState,
  LifecycleFact,
  MutationFact,
  SemanticExecutionFact,
} from "./executionModel";
import { runtimeLocationId } from "./locations";
import type {
  RuntimeLocation,
  SemanticEvent,
  TraceFrame,
  TraceEventKind,
} from "./types";

export type AttentionRole = "mustShow" | "context" | "optional" | "pinned";
export type AttentionLifetime =
  | "event"
  | "scope"
  | "until-consumed"
  | "user"
  | "exit-animation";

export interface AttentionRequest {
  id: string;
  subject:
    | { kind: "location"; location: RuntimeLocation }
    | { kind: "activation"; activationId: string }
    | { kind: "event"; eventId: string };
  reason: string;
  role: AttentionRole;
  lifetime: AttentionLifetime;
  priority: number;
  lensId: string;
}

export interface DataFlowNode {
  id: string;
  activationId: string;
  kind: SemanticEvent["kind"] | TraceEventKind | "mutation";
  label: string;
}

export interface DataFlowEdge {
  id: string;
  sourceEventId: string;
  targetEventId: string;
}

export interface DataFlowProjection {
  nodes: DataFlowNode[];
  edges: DataFlowEdge[];
}

export interface SuspendedCallProjection {
  activationId: string;
  functionName: string;
  line: number;
  yieldValue?: string;
}

export interface ControlFlowProjection {
  activeIterations: SemanticEvent[];
  latestBranch?: SemanticEvent;
  lifecycle?: LifecycleFact["event"];
  suspendedCalls: SuspendedCallProjection[];
  exception?: string;
}

export interface LensContext {
  frame: TraceFrame;
  state: ExecutionState;
}

export interface ExecutionLensBundle {
  callFlow?: CallFlowProjection;
  controlFlow: ControlFlowProjection;
  dataFlow: DataFlowProjection;
  attention: AttentionRequest[];
}

export interface ExecutionLens<Fragment> {
  id: string;
  compile(context: LensContext): Fragment;
}

function scalarSummary(activation: ActivationState): string | undefined {
  const value = activation.yieldValue;
  if (value?.kind !== "scalar") {
    return value?.type;
  }
  if (value.value === null) {
    return "null";
  }
  return typeof value.value === "string"
    ? JSON.stringify(value.value)
    : String(value.value);
}

const callLens: ExecutionLens<CallFlowProjection | undefined> = {
  id: "call",
  compile: ({ state }) => compileCallFlow(state),
};

const controlLens: ExecutionLens<ControlFlowProjection> = {
  id: "control",
  compile: ({ frame, state }) => {
    const events = [
      ...(frame.activeVisualEvents ?? []),
      ...frame.semanticEvents,
    ];
    const lifecycle = state.facts
      .filter((fact): fact is LifecycleFact => fact.kind === "lifecycle")
      .at(-1);
    return {
      activeIterations: events.filter(
        (event) => event.kind === "iteration",
      ),
      latestBranch: [...events]
        .reverse()
        .find((event) => event.kind === "branch"),
      lifecycle: lifecycle?.event,
      suspendedCalls: state.suspendedActivations.map((activation) => ({
        activationId: activation.activationId,
        functionName: activation.functionName,
        line: activation.line,
        ...(activation.yieldValue === undefined
          ? {}
          : { yieldValue: scalarSummary(activation) }),
      })),
      exception: frame.exception,
    };
  },
};

const dataFlowLens: ExecutionLens<DataFlowProjection> = {
  id: "dataflow",
  compile: ({ state }) => {
    const semanticFacts = state.facts.filter(
      (fact): fact is SemanticExecutionFact => fact.kind === "semantic",
    );
    const mutations = state.facts.filter(
      (fact): fact is MutationFact => fact.kind === "mutation",
    );
    const lifecycle = state.facts.filter(
      (fact): fact is LifecycleFact => fact.kind === "lifecycle",
    );
    const nodes: DataFlowNode[] = [
      ...semanticFacts.map(({ event, activationId }) => ({
        id: event.id!,
        activationId,
        kind: event.kind,
        label: event.expression,
      })),
      ...mutations.map((fact) => ({
        id: fact.id,
        activationId: fact.activationId,
        kind: "mutation" as const,
        label: fact.change.path,
      })),
      ...lifecycle.map((fact) => ({
        id: fact.id,
        activationId: fact.activationId,
        kind: fact.event,
        label: fact.event,
      })),
    ];
    const edges = semanticFacts.flatMap(({ event }) =>
      (event.producerEventIds ?? []).map((producerEventId) => ({
        id: `${producerEventId}->${event.id}`,
        sourceEventId: producerEventId,
        targetEventId: event.id!,
      }))
    );
    return {
      nodes: [...new Map(nodes.map((node) => [node.id, node])).values()],
      edges: [...new Map(edges.map((edge) => [edge.id, edge])).values()],
    };
  },
};

const attentionLens: ExecutionLens<AttentionRequest[]> = {
  id: "attention",
  compile: ({ frame, state }) => {
    const requests: AttentionRequest[] = [];
    state.activations.forEach((activation) => {
      requests.push({
        id: `attention:activation:${activation.activationId}`,
        subject: {
          kind: "activation",
          activationId: activation.activationId,
        },
        reason:
          activation.activationId === frame.scopeId
            ? "active-call"
            : "caller-context",
        role:
          activation.activationId === frame.scopeId ? "mustShow" : "context",
        lifetime: "scope",
        priority: activation.activationId === frame.scopeId ? 100 : 60,
        lensId: "call",
      });
    });
    for (const fact of state.facts) {
      if (fact.kind === "semantic") {
        const event = fact.event;
        const eventId = event.id!;
        requests.push({
          id: `attention:event:${eventId}`,
          subject: { kind: "event", eventId },
          reason: event.kind,
          role: "mustShow",
          lifetime: fact.active ? "scope" : "event",
          priority: 100,
          lensId: "dataflow",
        });
        const locations = [
          ...(event.sourceLocations ?? []),
          ...(event.location ? [event.location] : []),
        ];
        locations.forEach((location, index) => {
          requests.push({
            id: `attention:location:${eventId}:${index}:${runtimeLocationId(location)}`,
            subject: { kind: "location", location },
            reason: event.kind,
            role: event.location === location ? "mustShow" : "context",
            lifetime:
              fact.active || event.kind === "iteration"
                ? "scope"
                : "event",
            priority: event.location === location ? 95 : 75,
            lensId: "structural",
          });
        });
      }
      if (fact.kind === "mutation") {
        requests.push({
          id: `attention:mutation:${fact.id}`,
          subject: { kind: "location", location: fact.location },
          reason: "mutation",
          role: "mustShow",
          lifetime: "event",
          priority: 95,
          lensId: "structural",
        });
      }
    }
    return [
      ...new Map(requests.map((request) => [request.id, request])).values(),
    ].sort((left, right) => right.priority - left.priority);
  },
};

export function compileExecutionLenses(
  context: LensContext,
): ExecutionLensBundle {
  return {
    callFlow: callLens.compile(context),
    controlFlow: controlLens.compile(context),
    dataFlow: dataFlowLens.compile(context),
    attention: attentionLens.compile(context),
  };
}
