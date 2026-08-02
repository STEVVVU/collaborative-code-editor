import { Boxes, Braces, Grid3X3, List, Network, ScanText } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import type {
  GraphMembership,
  VariableMarker,
  SceneProjection,
} from "@traceframe/core";
import { GraphProjectionView } from "./GraphProjectionView";
import { useTraceframeRendererConfig } from "./TraceframeProvider";

export interface ProjectionViewProps {
  projection: SceneProjection;
  changed?: boolean;
  depth?: number;
  expanded?: boolean;
  path?: string;
  focusPaths?: readonly string[];
  variableMarkers?: readonly VariableMarker[];
  focusedGraphVertexIds?: readonly string[];
  graphMemberships?: readonly GraphMembership[];
  onInspect?: (projection: SceneProjection) => void;
}

function escapedPath(path: string): string {
  return path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function VariableMarkerLabel({
  className = "",
  marker,
  style,
}: {
  className?: string;
  marker: VariableMarker;
  style: CSSProperties;
}) {
  return (
    <span
      aria-label={`${marker.label} at ${marker.path}`}
      className={`variable-marker ${className}`.trim()}
      data-variable-path={marker.path}
      key={marker.id}
      style={style}
    >
      {marker.label}
    </span>
  );
}

function nestedSummary(projection: SceneProjection): string {
  switch (projection.kind) {
    case "sequence":
      return `${projection.items.length}`;
    case "grid":
      return `${projection.rows.length}x${projection.rows[0]?.length ?? 0}`;
    case "graph":
      return `${projection.vertices.length}`;
    case "mapping":
      return `${projection.entries.length}`;
    case "object":
      return `${projection.fields.length}`;
    default:
      return "";
  }
}

function nestedInspectLabel(projection: SceneProjection): string {
  const summary = nestedSummary(projection);
  const unit =
    projection.kind === "object"
      ? "fields"
      : projection.kind === "graph"
        ? "vertices"
      : projection.kind === "mapping"
        ? "entries"
        : projection.kind === "grid"
          ? "cells"
          : "items";
  return `Inspect ${projection.label}: ${projection.type}, ${summary} ${unit}`;
}

function ProjectionIcon({ kind }: { kind: SceneProjection["kind"] }) {
  const props = { size: 14, strokeWidth: 1.8, "aria-hidden": true } as const;
  switch (kind) {
    case "sequence":
      return <List {...props} />;
    case "grid":
      return <Grid3X3 {...props} />;
    case "mapping":
      return <Braces {...props} />;
    case "object":
      return <Boxes {...props} />;
    case "graph":
    case "reference":
      return <Network {...props} />;
    default:
      return <ScanText {...props} />;
  }
}

export function ProjectionView({
  projection,
  changed = false,
  depth = 0,
  expanded = false,
  path = projection.label,
  focusPaths = [],
  variableMarkers = [],
  focusedGraphVertexIds = [],
  graphMemberships = [],
  onInspect,
}: ProjectionViewProps) {
  const rendererConfig = useTraceframeRendererConfig();
  const [retainedGraph, setRetainedGraph] = useState(
    projection.kind === "graph" ? projection : undefined,
  );
  useEffect(() => {
    if (projection.kind === "graph") {
      setRetainedGraph(projection);
      return;
    }
    if (!retainedGraph) {
      return;
    }
    const timeout = window.setTimeout(
      () => setRetainedGraph(undefined),
      rendererConfig.motionDurationMs,
    );
    return () => window.clearTimeout(timeout);
  }, [
    projection,
    rendererConfig.motionDurationMs,
    retainedGraph,
  ]);
  const focused = focusPaths.includes(path);
  const graphProjection =
    projection.kind === "graph"
      ? projection
      : retainedGraph
        ? {
            ...retainedGraph,
            edges: [],
            vertices: [],
          }
        : undefined;

  if (projection.kind === "scalar") {
    return (
      <span
        className={`scalar-value ${changed ? "changed" : ""} ${focused ? "focused" : ""}`}
        data-motion-key={projection.key}
        data-motion-anchor="value"
        data-projection-path={path}
      >
        {projection.value}
      </span>
    );
  }

  if (projection.kind === "reference") {
    return (
      <span className="reference-value" data-motion-key={projection.key}>
        <Network size={13} aria-hidden="true" />
        {projection.targetId}
      </span>
    );
  }

  if (projection.kind === "truncated") {
    return (
      <span className="truncated-value" data-motion-key={projection.key}>
        {projection.preview}
      </span>
    );
  }

  if (depth > 0 && !expanded) {
    const summary =
      projection.kind === "sequence"
        ? `[${nestedSummary(projection)}]`
        : projection.kind === "mapping"
          ? `{${nestedSummary(projection)}}`
          : projection.kind === "object"
            ? projection.type.split(".").at(-1) ?? projection.type
            : nestedSummary(projection);
    const content = <span>{summary}</span>;
    if (onInspect) {
      return (
        <button
          aria-label={nestedInspectLabel(projection)}
          className={`nested-projection-token kind-${projection.kind} ${
            focused ? "focused" : ""
          }`}
          data-motion-key={projection.key}
          data-projection-path={path}
          data-motion-anchor="container"
          onClick={() => onInspect(projection)}
          title={nestedInspectLabel(projection)}
          type="button"
        >
          {content}
        </button>
      );
    }
    return (
      <span
        className={`nested-projection-token kind-${projection.kind} ${
          focused ? "focused" : ""
        }`}
        data-motion-key={projection.key}
        data-projection-path={path}
        data-motion-anchor="container"
      >
        {content}
      </span>
    );
  }

  if (projection.kind === "sequence") {
    const markers = variableMarkers.flatMap((marker) => {
      const match = new RegExp(`^${escapedPath(path)}\\[(\\d+)\\]$`)
        .exec(marker.path);
      return match ? [{ marker, index: Number(match[1]) }] : [];
    });
    return (
      <div
        className={`sequence-view ${changed ? "changed" : ""}`}
        data-motion-key={projection.key}
      >
        {markers.map(({ marker, index }) => (
          <VariableMarkerLabel
            key={marker.id}
            marker={marker}
            style={{ left: 29 + index * 54, top: 2 }}
          />
        ))}
        {projection.items.map((item, index) => (
          <div
            className={`sequence-cell tf-enter ${focusPaths.includes(`${path}[${index}]`) ? "focused" : ""}`}
            data-projection-path={`${path}[${index}]`}
            data-motion-anchor="container"
            key={item.key}
          >
            <span className="cell-index">{index}</span>
            <ProjectionView
              projection={item}
              depth={depth + 1}
              expanded={false}
              path={`${path}[${index}]`}
              focusPaths={focusPaths}
              variableMarkers={variableMarkers}
              focusedGraphVertexIds={focusedGraphVertexIds}
              graphMemberships={graphMemberships}
              onInspect={onInspect}
            />
          </div>
        ))}
      </div>
    );
  }

  if (graphProjection) {
    return (
      <GraphProjectionView
        projection={graphProjection}
        focusPaths={focusPaths}
        variableMarkers={variableMarkers}
        focusedVertexIds={focusedGraphVertexIds}
        memberships={graphMemberships}
        path={path}
        onInspect={onInspect}
      />
    );
  }

  if (projection.kind === "grid") {
    const markers = variableMarkers.flatMap((marker) => {
      const cell = new RegExp(
        `^${escapedPath(path)}\\[(\\d+)\\]\\[(\\d+)\\]$`,
      ).exec(marker.path);
      if (cell) {
        return [{
          marker,
          row: Number(cell[1]),
          column: Number(cell[2]),
          rowBinding: false,
        }];
      }
      const row = new RegExp(`^${escapedPath(path)}\\[(\\d+)\\]$`)
        .exec(marker.path);
      return row
        ? [{
            marker,
            row: Number(row[1]),
            column: 0,
            rowBinding: true,
          }]
        : [];
    });
    const style = {
      "--grid-columns": projection.rows[0]?.length || 1,
    } as CSSProperties;
    return (
      <div
        className={`grid-view ${changed ? "changed" : ""}`}
        data-motion-key={projection.key}
        style={style}
      >
        {markers.map(({ marker, row, column, rowBinding }) => (
          <VariableMarkerLabel
            className={rowBinding ? "grid-row-variable-marker" : ""}
            key={marker.id}
            marker={marker}
            style={{
              left: rowBinding ? 27 : 83 + column * 54,
              top: rowBinding
                ? 51 + row * 54
                : 2 + row * 54,
            }}
          />
        ))}
        {projection.rows.flatMap((row, rowIndex) =>
          row.map((item, columnIndex) => (
            <div
              className={`grid-cell tf-enter ${
                focusPaths.includes(`${path}[${rowIndex}][${columnIndex}]`) ? "focused" : ""
              }`}
              data-projection-path={`${path}[${rowIndex}][${columnIndex}]`}
              data-motion-anchor="container"
              key={item.key}
            >
              <span className="grid-index">
                {rowIndex},{columnIndex}
              </span>
              <ProjectionView
                projection={item}
                depth={depth + 1}
                expanded={false}
                path={`${path}[${rowIndex}][${columnIndex}]`}
                focusPaths={focusPaths}
                variableMarkers={variableMarkers}
                focusedGraphVertexIds={focusedGraphVertexIds}
                graphMemberships={graphMemberships}
                onInspect={onInspect}
              />
            </div>
          )),
        )}
      </div>
    );
  }

  if (projection.kind === "mapping") {
    const markers = variableMarkers.flatMap((marker) => {
      const match = new RegExp(`^${escapedPath(path)}\\{(\\d+)\\}$`)
        .exec(marker.path);
      return match ? [{ marker, index: Number(match[1]) }] : [];
    });
    return (
      <div
        className={`mapping-view ${changed ? "changed" : ""}`}
        data-motion-key={projection.key}
      >
        {projection.entries.map((entry, index) => (
          <div className="mapping-row tf-enter" key={entry.key.key}>
            {markers
              .filter((marker) => marker.index === index)
              .map(({ marker }) => (
                <span
                  aria-label={`${marker.label} at ${marker.path}`}
                  className="variable-row-marker tf-enter"
                  data-variable-path={marker.path}
                  key={marker.id}
                >
                  {marker.label}
                </span>
              ))}
            <div
              className={`mapping-key ${
                focusPaths.includes(`${path}{${index}}.key`) ? "focused" : ""
              }`}
            >
              <ProjectionView
                projection={entry.key}
                depth={depth + 1}
                expanded={false}
                path={`${path}{${index}}.key`}
                focusPaths={focusPaths}
                variableMarkers={variableMarkers}
                focusedGraphVertexIds={focusedGraphVertexIds}
                graphMemberships={graphMemberships}
                onInspect={onInspect}
              />
            </div>
            <div
              className={`mapping-value ${
                focusPaths.includes(`${path}{${index}}.value`) ? "focused" : ""
              }`}
            >
              <ProjectionView
                projection={entry.value}
                depth={depth + 1}
                expanded={false}
                path={`${path}{${index}}.value`}
                focusPaths={focusPaths}
                variableMarkers={variableMarkers}
                focusedGraphVertexIds={focusedGraphVertexIds}
                graphMemberships={graphMemberships}
                onInspect={onInspect}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (projection.kind === "object") {
    if (depth === 0 && !expanded && onInspect) {
      return (
        <button
          className={`object-token ${changed ? "changed" : ""}`}
          data-motion-key={projection.key}
          onClick={() => onInspect(projection)}
          type="button"
        >
          <span>
            <strong>{projection.type}</strong>
            <small>{projection.fields.length} fields</small>
          </span>
        </button>
      );
    }
    return (
      <div className="object-fields" data-motion-key={projection.key}>
        {projection.fields.map((field) => (
          <div className="object-field tf-enter" key={field.name}>
            <span className="field-name">{field.name}</span>
            <ProjectionView
              projection={field.value}
              depth={depth + 1}
              expanded={false}
              path={`${path}.${field.name}`}
              focusPaths={focusPaths}
              variableMarkers={variableMarkers}
              focusedGraphVertexIds={focusedGraphVertexIds}
              graphMemberships={graphMemberships}
              onInspect={onInspect}
            />
          </div>
        ))}
      </div>
    );
  }

  return null;
}

export function ProjectionKindLabel({ projection }: { projection: SceneProjection }) {
  return (
    <span className={`projection-kind kind-${projection.kind}`}>
      <ProjectionIcon kind={projection.kind} />
      {projection.type}
    </span>
  );
}
