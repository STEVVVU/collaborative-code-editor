import { List, Network, Pin, PinOff, ScanText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AttentionSnapshot, AttentionView, SceneProjection, SerializedValue, VisualScene } from "@traceframe/core";
import { indexAttentionViews } from "@traceframe/core";
import { ProjectionKindLabel, ProjectionView } from "./ProjectionView";
import { ProjectionPreview } from "./ProjectionPreview";

type AttentionLevel = "token" | "thumbnail" | "full";

function changeSummary(view: AttentionView): string {
  const compactValue = (value: SerializedValue | undefined): string => {
    if (!value) return "?";
    if (value.kind === "scalar") {
      const text = value.value === null ? "null" : typeof value.value === "string" ? JSON.stringify(value.value) : String(value.value);
      return text.length > 28 ? `${text.slice(0, 25)}…` : text;
    }
    if (value.kind === "sequence" || value.kind === "set") return `${value.type}[${value.items.length}]`;
    if (value.kind === "mapping") return `${value.type}{${value.entries.length}}`;
    if (value.kind === "object") return `${value.type}{${Object.keys(value.fields).length}}`;
    if (value.kind === "reference") return `→ ${value.targetId}`;
    return value.preview.slice(0, 24);
  };
  const changes = view.changes.slice(0, 2).map((change) => {
    const path = change.path.length > 32 ? `${change.path.slice(0, 29)}…` : change.path;
    if (change.kind === "created") return `created ${path}: ${compactValue(change.after)}`;
    if (change.kind === "removed") return `removed ${path}: ${compactValue(change.before)}`;
    return `updated ${path}: ${compactValue(change.before)} → ${compactValue(change.after)}`;
  });
  return changes.length ? changes.join(" · ") : "Value changed";
}

const ROOT_BINDING = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function workingAliases(view: AttentionView): string[] {
  return [...new Set(view.aliases)].filter((alias) =>
    ROOT_BINDING.test(alias) && alias !== view.path && alias !== view.label,
  );
}

function workingTitle(view: AttentionView): string {
  const aliases = workingAliases(view);
  return [view.path, ...(aliases.length > 0 ? [`aliases: ${aliases.join(", ")}`] : [])].join(" · ");
}

export interface AttentionWorkspaceProps {
  scene: VisualScene;
  attention: AttentionSnapshot;
  sessionId: string | number;
  onInspect: (projection: SceneProjection, path?: string) => void;
  onProjectionViewChange?: (variableName: string, mode: "structural" | "graph", directed?: boolean) => void;
}

