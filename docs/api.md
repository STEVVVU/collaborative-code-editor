# Public API

## React renderer

```tsx
import { Visualizer } from "@traceframe/react";
import "@traceframe/react/styles.css";

export function TraceView({ scene }) {
  return (
    <Visualizer
      loading={false}
      scene={scene}
      statusText="Ready"
      rendererConfig={{
        motionDurationMs: 420,
        stateTransitionMs: 220,
      }}
    />
  );
}
```

`Visualizer` accepts a renderer-neutral `VisualScene`. `TraceframeProvider` can configure
node dimensions, spacing, motion duration, and a custom `TopologyLayoutRegistry`. Lower-level
exports include `ProjectionView`, `GraphProjectionView`, `RelationGraphView`,
`PlaybackControls`, and the motion hooks. `stateTransitionMs` controls semantic color,
playback-button, and timeline interpolation consistently.

## Scene compiler

```ts
import { compileScene, parseReplay } from "@traceframe/core";

const replay = parseReplay(replayJson);
const scene = compileScene(replay.trace.frames[0]);
```

The core package exports Trace IR types, structural diffing, scene compilation, replay
validation, topology layouts, and deterministic topology transition sampling.

### Nested projection contract selectors

Version 1 graph contracts support exact `field`, `index`, and typed scalar `mapKey` path segments,
plus `each` for one level of contained values:

```ts
const contracts = {
  version: 1,
  declarations: [{
    id: "graphs-in-batches",
    target: {
      root: { kind: "binding", name: "state" },
      segments: [
        { kind: "mapKey", key: { kind: "scalar", type: "str", value: "batches" } },
        { kind: "each" },
        { kind: "mapKey", key: { kind: "scalar", type: "str", value: "graphs" } },
        { kind: "each" },
      ],
    },
    configuration: {
      kind: "graph",
      representation: "adjacency-list",
      directed: false,
    },
  }],
} as const;
```

Each selector expands immediate sequence/set items, mapping values (never keys), or object field
values. It composes with the exact segments and other `each` segments in the same path. It does not
follow references, and a non-container produces no matches. Existing contracts with only exact
segments remain valid. A contract is a view setting attached to the run configuration: editing the
source preserves it, while selecting another example or loading a replay replaces it. Each frame
resolves the target against its current bindings; a missing path selects nothing, and a selected
value that is not a valid adjacency-list graph keeps the existing invalid-contract projection.

The React renderer recursively composes nested projections and sizes parent content from its
children. Collapse and inspect controls keep dense subtrees navigable, and the detail view retains
breadcrumb navigation. Object-identity relationship diagrams follow the attention workspace and
start collapsed; users can expand them when needed. Their expanded state survives timeline seeking
and resets when a new run session begins. This composition is inspired by Bluefish's selector and scene-composition
ideas ([paper](https://vis.mit.edu/pubs/bluefish.pdf); sections 4.2.4 and 5.2.1). Traceframe does not
adopt Bluefish's shared-child identity model or constraint ownership system.

### Execution attention

`compileAttentionTimeline(trace, options?)` derives one renderer-neutral attention snapshot per
playback step. Pass the existing `executionTimeline` when available to reuse materialized execution
state, and pass `projectionContracts` when the viewer has changed view contracts interactively. The
snapshot index is the playback step index, including traces with debugger steps that do not map
one-to-one to raw state frames.

Each snapshot contains candidate views with stable identity, containment path, aliases, projection
kind, and an activity of `changed`, `used`, `context`, or `idle`. Actual value changes remain
separate in the `changes` field. `workingIds` identifies the bounded automatic working set; the
renderer can show remaining values as compact context and let users pin views independently.
Attention is derived from runtime locations and causal facts, so the same policy applies to nested
maps, lists, grids, objects, and explicitly contracted graphs.

## Python adapter

```ts
import { PythonExecutor } from "@traceframe/python";

const executor = new PythonExecutor((status) => console.log(status));
const trace = await executor.run(source, {
  mode: "function",
  entrypoint: "solve",
  arguments: [[3, 1, 2]],
});
executor.dispose();
```

Each executor owns a worker. Call `dispose()` when its host unmounts. Production deployments
must host or restrict the Python runtime according to their execution-isolation requirements.
