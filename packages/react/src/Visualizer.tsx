import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Layers,
  List,
  Maximize2,
  Network,
  TerminalSquare,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type {
  SceneProjection,
  SemanticEvent,
  SerializedValue,
  VisualScene,
} from "@traceframe/core";
import { ProjectionKindLabel, ProjectionView } from "./ProjectionView";
import { RelationGraphView } from "./RelationGraphView";
import { CallFlowView, RecursionView } from "./RecursionView";
import { ControlFlowView } from "./ControlFlowView";
import { useSceneMotion } from "./SceneMotionController";
import { useOperationMotion } from "./OperationMotionController";
import {
  TraceframeProvider,
  type TraceframeRendererConfig,
  useTraceframeRendererConfig,
} from "./TraceframeProvider";

export interface VisualizerProps {
  scene?: VisualScene;
  loading: boolean;
  statusText: string;
  rendererConfig?: Partial<TraceframeRendererConfig>;
  onProjectionViewChange?: (
    variableName: string,
    mode: "structural" | "graph",
    directed?: boolean,
  ) => void;
}

function isPrimaryProjection(projection: SceneProjection): boolean {
  return !["scalar", "reference", "truncated"].includes(projection.kind);
}

function findProjectionByKey(
  projection: SceneProjection,
  key: string,
): SceneProjection | undefined {
  if (projection.key === key) {
    return projection;
  }
  if (projection.kind === "sequence") {
    return projection.items
      .map((item) => findProjectionByKey(item, key))
      .find((item) => item !== undefined);
  }
  if (projection.kind === "grid") {
    return projection.rows
      .flat()
      .map((item) => findProjectionByKey(item, key))
      .find((item) => item !== undefined);
  }
  if (projection.kind === "graph") {
    for (const vertex of projection.vertices) {
      const match =
        findProjectionByKey(vertex.value, key) ??
        findProjectionByKey(vertex.adjacency, key);
      if (match) {
        return match;
      }
    }
  }
  if (projection.kind === "mapping") {
    for (const entry of projection.entries) {
      const match =
        findProjectionByKey(entry.key, key) ??
        findProjectionByKey(entry.value, key);
      if (match) {
        return match;
      }
    }
  }
  if (projection.kind === "object") {
    return projection.fields
      .map((field) => findProjectionByKey(field.value, key))
      .find((item) => item !== undefined);
  }
  return undefined;
}

function eventValue(value: SerializedValue | undefined): string {
  if (!value) {
    return "";
  }
  if (value.kind === "scalar") {
    return value.value === null ? "null" : String(value.value);
  }
  if (value.kind === "sequence") {
    return `${value.type}[${value.items.length}]`;
  }
  return value.type.split(".").at(-1) ?? value.type;
}

function operationExpression(event: SemanticEvent): string {
  const values = event.operands?.map(eventValue) ?? [];
  const symbol = event.operatorToken;
  if (!symbol || values.length === 0) {
    return values.join(" ") || "operation";
  }
  if (values.length === 1) {
    return `${symbol}${values[0]}`;
  }
  return values.join(` ${symbol.trim()} `);
}

function operationLabel(event: SemanticEvent): string {
  if (event.kind !== "operation") {
    return operationText(event);
  }
  const result = eventValue(event.result);
  return `Operation: ${operationExpression(event)}${result ? ` equals ${result}` : ""}`;
}

function operationText(event: SemanticEvent): string {
  switch (event.kind) {
    case "read":
      return `read ${event.expression}`;
    case "call":
      return `call ${event.expression} -> ${eventValue(event.result)}`;
    case "memo":
      return `${event.cacheHit ? "reuse" : "memoize"} ${event.expression} -> ${eventValue(event.result)}`;
    case "operation":
      return `${operationExpression(event)} -> ${eventValue(event.result)}`;
    case "swap":
      return `swap ${event.target ?? event.expression}`;
    case "write":
      return `write ${event.target ?? event.expression}`;
    case "compare":
      return `${event.expression} -> ${eventValue(event.result)}`;
    case "branch":
      return `branch ${eventValue(event.result)}`;
    case "iteration":
      return `iterate ${event.target ?? "item"} in ${event.iteratorExpression ?? event.expression}`;
    case "mutation":
      return `mutate ${event.target ?? event.expression}`;
    case "yield":
      return `yield ${eventValue(event.result)}`;
    case "resume":
      return `resume ${event.expression}`;
    case "exception":
      return `exception ${event.exception ?? event.expression}`;
  }
}

