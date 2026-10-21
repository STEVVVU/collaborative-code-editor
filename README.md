# Collaborative code editor (Traceframe)

Traceframe is an interactive execution visualizer. It runs Python in a browser worker, records
versioned runtime state, compiles that state through generic projection rules, and synchronizes
the result with editable source code, structured inputs, and timeline controls.

Shared debugging notebooks add code co-editing over WebSockets, server-authenticated online editor/viewer
presence, offline drafts in IndexedDB, SQLite persistence, separate editor/viewer links, and comments
anchored to character identities. Presence lists connected sessions and roles; it does not identify people
and is never written to the document or persistent storage.
Python execution remains local and explicit; receiving shared code never starts a run.

![Shared notebook with an anchored code comment and a completed local Python trace](docs/images/shared-notebook.png)

## Run locally

```powershell
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`.

Use Node 24.15 or newer in the 24.x line. The development command builds the packages, starts
the loopback notebook service on port 5190, and proxies it through Vite. Press Ctrl+C to stop
both owned processes. Notebook data is stored in the ignored `.traceframe/notebooks.sqlite`.

## Review code together

1. Open **Shared notebook**, give it a title, and choose **Create notebook from this code**.
2. Copy an editor or viewer link. A link grants its stated access to anyone who possesses it.
3. Editors can change code and run settings. Select code, write a comment, and attach it to the selection.
4. Disconnect the notebook service and keep editing. The local draft survives a normal browser reload;
   reconnecting merges it with the server document. Storage failures appear as errors.
5. Press **Run code** to execute locally, then scrub the trace or save a replay. Remote edits invalidate
   an outdated trace. Projection-only changes keep its frames.

Editor/viewer capabilities are consumed from link fragments and kept in per-tab session storage.
The service stores capability hashes. This is a local capability-based application without accounts
or individual link revocation. Run only code you trust: a browser worker is not a network or resource
security boundary. See [the protocol and limits](docs/notebook-protocol.md) before hosting elsewhere.

The local notebook reuses Traceframe's Yjs browser document and synchronizes source, settings, and comments.
It does not implement the Stanford project's Automerge-based Sublime Text directory synchronization or
filesystem build/grader workflow. See the [original project paper](https://www.scs.stanford.edu/24sp-cs244b/projects/Local-based_collaborative_text_editor_using_CRDT.pdf)
for that distinct system.

The annotation experiment is inspired by [Peritext](https://www.inkandswitch.com/peritext/).
It implements a bounded character-relative comment span policy on Yjs, rather than the full
rich-text algorithm. Its seven named edits compare with fixed integer offsets, then check
disconnected merge convergence and snapshot restoration. The product scope also follows the
complete-application emphasis of [MIT 6.1040](https://61040-fa25.github.io/).

## Verification

```powershell
npm run check
npm test
npm run build
npm run experiment:annotations
npm audit
```

The tests include actual HTTP/WebSocket peers and SQLite restart, as well as deterministic
annotation, storage and client-state checks. The [browser verification skill](.agents/skills/verify-traceframe/SKILL.md)
drives the real Pyodide application, sharing, offline reload, and explicit execution. Unit checks
and rendered browser evidence are recorded separately.

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

- Editable Python with fourteen examples
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
