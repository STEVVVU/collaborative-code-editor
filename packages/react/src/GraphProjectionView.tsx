import { useMemo, type CSSProperties } from "react";
import type {
  GraphMembership,
  GraphProjection,
  GraphVertexProjection,
  VariableMarker,
  SceneProjection,
  TopologySnapshot,
} from "@traceframe/core";
import { useTraceframeRendererConfig } from "./TraceframeProvider";
import { useTopologyMotion } from "./useTopologyMotion";

interface GraphProjectionViewProps {
  projection: GraphProjection;
  focusPaths?: readonly string[];
  variableMarkers?: readonly VariableMarker[];
  focusedVertexIds?: readonly string[];
  memberships?: readonly GraphMembership[];
  path?: string;
  onInspect?: (projection: SceneProjection) => void;
}

interface GraphNodeMotionData {
  index: number;
  vertex: GraphVertexProjection;
}

type GraphEdgeMotionData = GraphProjection["edges"][number];

function focusedVertexIndexes(
  projection: GraphProjection,
  focusPaths: readonly string[],
  path: string,
): Set<number> {
  const indexes = new Set<number>();
  for (const focusPath of focusPaths) {
    const match = new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\[(-?\\d+)\\]`)
      .exec(focusPath);
    if (!match) {
      continue;
    }
    const index = Number(match[1]);
    if (index >= 0 && index < projection.vertices.length) {
      indexes.add(index);
    }
  }
  return indexes;
}

export function GraphProjectionView({
  projection,
  focusPaths = [],
  variableMarkers = [],
  focusedVertexIds = [],
  memberships = [],
  path = projection.label,
  onInspect,
}: GraphProjectionViewProps) {
  const rendererConfig = useTraceframeRendererConfig();
  const nodeSize = rendererConfig.graphNodeSize;
  const layout = useMemo(
    () => rendererConfig.topologyLayoutRegistry.layout(projection, {
      nodeSize,
    }),
    [nodeSize, projection, rendererConfig.topologyLayoutRegistry],
  );
  const topologyTarget = useMemo<TopologySnapshot<
    GraphNodeMotionData,
    GraphEdgeMotionData
  >>(() => ({
    width: layout.width,
    height: layout.height,
    nodes: layout.positioned.map(({ vertex, x, y }, index) => ({
      id: vertex.id,
      x,
      y,
      data: { index, vertex },
    })),
    edges: projection.edges.map((edge) => ({
      ...edge,
      data: edge,
    })),
  }), [layout, projection.edges]);
  const animatedTopology = useTopologyMotion(topologyTarget, {
    durationMs: rendererConfig.motionDurationMs,
    minNodeSeparation: rendererConfig.minNodeSeparation,
  });
  const positions = new Map(
    animatedTopology.nodes.map((node) => [node.id, node]),
  );
  const focusedIndexes = focusedVertexIndexes(projection, focusPaths, path);
  projection.vertices.forEach((vertex, index) => {
    if (focusedVertexIds.includes(vertex.id)) {
      focusedIndexes.add(index);
    }
  });
  const focusedIds = new Set(
    [...focusedIndexes].map((index) => projection.vertices[index]?.id),
  );
  const visibleMemberships = memberships
    .filter((membership) => membership.graphKey === projection.key)
    .slice(0, 3);
  const visibleVariableMarkers = variableMarkers.flatMap((marker) => {
    const match = new RegExp(
      `^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\[(\\d+)\\]$`,
    ).exec(marker.path);
    const index = match ? Number(match[1]) : -1;
    const vertex = projection.vertices[index];
    const position = vertex ? positions.get(vertex.id) : undefined;
    return position ? [{ marker, position }] : [];
  });

  return (
    <div
      className="tf-root graph-viewport"
      data-motion-key={projection.key}
      aria-label={`${projection.label}, ${projection.directed ? "directed" : "undirected"} ${projection.layout} with ${projection.vertices.length} vertices`}
      style={{
        "--tf-graph-node-size": `${nodeSize}px`,
        "--tf-state-transition-duration":
          `${rendererConfig.stateTransitionMs}ms`,
      } as CSSProperties}
    >
      <div
        className="graph-canvas"
        style={{
          width: animatedTopology.width,
          height: animatedTopology.height,
        }}
      >
        <svg
          aria-hidden="true"
          className="graph-edges"
          height={animatedTopology.height}
          viewBox={`0 0 ${animatedTopology.width} ${animatedTopology.height}`}
          width={animatedTopology.width}
        >
          <defs>
            <marker
              id={`arrow-${projection.key.replace(/[^A-Za-z0-9_-]/g, "-")}`}
              markerHeight="7"
              markerWidth="7"
              orient="auto-start-reverse"
              refX="17"
              refY="3.5"
              viewBox="0 0 7 7"
            >
              <path d="M 0 0 L 7 3.5 L 0 7 z" />
            </marker>
          </defs>
          {animatedTopology.edges.map((edge) => {
            const source = positions.get(edge.sourceId);
            const target = positions.get(edge.targetId);
            if (!source || !target) {
              return null;
            }
            const focused =
              focusedIds.has(edge.sourceId) && focusedIds.has(edge.targetId);
            return (
              <line
                className={focused ? "focused" : ""}
                key={edge.id}
                markerEnd={
                  projection.directed
                    ? `url(#arrow-${projection.key.replace(/[^A-Za-z0-9_-]/g, "-")})`
                    : undefined
                }
                opacity={edge.opacity}
                data-topology-phase={edge.phase}
                x1={source.x}
                x2={target.x}
                y1={source.y}
                y2={target.y}
              />
            );
          })}
        </svg>

        {animatedTopology.nodes.map((node) => {
          const { index, vertex } = node.data;
          return (
          <button
            aria-label={`Inspect vertex ${vertex.label}`}
            className={`graph-node ${focusedIds.has(vertex.id) ? "focused" : ""}`}
            data-motion-key={vertex.adjacency.key}
            data-projection-path={
              node.phase === "exiting" ? undefined : `${path}[${index}]`
            }
            data-motion-anchor="entity"
            data-topology-id={node.id}
            data-topology-phase={node.phase}
            key={node.id}
            onClick={() => onInspect?.(vertex.adjacency)}
            style={{
              left: node.x - nodeSize / 2,
              opacity: node.opacity,
              pointerEvents: node.phase === "exiting" ? "none" : undefined,
              top: node.y - nodeSize / 2,
              transform: `scale(${node.scale})`,
            }}
            title={`Inspect vertex ${vertex.label}`}
            type="button"
          >
            <strong>{vertex.label}</strong>
            {visibleMemberships.some((membership) =>
              membership.vertexIds.includes(vertex.id),
            ) && (
              <span className="graph-membership-dots tf-enter" aria-hidden="true">
                {visibleMemberships.map((membership, membershipIndex) =>
                  membership.vertexIds.includes(vertex.id) ? (
                    <i
                      className={`membership-color-${membershipIndex}`}
                      key={membership.variableName}
                    />
                  ) : null,
                )}
              </span>
            )}
          </button>
          );
        })}
        {visibleVariableMarkers.map(({ marker, position }) => (
          <span
            aria-label={`${marker.label} at ${marker.path}`}
            className="variable-marker graph-variable-marker"
            data-variable-path={marker.path}
            key={marker.id}
            style={{
              left: position.x,
              opacity: position.opacity,
              top: position.y - nodeSize / 2 - 20,
            }}
          >
            {marker.label}
          </span>
        ))}
      </div>
      {visibleMemberships.length > 0 && (
        <div className="graph-membership-legend tf-enter" aria-label="Graph memberships">
          {visibleMemberships.map((membership, index) => (
            <span key={membership.variableName}>
              <i className={`membership-color-${index}`} />
              {membership.variableName}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
