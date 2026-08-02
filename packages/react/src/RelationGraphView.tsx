import { useMemo, type CSSProperties } from "react";
import type {
  EntityBinding,
  ObjectProjection,
  RelationEntity,
  RelationEdge,
  RelationGraph,
  TopologySnapshot,
} from "@traceframe/core";
import { layoutRelationGraph } from "@traceframe/core";
import { useTraceframeRendererConfig } from "./TraceframeProvider";
import { useTopologyMotion } from "./useTopologyMotion";

interface RelationGraphViewProps {
  graph: RelationGraph;
  focusedEntityIds?: readonly string[];
  focusedRelationKeys?: readonly string[];
  entityBindings?: readonly EntityBinding[];
  onInspect(projection: ObjectProjection): void;
}

interface RelationNodeMotionData {
  entity: RelationEntity;
  root: boolean;
}

interface RelationEdgeMotionData {
  edge: RelationEdge;
  relationKey: string;
}

export function RelationGraphView({
  graph,
  focusedEntityIds = [],
  focusedRelationKeys = [],
  entityBindings = [],
  onInspect,
}: RelationGraphViewProps) {
  const rendererConfig = useTraceframeRendererConfig();
  const nodeSize = rendererConfig.relationNodeSize;
  const layout = useMemo(
    () => layoutRelationGraph(
      graph,
      {
        layerGap: rendererConfig.relationLayerGap,
        nodeGap: rendererConfig.relationNodeGap,
        nodeSize,
      },
    ),
    [
      graph,
      nodeSize,
      rendererConfig.relationLayerGap,
      rendererConfig.relationNodeGap,
    ],
  );
  const topologyTarget = useMemo<TopologySnapshot<
    RelationNodeMotionData,
    RelationEdgeMotionData
  >>(() => ({
    width: layout.width,
    height: layout.height,
    nodes: layout.positioned.map(({ entity, x, y }) => ({
      id: entity.id,
      x,
      y,
      data: {
        entity,
        root: graph.roots.includes(entity.id),
      },
    })),
    edges: graph.edges.map((edge) => {
      const relationKey = `${edge.sourceId}:${edge.label}:${edge.targetId}`;
      return {
        id: relationKey,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        data: { edge, relationKey },
      };
    }),
  }), [graph.edges, graph.roots, layout, nodeSize]);
  const animatedTopology = useTopologyMotion(topologyTarget, {
    durationMs: rendererConfig.motionDurationMs,
    minNodeSeparation: rendererConfig.minNodeSeparation,
  });
  const positions = new Map(
    animatedTopology.nodes.map((node) => [node.id, node]),
  );

  return (
    <div
      className="tf-root relation-viewport"
      style={{
        "--tf-relation-node-size": `${nodeSize}px`,
        "--tf-state-transition-duration":
          `${rendererConfig.stateTransitionMs}ms`,
      } as CSSProperties}
    >
      <div
        className="relation-canvas"
        style={{
          width: animatedTopology.width,
          height: animatedTopology.height,
        }}
      >
        <svg
          className="relation-edges"
          width={animatedTopology.width}
          height={animatedTopology.height}
          aria-hidden="true"
        >
          {graph.layout === "cycle" && (
            <defs>
              <marker
                id={`relation-arrow-${graph.entities.length}`}
                markerHeight="6"
                markerWidth="6"
                orient="auto"
                refX="5"
                refY="3"
                viewBox="0 0 6 6"
              >
                <path d="M 0 0 L 6 3 L 0 6 z" />
              </marker>
            </defs>
          )}
          {animatedTopology.edges.map((animatedEdge, edgeIndex) => {
            const { edge, relationKey } = animatedEdge.data;
            const source = positions.get(edge.sourceId);
            const target = positions.get(edge.targetId);
            if (!source || !target) {
              return null;
            }
            const deltaX = target.x - source.x;
            const deltaY = target.y - source.y;
            const distance = Math.max(1, Math.hypot(deltaX, deltaY));
            const cycle = graph.layout === "cycle";
            const x1 = cycle
              ? source.x + deltaX / distance * (nodeSize / 2)
              : source.x;
            const y1 = cycle
              ? source.y + deltaY / distance * (nodeSize / 2)
              : graph.layout === "network"
                ? source.y
                : source.y + nodeSize / 2;
            const x2 = cycle
              ? target.x - deltaX / distance * (nodeSize / 2 + 5)
              : target.x;
            const y2 = cycle
              ? target.y - deltaY / distance * (nodeSize / 2 + 5)
              : graph.layout === "network"
                ? target.y
                : target.y - nodeSize / 2;
            const middle = y1 + (y2 - y1) / 2;
            const centerX = animatedTopology.width / 2;
            const centerY = animatedTopology.height / 2;
            const midpointX = (x1 + x2) / 2;
            const midpointY = (y1 + y2) / 2;
            const outwardX = midpointX - centerX;
            const outwardY = midpointY - centerY;
            const outwardLength = Math.hypot(outwardX, outwardY);
            const curve = graph.entities.length === 2
              ? {
                  x: centerX,
                  y: centerY + (edgeIndex % 2 === 0 ? -72 : 72),
                }
              : {
                  x: midpointX + outwardX / Math.max(1, outwardLength) * 34,
                  y: midpointY + outwardY / Math.max(1, outwardLength) * 34,
                };
            return (
              <path
                className={focusedRelationKeys.includes(relationKey) ? "focused" : ""}
                data-topology-phase={animatedEdge.phase}
                d={
                  cycle
                    ? `M ${x1} ${y1} Q ${curve.x} ${curve.y} ${x2} ${y2}`
                    : graph.layout === "network"
                    ? `M ${x1} ${y1} L ${x2} ${y2}`
                    : `M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}`
                }
                key={relationKey}
                markerEnd={
                  cycle
                    ? `url(#relation-arrow-${graph.entities.length})`
                    : undefined
                }
                opacity={animatedEdge.opacity}
              />
            );
          })}
        </svg>

        {animatedTopology.edges.map((animatedEdge, edgeIndex) => {
          const { edge, relationKey } = animatedEdge.data;
          const source = positions.get(edge.sourceId);
          const target = positions.get(edge.targetId);
          if (!source || !target) {
            return null;
          }
          const centerX = animatedTopology.width / 2;
          const centerY = animatedTopology.height / 2;
          const midpointX = (source.x + target.x) / 2;
          const midpointY = (source.y + target.y) / 2;
          const outwardX = midpointX - centerX;
          const outwardY = midpointY - centerY;
          const outwardLength = Math.hypot(outwardX, outwardY);
          const cycleLabel = graph.entities.length === 2
            ? {
                x: centerX,
                y: centerY + (edgeIndex % 2 === 0 ? -36 : 36),
              }
            : {
                x: midpointX + outwardX / Math.max(1, outwardLength) * 18,
                y: midpointY + outwardY / Math.max(1, outwardLength) * 18,
              };
          return (
            <span
              className={`relation-label ${
                focusedRelationKeys.includes(relationKey)
                  ? "focused"
                  : ""
              }`}
              data-topology-phase={animatedEdge.phase}
              key={`label:${relationKey}`}
              style={{
                left:
                  graph.layout === "cycle"
                    ? cycleLabel.x
                    : midpointX,
                opacity: animatedEdge.opacity,
                top:
                  graph.layout === "cycle"
                    ? cycleLabel.y
                    : midpointY,
              }}
            >
              {edge.label}
            </span>
          );
        })}

        {animatedTopology.nodes.map((node) => {
          const { entity, root } = node.data;
          const bindings = entityBindings
            .filter((binding) => binding.entityId === entity.id)
            .slice(0, 3);
          return (
          <button
            className={`relation-node ${
              root ? "root" : ""
            } ${focusedEntityIds.includes(entity.id) ? "focused" : ""}`}
            data-entity-bindings={bindings.map(({ label }) => label).join(" ")}
            data-motion-anchor="entity"
            data-motion-key={entity.projection.key}
            data-topology-id={node.id}
            data-topology-phase={node.phase}
            key={node.id}
            onClick={() => onInspect(entity.projection)}
            style={{
              left: node.x - nodeSize / 2,
              opacity: node.opacity,
              pointerEvents: node.phase === "exiting" ? "none" : undefined,
              top: node.y - nodeSize / 2,
              transform: `scale(${node.scale})`,
            }}
            title={`Inspect ${entity.type} ${entity.label}`}
            type="button"
          >
            {bindings.length > 0 && (
              <span
                aria-label={`References: ${bindings.map(({ label }) => label).join(", ")}`}
                className="entity-bindings"
              >
                {bindings.map(({ label }) => (
                  <i className="tf-enter" key={label}>{label}</i>
                ))}
              </span>
            )}
            <strong>{entity.label}</strong>
          </button>
          );
        })}
      </div>
    </div>
  );
}