/** Compact context previews paired with a stable, bounded set of full working views. */
export function AttentionWorkspace({ scene, attention, sessionId, onInspect, onProjectionViewChange }: AttentionWorkspaceProps) {
  const [pins, setPins] = useState<string[]>([]);
  const [pinLabels, setPinLabels] = useState<Record<string, string>>({});
  const [levels, setLevels] = useState<Record<string, AttentionLevel>>({});
  useEffect(() => {
    setPins([]);
    setPinLabels({});
    setLevels({});
  }, [sessionId]);

  const projectionById = useMemo(
    () => new Map(indexAttentionViews(scene.variables).map(({ id, projection }) => [id, projection])),
    [scene.variables],
  );
  const viewsById = useMemo(() => new Map(attention.views.map((view) => [view.id, view])), [attention.views]);
  const defaultContextLevel = (view: AttentionView): "token" | "thumbnail" => {
    if (view.activity === "used" || view.activity === "changed") return "thumbnail";
    return attention.views.some((candidate) => candidate.id !== view.id &&
      candidate.path.startsWith(view.path) && ".[{".includes(candidate.path.charAt(view.path.length)))
      ? "token"
      : "thumbnail";
  };
  const automatic = attention.workingIds.filter((id) => viewsById.has(id));
  const workspaceIds = [...new Set([...automatic, ...pins])];
  const togglePin = (view: AttentionView) => {
    const alreadyPinned = pins.includes(view.id);
    setPins((current) => alreadyPinned ? current.filter((id) => id !== view.id) : [...current, view.id]);
    setPinLabels((current) => {
      const next = { ...current };
      if (alreadyPinned) delete next[view.id];
      else next[view.id] = view.label;
      return next;
    });
  };

  return (
    <div className="attention-workspace" aria-label="Execution attention">
      <section className="attention-context" aria-label="Context values">
        <header className="attention-section-heading">
          <div><span className="panel-kicker">CONTEXT</span><span>Values in scope</span></div>
          <small>{attention.views.length} structures</small>
        </header>
        <div className="attention-context-scroll">
          {attention.views.map((view) => {
            const projection = projectionById.get(view.id);
            const level = defaultContextLevel(view);
            return (
              <article className={`attention-context-card activity-${view.activity} ${level === "token" ? "is-token" : ""}`} key={view.id} data-attention-id={view.id}>
                <div className="attention-card-heading"><strong title={view.path}>{view.label}</strong><span>{view.kind}</span></div>
                {projection ? <ProjectionPreview projection={projection} level={level} /> : <span className="attention-preview-token">Unavailable at this step</span>}
                <div className="attention-card-actions">
                  <button aria-label={`Inspect ${view.label}`} onClick={() => projection && onInspect(projection, view.path)} disabled={!projection} type="button"><ScanText size={12} aria-hidden="true" />Inspect</button>
                  <button aria-label={`${pins.includes(view.id) ? "Unpin" : "Pin"} ${view.label}`} aria-pressed={pins.includes(view.id)} onClick={() => togglePin(view)} type="button">{pins.includes(view.id) ? <PinOff size={12} aria-hidden="true" /> : <Pin size={12} aria-hidden="true" />}{pins.includes(view.id) ? "Pinned" : "Pin"}</button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="attention-working" aria-label="Working state">
        <header className="attention-section-heading">
          <div><span className="panel-kicker">WORKING STATE</span><span>Values in view</span></div>
          <small>{workspaceIds.length} values</small>
        </header>
        {workspaceIds.length === 0 ? <p className="attention-empty">No structures are active at this step. Pin a context value to keep it in view.</p> : (
          <div className="attention-working-grid">
            {workspaceIds.map((id) => {
              const view = viewsById.get(id);
              const projection = projectionById.get(id);
              const pinned = pins.includes(id);
              if (!view || !projection) {
                const missingLabel = view?.label ?? pinLabels[id] ?? "value";
                return <article className="attention-working-card attention-missing" key={id} data-attention-id={id}>
                  <strong>{missingLabel}</strong><span>Not in scope at this step</span>
                  <button aria-label={`Unpin ${missingLabel}`} onClick={() => { setPins((current) => current.filter((item) => item !== id)); setPinLabels((current) => { const next = { ...current }; delete next[id]; return next; }); }} type="button"><PinOff size={12} aria-hidden="true" />Unpin</button>
                </article>;
              }
              const level = levels[id] ?? "full";
              const aliases = workingAliases(view);
              const aliasText = aliases.slice(0, 2).join(", ");
              const title = workingTitle(view);
              const sourceVariable = scene.variables.find(({ name }) => name === view.path);
              const canSwitchProjection = sourceVariable !== undefined && (projection.kind === "graph" || Boolean(sourceVariable.graphFacet));
              return <article className={`attention-working-card activity-${view.activity}`} key={id} data-attention-id={id} data-attention-level={level}>
                <header className="attention-working-heading">
                  <div><strong title={title}>{view.label}</strong>{aliasText && <span className="attention-working-aliases" title={title}>= {aliasText}</span>}{pinned && <span className="attention-pinned">Pinned</span>}{view.activity === "changed" && <span className="attention-changed" aria-label="Changed">Changed</span>}{view.activity === "used" && <span className="attention-used">In use</span>}</div>
                  <ProjectionKindLabel projection={projection} />
                </header>
                {view.activity === "changed" && view.changes.length > 0 && <div className="attention-change-summary">{changeSummary(view)}</div>}
                {onProjectionViewChange && canSwitchProjection && <button className="attention-view-kind" aria-label={projection.kind === "graph" ? `View ${view.label} structurally` : `View ${view.label} as a graph`} onClick={() => onProjectionViewChange(view.path, projection.kind === "graph" ? "structural" : "graph", sourceVariable?.graphFacet?.directed)} type="button">{projection.kind === "graph" ? <List size={12} aria-hidden="true" /> : <Network size={12} aria-hidden="true" />}{projection.kind === "graph" ? "Structure" : "Graph"}</button>}
                {level === "token" ? <ProjectionPreview projection={projection} level="token" /> : level === "thumbnail" ? <ProjectionPreview projection={projection} /> : <div className="attention-full-view"><ProjectionView projection={projection} path={view.path} changed={view.activity === "changed"} focusPaths={scene.focusPaths} variableMarkers={scene.variableMarkers} focusedGraphVertexIds={scene.focusedGraphVertexIds} graphMemberships={scene.graphMemberships} onInspect={onInspect} childPresentation="thumbnail" /></div>}
                <div className="attention-working-actions">
                  <label>Level <select aria-label={`Working view level for ${view.label}`} value={level} onChange={(event) => setLevels((current) => ({ ...current, [id]: event.target.value as AttentionLevel }))}><option value="token">Token</option><option value="thumbnail">Thumbnail</option><option value="full">Full</option></select></label>
                  <button aria-label={`${pinned ? "Unpin" : "Pin"} ${view.label}`} aria-pressed={pinned} onClick={() => togglePin(view)} type="button">{pinned ? <PinOff size={12} aria-hidden="true" /> : <Pin size={12} aria-hidden="true" />}{pinned ? "Unpin" : "Pin"}</button>
                </div>
              </article>;
            })}
          </div>
        )}
      </section>
    </div>
  );
}
