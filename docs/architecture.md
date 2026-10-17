# Traceframe Architecture

## Boundary

Traceframe does not identify an entire program as a named algorithm or select one hardcoded
animation. A language adapter records execution facts. The visual compiler turns each runtime
state into a scene using local, composable projection rules.

```text
Language adapter
  -> Trace IR v2
  -> temporal execution-state materializer
  -> semantic lenses
  -> scene compositor and attention
  -> layout and motion
  -> renderer
```

## Run Specification

Algorithm source and invocation are separate inputs. A language-neutral run specification chooses
script execution or identifies a callable plus JSON-compatible positional arguments. The Python
adapter resolves top-level functions and dotted class methods such as `Solution.twoSum`.

Generated invocation code is not appended to the source. The adapter calls the user-defined
function from its harness, so only frames entered in the user source file appear in the trace.
Function returns are serialized directly into Trace IR and projected as `$return`.

### Projection Contracts

Optional versioned projection contracts declare the intended semantic view for a specific runtime
binding and typed access path. A graph contract uses an adjacency-list representation and a
directed flag. Contracts are explicit: nested collections retain structural sequence or grid
projections unless a matching contract selects a graph. Contract targets are resolved through
serialized runtime identity, so aliases of a contracted value share the same graph projection.

Path segments can name an object field, sequence or set index, exact scalar mapping key, or `each`.
`each` selects immediate sequence/set items, mapping values, or object field values; it never selects
mapping keys or follows references. Segments compose, so a path can select each batch and then each
graph value inside its `graphs` field. Empty or non-container matches select no values. Matches are
deduplicated by runtime identity for contract resolution, while every occurrence remains in the
scene projection and can be inspected at its own containment path.

The React renderer recursively composes child projections inside their containing values. It uses
child content to size nested sequence, grid, mapping, object, and graph views, while collapse and
inspect controls let users reduce or open dense subtrees. Explicit graph contracts therefore affect
the actual nested scene wherever their selected values occur; users can inspect an individual value
through the existing detail view and breadcrumbs.

The execution attention workspace keeps all visible structures in a compact context strip and
automatically promotes a bounded set of relevant values to full working views. Runtime reads are
marked as in use, while actual value differences carry their own changed state and summaries. Users
can pin context values into the workspace; pins remain while seeking and reset when a run, example,
or replay starts a new attention session. Object relationship diagrams appear after the workspace,
collapsed by default; expanding one preserves that choice while seeking and a new attention session
collapses it again.

Graph contracts are explicit view settings carried with the run configuration. Editing source does
not clear them; selecting another example or loading a replay replaces them with that example's or
replay's settings. Targets are still resolved against runtime bindings on each frame. A missing path
selects nothing, and a selected value that does not satisfy the adjacency-list contract retains the
existing invalid-contract projection.

