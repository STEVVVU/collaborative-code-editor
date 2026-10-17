# Traceframe

Traceframe is an interactive execution visualizer. It runs Python in a browser worker, records
versioned runtime state, compiles that state through generic projection rules, and synchronizes
the result with editable source code, structured inputs, and timeline controls.

## Run locally

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Verification

```powershell
npm run check
npm test
npm run build
```

## Packages

```text
Python source
  -> Pyodide worker
  -> serialized trace frames
  -> structural state diff
  -> projection registry
  -> visual scene
  -> interactive React renderer
```

- `@traceframe/core` is the renderer- and language-neutral Trace IR, projection compiler,
  replay format, layouts, and topology motion engine.
- `@traceframe/react` renders scenes, semantic zoom, playback controls, and identity-preserving
  transitions. Import `@traceframe/react/styles.css` once in the host application.
- `@traceframe/python` runs and traces Python in an isolated Pyodide worker.
- `@traceframe/playground` is the proof application under `apps/playground`.

The playground accepts a known example id in the `example` query parameter. Open
`/?example=nested-graphs` for nested graph contracts, or `/?example=nested-bfs` for the same
contract with live breadth-first-search distances and queues. Unknown ids use the default example.

See [docs/architecture.md](docs/architecture.md) for the data model and
[docs/api.md](docs/api.md) for embedding examples.

## Current scope

- Editable Python with five structurally different examples
- Script runs and reusable function runs with independently editable JSON arguments
- Top-level function and dotted class-method entrypoints
- Generic tagged object-graph inputs for user-defined classes, sharing, and cycles
- Sandboxed browser execution in a dedicated Web Worker
- Call, line, return, and exception frames
- Complete synchronized call stacks for recursive and nested execution
- Frame-scoped read, call, write, swap, comparison, and branch events
- Evaluated call arguments and results without re-running argument expressions
- Read/call-to-write causal links compiled independently of renderer coordinates
- Caller-visible mutation links for calls that modify containers in place
- Runtime-keyed map focus with readable hash-map access labels
- Single-evaluation augmented-assignment causality for names, attributes, and indexed targets
- Meaningful-frame coalescing and call-scope-aware state diffs
- Lists, structural grids, explicitly contracted adjacency graphs, maps, sets, objects, references,
  scalars, and truncated values
- Deques, ranges, and slot-backed user objects through the same generic projections
- Relation graphs derived from object identity for linked structures and trees
- Topology-aware tree and network layouts for explicitly contracted adjacency sequences and maps
- Source-line highlighting, state diffs, output synchronization, playback, speed, and scrubbing
- A stable execution workspace with compact context views, generic read/change attention, and
  pinning across nested containers
- Token, thumbnail, and full detail levels for nested sequences, grids, mappings, objects, and graphs
- Explicit nested graph views composed alongside their surrounding batches and state
- Direct return-value projection without wrapper assignments or print statements
- Versioned replay files for saving and reopening completed traces
- Bubble sort, grid walk, linked list, binary-tree DFS, and BFS examples

The runtime currently combines source-line tracing with targeted AST instrumentation.
