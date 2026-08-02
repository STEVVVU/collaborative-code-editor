# @traceframe/core

Renderer-neutral debugger, trace, and visualization primitives for Traceframe.

```ts
import {
  debuggerStepCount,
  materializeDebuggerStep,
  type DebuggerAdapter,
} from "@traceframe/core";

const trace = await adapter.execute({ source, runSpec });
const frame = materializeDebuggerStep(trace, index);
const total = debuggerStepCount(trace);
```

`DebuggerAdapter` is the language-neutral execution boundary. An adapter emits exact,
lightweight debugger steps and independently bounded state snapshots. Renderers consume
the normalized recording without depending on a language runtime.

Language packages own their debugger implementation and transport. For example, Python
can use `bdb` or debugpy, JavaScript can use CDP, and remote runtimes can bridge DAP.
Those backends normalize their events before they reach core or React.

The package also includes structural diffs, projection compilation, replay validation,
topology layout, and deterministic topology motion. It has no DOM or React dependency.
