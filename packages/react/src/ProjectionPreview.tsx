import { useMemo, type CSSProperties } from "react";
import type { SceneProjection } from "@traceframe/core";
import { useTraceframeRendererConfig } from "./TraceframeProvider";

const PREVIEW_ITEMS = 12;

function summary(projection: SceneProjection): string {
  switch (projection.kind) {
    case "scalar": return String(projection.value);
    case "reference": return `→ ${projection.targetId}`;
    case "truncated": return projection.preview;
    case "sequence": return `${projection.items.length} items`;
    case "grid": return `${projection.rows.length} × ${projection.rows[0]?.length ?? 0}`;
    case "mapping": return `${projection.entries.length} entries`;
    case "object": return `${projection.fields.length} fields`;
    case "graph": return `${projection.vertices.length} vertices · ${projection.edges.length} edges`;
  }
}

function GraphThumbnail({ projection }: { projection: Extract<SceneProjection, { kind: "graph" }> }) {
  const rendererConfig = useTraceframeRendererConfig();
  const layout = useMemo(
    () => rendererConfig.topologyLayoutRegistry.layout(projection, { nodeSize: 5 }),
    [projection, rendererConfig.topologyLayoutRegistry],
  );
  const points = layout.positioned.slice(0, PREVIEW_ITEMS);
  const byId = new Map(points.map((point) => [point.vertex.id, point]));
  return (
    <svg aria-hidden="true" className="attention-preview-graph" viewBox={`0 0 ${layout.width} ${layout.height}`}>
      {projection.edges.slice(0, 18).map((edge) => {
        const from = byId.get(edge.sourceId);
        const to = byId.get(edge.targetId);
        return from && to ? <line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} /> : null;
      })}
      {points.map(({ vertex, x, y }) => <circle key={vertex.id} cx={x} cy={y} r="3.2" />)}
    </svg>
  );
}

/** A bounded, read-only rendering for context and nested child values. */
export function ProjectionPreview({
  projection,
  level = "thumbnail",
  onInspect,
  path,
}: {
  projection: SceneProjection;
  level?: "token" | "thumbnail";
  onInspect?: (projection: SceneProjection, path?: string) => void;
  path?: string;
}) {
  if (level === "token" || projection.kind === "scalar" || projection.kind === "reference" || projection.kind === "truncated") {
    return <span className={`attention-preview-token kind-${projection.kind}`}>{summary(projection)}</span>;
  }
  let content;
  if (projection.kind === "graph") {
    content = <GraphThumbnail projection={projection} />;
  } else if (projection.kind === "sequence") {
    content = <div className="attention-preview-cells">{projection.items.slice(0, PREVIEW_ITEMS).map((item) => <span key={item.key}>{summary(item)}</span>)}</div>;
  } else if (projection.kind === "grid") {
    content = <div className="attention-preview-grid" style={{ "--preview-columns": Math.min(projection.rows[0]?.length ?? 1, 6) } as CSSProperties}>{projection.rows.slice(0, 4).flatMap((row, ri) => row.slice(0, 6).map((item, ci) => <span key={`${ri}:${ci}`}>{summary(item)}</span>))}</div>;
  } else if (projection.kind === "mapping") {
    content = <div className="attention-preview-rows">{projection.entries.slice(0, 4).map((entry) => <span key={entry.key.key}>{summary(entry.key)} <i>→</i> {summary(entry.value)}</span>)}</div>;
  } else {
    content = <div className="attention-preview-rows">{projection.fields.slice(0, 4).map((field) => <span key={field.name}>{field.name} <i>·</i> {summary(field.value)}</span>)}</div>;
  }
  const preview = <div className={`attention-preview kind-${projection.kind}`}>{content}</div>;
  return onInspect
    ? <button aria-label={`Open details for ${projection.label}`} className="attention-preview-open" onClick={() => onInspect(projection, path)} title={`Open details for ${projection.label}`} type="button">{preview}</button>
    : preview;
}