const OPERATION_CROSSFADE_MS = 180;

interface OperationEquationLayer {
  identity: string;
  key: string;
  operation: SemanticEvent;
  phase: "current" | "incoming" | "outgoing";
}

function operationIdentity(operation: SemanticEvent): string {
  return [
    operation.kind,
    operation.expression,
    operation.operatorToken ?? "",
    operationText(operation),
  ].join(":");
}

function OperationEquationTransition({
  operation,
}: {
  operation: SemanticEvent;
}) {
  const identity = operationIdentity(operation);
  const transitionId = useRef(0);
  const previousIdentity = useRef(identity);
  const [layers, setLayers] = useState<OperationEquationLayer[]>(() => [{
    identity,
    key: identity,
    operation,
    phase: "current",
  }]);

  useEffect(() => {
    if (previousIdentity.current === identity) {
      return;
    }
    previousIdentity.current = identity;
    transitionId.current += 1;
    const suffix = transitionId.current;
    setLayers((current) => {
      const active =
        [...current].reverse().find((layer) => layer.phase !== "outgoing");
      return [
        ...(active
          ? [{
              ...active,
              key: `${active.identity}:outgoing:${suffix}`,
              phase: "outgoing" as const,
            }]
          : []),
        {
          identity,
          key: `${identity}:incoming:${suffix}`,
          operation,
          phase: "incoming",
        },
      ];
    });
    const timeout = window.setTimeout(() => {
      setLayers((current) => {
        const incoming = [...current].reverse().find(
          (layer) =>
            layer.identity === identity && layer.phase !== "outgoing",
        );
        return incoming
          ? [{
              ...incoming,
              key: identity,
              phase: "current",
            }]
          : current;
      });
    }, OPERATION_CROSSFADE_MS);
    return () => window.clearTimeout(timeout);
  }, [identity]);

  return (
    <div className="operation-list" aria-live="polite">
      {layers.map((layer) => (
        <code
          aria-hidden={layer.phase === "outgoing" ? "true" : undefined}
          aria-label={
            layer.phase === "outgoing"
              ? undefined
              : operationLabel(layer.operation)
          }
          className={
            `operation operation-${layer.operation.kind} ` +
            `operation-equation-${layer.phase}`
          }
          data-operation-phase={layer.phase}
          key={layer.key}
          title={layer.operation.expression}
        >
          {operationText(layer.operation)}
        </code>
      ))}
    </div>
  );
}

