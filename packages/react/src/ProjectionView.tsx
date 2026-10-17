import {
  Boxes,
  Braces,
  ChevronDown,
  ChevronRight,
  Grid3X3,
  List,
  Network,
  ScanText,
} from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type {
  GraphMembership,
  VariableMarker,
  SceneProjection,
} from "@traceframe/core";
import { GraphProjectionView } from "./GraphProjectionView";
import { ProjectionPreview } from "./ProjectionPreview";
import { useTraceframeRendererConfig } from "./TraceframeProvider";

export interface ProjectionViewProps {
  projection: SceneProjection;
  changed?: boolean;
  depth?: number;
  /** Retained for compatibility with hosts that open a projection in detail view. */
  expanded?: boolean;
  path?: string;
  focusPaths?: readonly string[];
  variableMarkers?: readonly VariableMarker[];
  focusedGraphVertexIds?: readonly string[];
  graphMemberships?: readonly GraphMembership[];
  onInspect?: (projection: SceneProjection, path?: string) => void;
  presentation?: "full" | "thumbnail";
  childPresentation?: "full" | "thumbnail";
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
      return `${projection.items.length} items`;
    case "grid":
      return `${projection.rows.length} × ${projection.rows[0]?.length ?? 0}`;
    case "graph":
      return `${projection.vertices.length} vertices`;
    case "mapping":
      return `${projection.entries.length} entries`;
    case "object":
      return `${projection.fields.length} fields`;
    default:
      return "";
  }
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

