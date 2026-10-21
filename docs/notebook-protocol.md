# Shared debugging notebooks

The notebook is one Yjs document. `source` is a Y.Text. `settings` is a Y.Map of strings: `title`, `mode` (`function` or `script`), `entrypoint`, `argumentsText`, and `projectionContracts` (JSON, or an empty string). `annotations` is a Y.Array of immutable objects with `id`, `text`, `quote`, `start`, `end`, `author`, and `createdAt`, all strings. Positions are base64-encoded Yjs relative positions. Unknown roots or fields are rejected.

Source limit: 65,536 characters; title: 120; entrypoint: 200; arguments and projection contracts: 16,384 each; 100 annotations with 2,000-character text, 4,000-character quote, 300-character author, 500-character positions, 100-character ID/date. Encoded document limit: 1 MiB. WebSocket frame limit: 1.5 MiB. These are product budgets, not claims about Yjs scalability.

## Transport and persistence

- `POST /api/notebooks` accepts `{title, source, settings: {mode, entrypoint, argumentsText, projectionContracts}}`. Returns `{id, editToken, viewToken, state, revision}`. `state` is the base64 full Yjs update. Creation generates opaque capabilities; only their hashes are stored.
- `POST /api/notebooks/:id/open` accepts a Bearer capability header. Returns `{id, role, state, revision}`. Role is `edit` or `view`.
- `/api/notebooks/:id/live` is a WebSocket. The first message, within five seconds, is `{type:"auth", token}`. Tokens never appear in query strings. Browser Origins must match the configured allowlist; CLI clients without Origin are allowed for local verification.
- The server sends `{type:"state", state, revision, role}` after authentication. Editors send `{type:"update", updateId, state}` with a full state. Merge into a candidate document, validate it, persist in SQLite, then broadcast the committed state. The sender's response includes `ack: updateId`; other peers receive no ack. Duplicate states are acknowledged without increasing the revision. A viewer update is rejected without modifying persistence. Errors are `{type:"error", message}` and never echo payloads or capabilities.
- After authentication and on each room membership change, the server sends `{type:"presence", sessions:[{sessionId, role}]}` to authenticated peers. Session IDs are server-generated and exist only for a live connection; presence is not a Yjs root and is never persisted. It represents connected sessions, not verified people. Document revisions do not change when presence changes.
- Validate JSON, base64, Yjs schema, budgets and capabilities at the boundary. A failed update must leave the live and persisted document unchanged. `GET /health` returns `{ok:true}`.

The backend exports `createNotebookServer({port, dbPath, allowedOrigins})`, returning `{port, url, close}`. Tests use a fresh database and port zero. CLI binds loopback, defaults to port 5190 and `.traceframe/notebooks.sqlite`; `PORT`, `NOTEBOOK_DB`, and comma-separated `NOTEBOOK_ORIGINS` override these. Default origins are `http://127.0.0.1:5173` and `http://localhost:5173`.

## Client invariants

Use y-monaco for incremental source binding and the project-owned IndexedDB append journal for local updates. The adapter resolves writes only after transaction commit and surfaces storage errors. Incoming code never runs automatically. Run settings use Y.Map's last-writer merge semantics. Editor capabilities permit changes; viewer capabilities permit reading and local execution only. Show connection, pending-save, saved and error states. Only the acknowledgement for the newest local update can mark the notebook saved. Reconnection sends the full local state, including deletion history. Dispose connections, retry timers and storage providers when leaving a notebook, and ignore stale responses.

Links carry capabilities in the fragment. Consume and remove the fragment before rendering; retain it in per-tab session storage for reload. IndexedDB stores a notebook only after successful capability authentication. Offline edits are allowed only for a previously authenticated editor. Capability possession grants access; this first version does not identify people or revoke individual links. Presence is cleared locally when a socket closes and rebuilt from the authenticated room after reconnect. Use a trusted local deployment, not an unauthenticated public service.

## Annotation experiment

Inspired by [Peritext](https://www.inkandswitch.com/peritext/), comments attach to character identities instead of integer offsets. A start with association 0 follows the original first character; an end with association -1 follows the original last character. Inserts outside the selection remain outside; inserts inside remain inside. Keep the original quote so changed/deleted spans are visible. Do not guess a new anchor after deletion. This is an annotation mechanism built on Yjs, not a Peritext implementation.

Editors can remove comments. Local creation stops at 100, and removal also lets peers recover when concurrent offline additions exceed the server budget. Deleted comments remain in CRDT history; removal is not secure erasure.

`node tools/annotation-experiment.mjs .audit/annotation-experiment` checks seven named edits, disconnected merge convergence and snapshot restoration against fixed integer offsets. The fixed-offset baseline has no operational transformation. These cases test a boundary policy; they are not a performance or language-quality benchmark.

## Dependency decisions and limits

Yjs 13.6.33 and y-monaco 0.1.6 provide the text CRDT and editor binding. Both are MIT-licensed. ws 8.22.0 provides WebSockets. Monaco is pinned to the same 0.52.2 version used by the editor loader; React and React DOM share one pinned version across workspace peers. The large Monaco binding chunk loads only when joining a notebook.

The initial y-indexeddb adapter was replaced after reproducing a denied-storage failure: its `whenSynced` promise remained pending and the database-open rejection escaped. The maintained adapter uses the same `updates` and `custom` store schema, handles open/transaction errors, and appends rather than overwrites peer updates. Browser storage can still be cleared or exhausted. The local journal does not compact itself in this version.

The server validates Yjs root shapes and deferred updates using internals of the pinned version; the adversarial tests must pass before upgrading Yjs. A 1 MiB full-state limit includes deletion history, so a long-lived notebook can exhaust the budget even after deleting content. Preserve source and open a new notebook in that case. This service uses a single local process and SQLite. It does not provide account identity, per-person revocation, rate limiting for public hosting, remote execution or live cursors.