function VisualizerContent({
  scene,
  loading,
  statusText,
  onProjectionViewChange,
}: Omit<VisualizerProps, "rendererConfig">) {
  const rendererConfig = useTraceframeRendererConfig();
  const rootStyle = {
    "--tf-state-transition-duration":
      `${rendererConfig.stateTransitionMs}ms`,
  } as CSSProperties;
  const primaryVariablesRef = useRef<HTMLDivElement>(null);
  const sceneRootRef = useRef<HTMLDivElement>(null);
  const [detailKeys, setDetailKeys] = useState<string[]>([]);
  const [retainedRelationGraph, setRetainedRelationGraph] = useState(
    scene?.relationGraph,
  );
  const inspect = (projection: SceneProjection) => {
    setDetailKeys((current) =>
      current.at(-1) === projection.key
        ? current
        : [...current, projection.key],
    );
  };
  const detailTrail = useMemo(() => {
    if (!scene) {
      return [];
    }
    const resolved: SceneProjection[] = [];
    for (const key of detailKeys) {
      let match: SceneProjection | undefined;
      for (const variable of scene.variables) {
        match = findProjectionByKey(variable.projection, key);
        if (match) {
          break;
        }
      }
      if (!match) {
        break;
      }
      resolved.push(match);
    }
    return resolved;
  }, [detailKeys, scene]);
  const detail = detailTrail.at(-1);
  useEffect(() => {
    if (scene?.relationGraph) {
      setRetainedRelationGraph(scene.relationGraph);
      return;
    }
    if (!retainedRelationGraph) {
      return;
    }
    const timeout = window.setTimeout(
      () => setRetainedRelationGraph(undefined),
      rendererConfig.motionDurationMs,
    );
    return () => window.clearTimeout(timeout);
  }, [
    rendererConfig.motionDurationMs,
    retainedRelationGraph,
    scene?.relationGraph,
  ]);
  const relationHeadingGraph =
    scene?.relationGraph ?? retainedRelationGraph;
  const relationMotionGraph =
    scene?.relationGraph ??
    (retainedRelationGraph
      ? {
          ...retainedRelationGraph,
          edges: [],
          entities: [],
          roots: [],
        }
      : undefined);
  const primaryVariableGroups = useMemo(() => {
    const visible =
      scene?.variables.filter(
        (variable) => {
          if (!isPrimaryProjection(variable.projection)) {
            return false;
          }
          if (variable.projection.kind !== "object") {
            return true;
          }
          const represented = scene.relationGraph?.entities.some(
            (entity) => entity.id === variable.projection.key,
          );
          if (represented) {
            return false;
          }
          const activelyFocused = scene.focusPaths.some(
            (path) =>
              path === variable.name ||
              path.startsWith(`${variable.name}.`) ||
              path.startsWith(`${variable.name}[`) ||
              path.startsWith(`${variable.name}{`),
          );
          const emptyDisconnectedObject =
            variable.projection.fields.length === 0 &&
            !activelyFocused;
          return !emptyDisconnectedObject;
        },
      ) ?? [];
    const groups = new Map<string, {
      aliases: string[];
      changed: boolean;
      variable: (typeof visible)[number];
    }>();
    visible.forEach((variable) => {
      const key = `${variable.projection.kind}:${variable.projection.key}`;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          aliases: [variable.name],
          changed: variable.changed,
          variable,
        });
        return;
      }
      existing.aliases.push(variable.name);
      existing.changed ||= variable.changed;
      if (
        scene?.focusPaths.some(
          (path) =>
            path === variable.name ||
            path.startsWith(`${variable.name}.`) ||
            path.startsWith(`${variable.name}[`) ||
            path.startsWith(`${variable.name}{`),
        )
      ) {
        existing.variable = variable;
      }
    });
    return [...groups.values()];
  }, [scene]);
  const compactVariables = useMemo(
    () => scene?.variables.filter((variable) => !isPrimaryProjection(variable.projection)) ?? [],
    [scene],
  );
  const visibleOperation = useMemo(
    () => {
      const operations =
        scene?.operations.filter((operation) => operation.kind !== "iteration") ?? [];
      const cacheHit = [...operations].reverse().find(
        (operation) => operation.kind === "memo" && operation.cacheHit,
      );
      const completedPrimitive = [...operations].reverse().find(
        (operation) => operation.kind === "operation",
      );
      const memoized = [...operations].reverse().find(
        (operation) => operation.kind === "memo",
      );
      return cacheHit ?? completedPrimitive ?? memoized ?? operations.at(-1);
    },
    [scene],
  );
  useSceneMotion(
    sceneRootRef,
    scene?.frameIndex,
    scene?.motionPlan,
    detail?.key ?? "overview",
    rendererConfig.motionDurationMs,
  );
  useOperationMotion(
    sceneRootRef,
    scene?.frameIndex,
    scene?.operationMotion,
    rendererConfig.operationMotionDurationMs,
  );

  useEffect(() => {
    if (scene && detailKeys.length > 0 && detailTrail.length !== detailKeys.length) {
      setDetailKeys((current) => current.slice(0, detailTrail.length));
    }
  }, [detailKeys.length, detailTrail.length, scene]);

  useEffect(() => {
    const primary = primaryVariablesRef.current;
    if (!primary) {
      return;
    }
    primary.scrollTop = 0;
    primary.scrollLeft = 0;
    const animationFrame = requestAnimationFrame(() => {
      primary.scrollTop = 0;
      primary.scrollLeft = 0;
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [scene?.frameIndex]);

  if (loading && !scene) {
    return (
      <div
        className="tf-root visual-empty"
        aria-live="polite"
        style={rootStyle}
      >
        <span className="runtime-loader" />
        <strong>{statusText}</strong>
      </div>
    );
  }

  if (!scene) {
    return (
      <div className="tf-root visual-empty" style={rootStyle}>
        <TerminalSquare size={28} strokeWidth={1.5} aria-hidden="true" />
        <strong>No execution trace</strong>
      </div>
    );
  }

  if (detail) {
    return (
      <div
        className="tf-root detail-view"
        ref={sceneRootRef}
        style={rootStyle}
      >
        <div className="detail-toolbar">
          <button
            className="icon-button"
            onClick={() => setDetailKeys((current) => current.slice(0, -1))}
            title={detailKeys.length > 1 ? "Back to parent value" : "Back to execution"}
            aria-label={detailKeys.length > 1 ? "Back to parent value" : "Back to execution"}
            type="button"
          >
            <ArrowLeft size={17} aria-hidden="true" />
          </button>
          <div className="detail-heading">
            <span className="panel-kicker">VALUE DETAIL</span>
            <nav aria-label="Value detail path" className="detail-breadcrumbs">
              {detailTrail.map((item, index) => (
                <span key={`${item.key}:${index}`}>
                  {index > 0 && <ChevronRight aria-hidden="true" size={11} />}
                  {index === detailTrail.length - 1 ? (
                    <strong>{item.label}</strong>
                  ) : (
                    <button
                      onClick={() => setDetailKeys((current) => current.slice(0, index + 1))}
                      type="button"
                    >
                      {item.label}
                    </button>
                  )}
                </span>
              ))}
            </nav>
          </div>
          <ProjectionKindLabel projection={detail} />
        </div>
        <div className="detail-content">
          <ProjectionView
            projection={detail}
            depth={0}
            expanded
            focusedGraphVertexIds={scene.focusedGraphVertexIds}
            graphMemberships={scene.graphMemberships}
            variableMarkers={scene.variableMarkers}
            onInspect={inspect}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="tf-root visual-scene"
      data-call-depth={scene.callStack.length}
      data-frame-index={scene.frameIndex}
      data-motion-count={scene.motionPlan.motions.length}
      data-dataflow-edge-count={scene.dataFlow.edges.length}
      data-attention-count={scene.attention.length}
      data-function-name={scene.functionName}
      data-source-line={scene.line}
      ref={sceneRootRef}
      style={rootStyle}
    >
      {scene.callStack.length > 1 && (
        <div className="call-stack-strip" aria-label="Call stack">
          <Layers size={13} aria-hidden="true" />
          <span className="panel-kicker">CALL STACK</span>
          <div className="call-stack-frames">
            {scene.callStack.map((entry, index) => (
              <div className="call-stack-entry-wrap tf-enter" key={entry.scopeId}>
                {index > 0 && <ChevronRight size={11} aria-hidden="true" />}
                <span
                  className={`call-stack-entry ${
                    index === scene.callStack.length - 1 ? "active" : ""
                  }`}
                >
                  <strong>{entry.functionName}</strong>
                  <code>{entry.line}</code>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="scene-content">
        <div
          className="primary-variables"
          ref={primaryVariablesRef}
        >
          {relationHeadingGraph && relationMotionGraph && (
            <section className="relation-section tf-enter">
              <header>
                <div>
                  <strong>
                    {relationHeadingGraph.layout === "tree"
                      ? "Object tree"
                      : relationHeadingGraph.layout === "cycle"
                        ? "Object cycle"
                        : "Object graph"}
                  </strong>
                  <span>{relationHeadingGraph.entities.length} identities</span>
                </div>
              </header>
              <RelationGraphView
                graph={relationMotionGraph}
                entityBindings={scene.entityBindings}
                focusedEntityIds={scene.focusedEntityIds}
                focusedRelationKeys={scene.focusedRelationKeys}
                onInspect={inspect}
              />
            </section>
          )}
          {scene.callFlow ? (
            <CallFlowView callFlow={scene.callFlow} />
          ) : scene.recursion ? (
            <RecursionView recursion={scene.recursion} />
          ) : null}
          <ControlFlowView control={scene.controlFlow} />
          {primaryVariableGroups.map(({ aliases, changed, variable }) => {
            const facet = variable.graphFacet;
            const graphView = variable.projection.kind === "graph";
            return (
              <section
                className={`variable-panel tf-enter ${changed ? "changed" : ""}`}
                data-variable-aliases={aliases.join(" ")}
                key={`${variable.projection.kind}:${variable.projection.key}`}
              >
                <header className="variable-heading">
                  <div>
                    <strong>{aliases[0]}</strong>
                    {aliases.length > 1 && (
                      <span className="variable-alias">
                        = {aliases.slice(1).join(", ")}
                      </span>
                    )}
                    <ProjectionKindLabel projection={variable.projection} />
                  </div>
                  <div className="variable-actions">
                    {onProjectionViewChange && (facet || graphView) && (
                      <button
                        className="inspect-button"
                        onClick={() =>
                          onProjectionViewChange(
                            variable.name,
                            graphView ? "structural" : "graph",
                            facet?.directed,
                          )
                        }
                        title={
                          graphView
                            ? `View ${variable.name} structurally`
                            : `View ${variable.name} as a graph`
                        }
                        aria-label={
                          graphView
                            ? `View ${variable.name} structurally`
                            : `View ${variable.name} as a graph`
                        }
                        type="button"
                      >
                        {graphView
                          ? <List size={15} aria-hidden="true" />
                          : <Network size={15} aria-hidden="true" />}
                      </button>
                    )}
                    <button
                      className="inspect-button"
                      onClick={() => inspect(variable.projection)}
                      title={`Inspect ${variable.name}`}
                      aria-label={`Inspect ${variable.name}`}
                      type="button"
                    >
                      <Maximize2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                </header>
                <div className="variable-content">
                  <ProjectionView
                    projection={variable.projection}
                    changed={variable.changed}
                    path={variable.name}
                    focusPaths={scene.focusPaths}
                    variableMarkers={scene.variableMarkers}
                    focusedGraphVertexIds={scene.focusedGraphVertexIds}
                    graphMemberships={scene.graphMemberships}
                    onInspect={inspect}
                  />
                </div>
              </section>
            );
          })}
        </div>

        {compactVariables.length > 0 && (
          <div className="locals-strip">
            {compactVariables.map((variable) => (
              <div
                className={`local-value tf-enter ${variable.changed ? "changed" : ""}`}
                data-variable-aliases={variable.name}
                key={variable.name}
              >
                <span>{variable.name}</span>
                <ProjectionView
                  projection={variable.projection}
                  changed={variable.changed}
                  path={variable.name}
                  focusPaths={scene.focusPaths}
                  variableMarkers={scene.variableMarkers}
                  focusedGraphVertexIds={scene.focusedGraphVertexIds}
                  graphMemberships={scene.graphMemberships}
                  onInspect={inspect}
                />
              </div>
            ))}
          </div>
        )}

        {(visibleOperation || scene.changes.length > 0) && (
          <div className="change-strip">
            <span className="panel-kicker">
              {scene.operations.some((operation) => operation.kind === "iteration")
                ? "ITERATION"
                : "STEP"}
            </span>
            {visibleOperation ? (
            <div className="iteration-details">
              {scene.causalLinks.length > 0 && (
                <div className="causal-list" aria-label="Data flow">
                  {scene.causalLinks.slice(0, 3).map((link, index) => (
                    <span
                      className={`causal-link tf-enter source-${link.sourceKind}`}
                      key={`${link.source}:${link.target}:${index}`}
                    >
                      <code>{link.sourceLabel ?? link.source}</code>
                      <ArrowRight size={11} aria-hidden="true" />
                      <code>{link.targetLabel ?? link.target}</code>
                    </span>
                  ))}
                  {scene.causalLinks.length > 3 && (
                    <small>+{scene.causalLinks.length - 3}</small>
                  )}
                </div>
              )}
              <OperationEquationTransition operation={visibleOperation} />
            </div>
            ) : (
              <div className="change-list">
                {scene.changes.slice(0, 4).map((change) => (
                  <code className="tf-enter" key={`${change.kind}:${change.path}`}>
                    <i className={`change-mark ${change.kind}`} />
                    {change.path}
                  </code>
                ))}
                {scene.changes.length > 4 && (
                  <small>+{scene.changes.length - 4} more</small>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function Visualizer({
  rendererConfig,
  ...props
}: VisualizerProps) {
  return (
    <TraceframeProvider config={rendererConfig}>
      <VisualizerContent {...props} />
    </TraceframeProvider>
  );
}