Scoped path selection and recursive composition are inspired by Bluefish's declarative selectors and
compositional scene descriptions ([paper](https://vis.mit.edu/pubs/bluefish.pdf), sections 4.2.4 and
5.2.1). Traceframe applies these ideas to runtime projection contracts and nested rendering. It does
not adopt Bluefish's shared-child identity model or constraint ownership system.

### Tagged Inputs

Plain JSON values pass through unchanged. Tagged JSON objects can materialize arbitrary
user-defined runtime values without naming structures such as trees or linked lists:

```json
{
  "$kind": "object",
  "type": "TreeNode",
  "id": "root",
  "fields": {
    "val": 8,
    "left": { "$kind": "reference", "id": "root" }
  }
}
```

- `object` allocates a user-defined type without running its constructor, then recursively assigns
  fields. Optional IDs are allocated before fields, which supports sharing and cycles.
- `reference` reconnects a previously declared ID. Forward references are valid.
- `construct` resolves a callable and supplies recursively materialized `arguments`,
  `keywordArguments`, and optional post-construction `fields`.

Tags describe runtime construction only. They do not select a visualization; once materialized,
the ordinary value serializer and projection compiler handle the resulting identities.

## Trace IR

Trace IR is the canonical replay source of truth. The v2 migration is additive: older replay
frames remain valid, while new adapters may set `irVersion: 2` and attach stronger observational
metadata. Core materializes those observations into versioned execution state before running
semantic lenses.

V2 models active and suspended call activations, parent activation relationships, parameter
bindings, returns, yields, exceptions, structured mutation locations, and producer-consumer
links as facts with stable identities. Generic call, control, dataflow, and attention lenses
consume those facts. Recursion is therefore a property of an activation chain rather than a
separately recognized algorithm.

Every observation may carry an actor ID, actor-local sequence, and causal predecessor IDs.
Python emits one ordered actor today. The same fields let future adapters represent threads,
tasks, workers, channels, or distributed events without changing Scene IR.

Each frame carries:

- Source position and event kind
- Function, call depth, and the complete active user-frame stack
- Serialized locals for active ancestor scopes, allowing identity graphs to remain
  complete while execution descends through recursion
- Serialized local values
- Stable identities for non-scalar values
- Captured output and exceptions
- Structural changes from the preceding frame
- Semantic reads, writes, swaps, comparisons, and branch outcomes
- Active loop contexts with stable iteration identity and structural bindings
- A stable scope identity so recursive and nested calls are diffed independently
- Serialized return values on function-return frames
- Stable exception identities and throw/propagation observations
- Actor-local ordering and explicit happens-after edges

The serialized value algebra contains scalars, sequences, mappings, sets, objects, references,
and truncation markers. It contains no algorithm-specific types.

The Python adapter maps lists, tuples, deques, and ranges into the same bounded sequence value.
Dictionary subclasses remain mappings, and user objects merge `__dict__` with inherited
`__slots__`. These are adapter rules only; queue, range, and slot-backed classes require no new
Scene IR or renderer.

Semantic events are queued by runtime frame identity. A read performed by a caller therefore
cannot be drained into a recursive callee's call frame. Post-call events are recorded only after
the callable returns, preserving Python evaluation order while linking call results to subsequent
writes.

Call arguments are wrapped individually after their original expressions are evaluated. The
wrappers return each value unchanged and associate it with a source-position token; the actual
call still executes in the user frame. The post-call event then carries the callee expression,
argument expressions, serialized argument values, and serialized result.

## Projection Registry

A projection rule matches a local structural shape and emits a renderer-neutral projection. A
rectangular nested sequence is lifted into a grid, while other nested sequences remain sequences
of sequences. Adjacency graphs are emitted only by an explicit projection contract whose neighbor
values resolve to declared vertices.

Rules compose recursively. A mapping may contain grids, objects may contain mappings, and
multiple variables may reference the same identity without requiring combination-specific code.
Projection nodes retain their inspectable child projection, so a graph vertex can contain a map,
that map can contain another graph, and composition continues without a combined renderer.

Object projections are additionally traversed into a relation graph. Runtime identities become
fixed-size nodes and object/reference fields become labeled edges. The same pass handles linked
lists, trees, cycles, and shared references.

Resolved read paths focus the same projection entities used by writes and comparisons. Sequence
indexes focus cells; object-field reads focus relation nodes and their connecting edges. This
keeps operation instrumentation independent from renderer-specific coordinates.

Graph-vertex focus first uses resolved access paths to identify the graph occurrence (and row)
being read. If an operation supplies only scalar values, the compiler matches those values when
there is one distinct graph identity in the scene; with multiple graphs it leaves graph focus
unset rather than highlighting equal labels in unrelated graphs. Multiple bindings to the same
graph identity count as one graph for this fallback.

Bracket resolution follows the serialized runtime value at each segment. Sequence indexes remain
numeric paths, while mapping access resolves the evaluated key to a stable entry slot. Canonical
map slots stay internal; user-facing flow labels reconstruct concrete keys such as
`counts["word"]` rather than exposing entry ordinals.

Within a frame, the scene compiler links read paths and call results to following writes. Swap
sources and targets are paired positionally. These causal links remain path-based Scene IR; the
renderer chooses whether to display them as compact flow labels, motion, or another interaction.
When a call has no explicit assignment but the caller's next snapshot contains structural
changes, argument/read producers and the call are linked to those changed paths. This covers
mutators such as `append`, in-place helpers, and functions that modify passed containers.

Augmented assignments preserve Python's native in-place operation. Only name targets are
instrumented for primitive operations. Attribute, subscript, and slice targets retain native
execution and rely on debugger snapshots and structural diffs, because hidden-temporary rewriting
is not sufficiently exception-safe.

Scalar locals are attached through a live variable-binding graph. Runtime access expressions create
edges such as `index -> nums[index]`, `row -> grid[row]`, and
`column -> grid[row][column]`. Each variable resolves only to the structural depth it controls, so
nested indexes remain independently visible. This works for ordinary reads and arguments as well
as loop bodies.

`for` loops wrap their iterable without changing yielded values, and active control-flow contexts
retain the access bindings used by their body. This keeps those variable bindings visible between
individual reads and allows nested loops to coexist. `while` loops retain the same access metadata,
which supports two-pointer traversal without a named two-pointer rule. Iterator provenance still
connects direct iteration, `enumerate`, mappings, and graph adjacency to their source structures.

Object and reference locals are also compiled into entity bindings on the relation graph. This
lets linked-list pointers and recursive parameters move between stable identity nodes while the
call stack independently represents recursive depth and return flow.

## Semantic Zoom

The execution overview gives the active working set a stable workspace and keeps other values in
a compact context strip. Every composite uses the same levels of detail: a token, a thumbnail, or
the full projection. A generic attention timeline ranks runtime reads, actual value changes, and
their causal inputs; it keeps at most three automatic working views and derives the same result
when the user seeks directly to a frame. Read activity and state changes remain distinct. Users
can pin a view for the current trace, and a pin whose value is no longer present is shown as
unavailable.

Detail opens the selected occurrence with breadcrumb navigation while keeping the containment
path, runtime identity, and trace position synchronized. An inspect control on a nested composite
opens that occurrence in the detail viewport; collapse controls remain available at every level.
Detail selections retain both the rooted containment path and runtime identity: exact paths resolve
the clicked occurrence first, with identity-key lookup as a fallback when a path is no longer
present.

Nested projections remain inspectable in context and detail, with shared runtime identity and
containment paths across aliases. Automatic attention is a presentation policy over execution facts;
it does not use example names or collection-specific roles.

## Replay Files

A replay is a JSON envelope with the `traceframe-replay` format marker, schema version, creation
time, and a complete `ExecutionTrace`. Replays include source, run specification, frames,
serialized values, semantic events, output, and errors. Import validates the full structure
before replacing application state, and playback does not require the Python runtime.

## Runtime Safety

The current Python frontend runs inside a dedicated browser worker and enforces:

- A 90-second cold-start allowance for loading the Python runtime
- A separate 10-second wall-clock limit for user execution
- A 500-frame trace limit
- A 64 MiB Python allocation-growth limit
- A serialization depth limit
- A collection-size limit
- Worker termination after timeout

Frame and memory limits return the partial trace captured before the limit. The memory budget is
checked at Python trace events and measures traced submission allocations rather than total
browser-process resident memory.

This is suitable for a local proof application. A public multi-user deployment must additionally
restrict network access and isolate execution at the origin or server-container boundary.

## Compiler Invariants

1. Runtime locations, map entries, set members, activations, and observations have stable IDs.
2. Ambiguous encodings stay structural. A 2D sequence is a grid, not an adjacency graph, unless
   an explicit contract selects graph semantics.
3. Identity topology is runtime evidence: objects and references may naturally form trees,
   linked lists, cycles, or general relation graphs even when nested inside containers.
4. Semantic lenses request attention; they do not choose renderer coordinates.
5. Motion is matched by stable location or entity identity, never by transient screen position.
6. Nested payloads compose recursively; collapse controls manage dense subtrees without changing
   their semantic projection.
7. Adapter-specific tracing may be replaced or extended, but all languages emit the same Trace
   IR facts before visualization.