function ProjectionShell({
  projection,
  path,
  collapsed,
  focused,
  onToggle,
  onInspect,
  children,
}: {
  projection: SceneProjection;
  path: string;
  collapsed: boolean;
  focused: boolean;
  onToggle: () => void;
  onInspect?: (projection: SceneProjection, path?: string) => void;
  children: ReactNode;
}) {
  const description = `${projection.label}: ${projection.type}, ${nestedSummary(projection)}`;
  return (
    <section
      aria-label={description}
      className={`projection-shell kind-${projection.kind} ${
        collapsed ? "collapsed" : ""
      } ${focused ? "focused" : ""}`}
      data-motion-key={projection.key}
      data-motion-anchor="container"
      data-projection-path={path}
    >
      <header className="projection-shell-header">
        <button
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${projection.label}`}
          className="projection-shell-toggle"
          onClick={onToggle}
          type="button"
        >
          {collapsed ? (
            <ChevronRight size={13} aria-hidden="true" />
          ) : (
            <ChevronDown size={13} aria-hidden="true" />
          )}
          <ProjectionIcon kind={projection.kind} />
          <span className="projection-shell-label">{projection.label}</span>
          <span className="projection-shell-type">{projection.type}</span>
          <span className="projection-shell-summary">{nestedSummary(projection)}</span>
        </button>
        {onInspect && (
          <button
            aria-label={`Open details for ${projection.label}`}
            className="projection-shell-inspect"
            onClick={() => onInspect(projection, path)}
            title={`Open details for ${projection.label}`}
            type="button"
          >
            <ScanText size={13} aria-hidden="true" />
          </button>
        )}
      </header>
      {!collapsed && <div className="projection-shell-content">{children}</div>}
    </section>
  );
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
  presentation = "full",
  childPresentation = "full",
}: ProjectionViewProps) {
  const rendererConfig = useTraceframeRendererConfig();
  const [collapseState, setCollapseState] = useState({
    key: projection.key,
    collapsed: false,
  });
  const collapsed =
    collapseState.key === projection.key && collapseState.collapsed;
  const [retainedGraph, setRetainedGraph] = useState(
    projection.kind === "graph" ? projection : undefined,
  );
  useEffect(() => {
    if (projection.kind === "graph") {
      setRetainedGraph(projection);
      return;
    }
    if (!retainedGraph) return;
    const timeout = window.setTimeout(
      () => setRetainedGraph(undefined),
      rendererConfig.motionDurationMs,
    );
    return () => window.clearTimeout(timeout);
  }, [projection, rendererConfig.motionDurationMs, retainedGraph]);
  const focused = focusPaths.includes(path);
  if (presentation === "thumbnail" && projection.kind !== "scalar" && projection.kind !== "reference" && projection.kind !== "truncated") {
    return <ProjectionPreview projection={projection} onInspect={onInspect} path={path} />;
  }
  const graphProjection =
    projection.kind === "graph"
      ? projection
      : retainedGraph
        ? { ...retainedGraph, edges: [], vertices: [] }
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

  const container = (body: ReactNode) => (
    <ProjectionShell
      projection={projection}
      path={path}
      collapsed={collapsed}
      focused={focused}
      onToggle={() =>
        setCollapseState({ key: projection.key, collapsed: !collapsed })
      }
      onInspect={onInspect}
    >
      {body}
    </ProjectionShell>
  );

  if (projection.kind === "sequence") {
    const markers = variableMarkers.flatMap((marker) => {
      const match = new RegExp(`^${escapedPath(path)}\\[(\\d+)\\]$`)
        .exec(marker.path);
      return match ? [{ marker, index: Number(match[1]) }] : [];
    });
    const sequenceStyle = {
      "--sequence-count": Math.max(projection.items.length, 1),
    } as CSSProperties;
    return container(
      <div
        className={`sequence-view ${changed ? "changed" : ""}`}
        style={sequenceStyle}
      >
        {markers.map(({ marker, index }) => (
          <VariableMarkerLabel
            key={marker.id}
            marker={marker}
            style={{ gridColumn: index + 1, gridRow: 1, left: "50%", top: 2 }}
          />
        ))}
        {projection.items.map((item, index) => (
          <div
            className={`sequence-cell tf-enter ${focusPaths.includes(`${path}[${index}]`) ? "focused" : ""}`}
            data-projection-path={`${path}[${index}]`}
            data-motion-anchor="container"
            style={{ gridColumn: index + 1, gridRow: 2 }}
            key={item.key}
          >
            <span className="cell-index">{index}</span>
            <ProjectionView
              projection={item}
              depth={depth + 1}
              path={`${path}[${index}]`}
              focusPaths={focusPaths}
              variableMarkers={variableMarkers}
              focusedGraphVertexIds={focusedGraphVertexIds}
              graphMemberships={graphMemberships}
              onInspect={onInspect}
              presentation={childPresentation}
              childPresentation={childPresentation}
            />
          </div>
        ))}
      </div>,
    );
  }

  if (graphProjection) {
    return container(
      <GraphProjectionView
        projection={graphProjection}
        focusPaths={focusPaths}
        variableMarkers={variableMarkers}
        focusedVertexIds={focusedGraphVertexIds}
        memberships={graphMemberships}
        path={path}
        onInspect={onInspect}
        embedded
      />,
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
    return container(
      <div
        className={`grid-view ${changed ? "changed" : ""}`}
        style={style}
      >
        {markers.map(({ marker, row, column, rowBinding }) => (
          <VariableMarkerLabel
            className={rowBinding ? "grid-row-variable-marker" : ""}
            key={marker.id}
            marker={marker}
            style={{
              gridColumn: column + 1,
              gridRow: row + 1,
              left: rowBinding ? -31 : "50%",
              top: rowBinding ? "50%" : 2,
            }}
          />
        ))}
        {projection.rows.flatMap((row, rowIndex) =>
          row.map((item, columnIndex) => (
            <div
              className={`grid-cell tf-enter ${
                focusPaths.includes(`${path}[${rowIndex}][${columnIndex}]`)
                  ? "focused"
                  : ""
              }`}
              data-projection-path={`${path}[${rowIndex}][${columnIndex}]`}
              data-motion-anchor="container"
              style={{
                gridColumn: columnIndex + 1,
                gridRow: rowIndex + 1,
              }}
              key={item.key}
            >
              <span className="grid-index">
                {rowIndex},{columnIndex}
              </span>
              <ProjectionView
                projection={item}
                depth={depth + 1}
                path={`${path}[${rowIndex}][${columnIndex}]`}
                focusPaths={focusPaths}
                variableMarkers={variableMarkers}
                focusedGraphVertexIds={focusedGraphVertexIds}
                graphMemberships={graphMemberships}
                onInspect={onInspect}
                presentation={childPresentation}
                childPresentation={childPresentation}
              />
            </div>
          )),
        )}
      </div>,
    );
  }

  if (projection.kind === "mapping") {
    const markers = variableMarkers.flatMap((marker) => {
      const match = new RegExp(`^${escapedPath(path)}\\{(\\d+)\\}$`)
        .exec(marker.path);
      return match ? [{ marker, index: Number(match[1]) }] : [];
    });
    return container(
      <div className={`mapping-view ${changed ? "changed" : ""}`}>
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
            <div className={`mapping-key ${focusPaths.includes(`${path}{${index}}.key`) ? "focused" : ""}`}>
              <ProjectionView
                projection={entry.key}
                depth={depth + 1}
                path={`${path}{${index}}.key`}
                focusPaths={focusPaths}
                variableMarkers={variableMarkers}
                focusedGraphVertexIds={focusedGraphVertexIds}
                graphMemberships={graphMemberships}
                onInspect={onInspect}
                presentation={childPresentation}
                childPresentation={childPresentation}
              />
            </div>
            <div className={`mapping-value ${focusPaths.includes(`${path}{${index}}.value`) ? "focused" : ""}`}>
              <ProjectionView
                projection={entry.value}
                depth={depth + 1}
                path={`${path}{${index}}.value`}
                focusPaths={focusPaths}
                variableMarkers={variableMarkers}
                focusedGraphVertexIds={focusedGraphVertexIds}
                graphMemberships={graphMemberships}
                onInspect={onInspect}
                presentation={childPresentation}
                childPresentation={childPresentation}
              />
            </div>
          </div>
        ))}
      </div>,
    );
  }

  if (projection.kind === "object") {
    return container(
      <div className="object-fields">
        {projection.fields.map((field) => (
          <div className="object-field tf-enter" key={field.name}>
            <span className="field-name">{field.name}</span>
            <ProjectionView
              projection={field.value}
              depth={depth + 1}
              path={`${path}.${field.name}`}
              focusPaths={focusPaths}
              variableMarkers={variableMarkers}
              focusedGraphVertexIds={focusedGraphVertexIds}
              graphMemberships={graphMemberships}
              onInspect={onInspect}
              presentation={childPresentation}
              childPresentation={childPresentation}
            />
          </div>
        ))}
      </div>,
    );
  }
  // `expanded` remains a supported host prop; recursive inline rendering is now the default.
  void expanded;
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
