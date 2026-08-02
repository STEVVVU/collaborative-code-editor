# @traceframe/python

Browser-isolated Python debugger adapter for Traceframe.

```ts
import { PyodideDebuggerAdapter } from "@traceframe/python";

const adapter = new PyodideDebuggerAdapter();
const trace = await adapter.execute({ source, runSpec });
adapter.dispose();
```

The emitted trace uses `@traceframe/core` contracts and can be rendered by any compatible
frontend. The adapter loads Pyodide in a dedicated worker and implements the core
`DebuggerAdapter` interface. Python's standard `bdb` framework owns debugger event
dispatch, lifecycle, and stack construction. Traceframe adds bounded state recording
and optional semantic events for visualization.

Execution defaults to a 500-frame visualization budget, a 10-second algorithm
preflight, a 30-second debugger-recording budget, and 64 MiB of Python allocation
growth. Separating preflight from recording prevents debugger overhead from being
reported as a slow solution. Every debugger `call`, `line`, `return`, and `exception`
event is retained as a lightweight playback step. Heavy variable snapshots are
sampled across longer executions instead of terminating the program when the frame
budget fills. The returned trace reports `eventsObserved` and `samplingStride` when
consumers need to identify snapshot compaction.

The snapshot budget applies to ordinary line history. Scope lifecycle snapshots are
retained separately so each function call keeps its own arguments and cannot borrow
visual state from a generator, caller, or sibling frame.
Defaults can be configured on the adapter:

```ts
const adapter = new PyodideDebuggerAdapter({
  snapshotBudget: 1_000,
  executionTimeoutMs: 2_000,
  visualizationTimeoutMs: 10_000,
  memoryLimitBytes: 128 * 1024 * 1024,
});
```

An LC-style problem can override all three limits for one run:

```ts
const trace = await adapter.execute({
  source,
  runSpec,
  limits: {
    snapshotBudget: 1_000,
    executionTimeoutMs: 2_000,
    visualizationTimeoutMs: 10_000,
    memoryLimitBytes: 128 * 1024 * 1024,
  },
});
```

`PythonExecutor` and its `run()` method remain compatibility aliases.

The memory budget is checked at Python trace events and preserves frames captured before the
limit is reached. It measures traced Python allocations, not the Pyodide runtime's baseline or
the browser process's complete resident memory.
