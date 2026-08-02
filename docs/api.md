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
