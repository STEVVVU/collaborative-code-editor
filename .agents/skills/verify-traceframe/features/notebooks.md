# Shared notebooks

Launch the owned verifier and open three fresh CUA tabs on its base URL. Wait for the standalone Python examples to complete. First run `driveExecutionBaseline(owner, evidence)` from the execution module.

Import `tools/verify-notebook-browser.mjs` in CUA. Run:

```javascript
await notebookDriver.createNotebookPeers(owner, peer, viewer, evidence);
await notebookDriver.editNotebookPeers(owner, peer, viewer, evidence);
```

Creation uses real form controls, source selection, and the browser clipboard. It consumes editor/viewer links inside the driver and never saves their keys. Assert viewer input controls are disabled and joining a changed program clears the trace without executing it.

Send `offline` and a newline to the owned verifier's terminal. Wait for its recorded offline transition, then run:

```javascript
await notebookDriver.editAndReloadOffline(owner, peer, evidence);
```

Both peers edit, reload from IndexedDB, and remain idle. Send `online` and a newline to the verifier. It restarts the API against the same SQLite file. Then run:

```javascript
await notebookDriver.verifyNotebookReconnection(owner, peer, viewer, evidence);
```

All peers must contain both offline prefixes. The viewer explicitly runs actual Python; the final rendered result must be sorted and replay export enabled. Retain all stage JSON files/screenshots and the server transition log after cleanup.

For projection behavior, open a fresh tab with `?example=bfs`, wait for its trace, create a shared notebook, and pin **graph**. Run `driveProjectionSwitch(tab, evidence)`; its frame count and replay control must survive the graph/structure change.

The source editor uses Monaco's EditContext surface. Click the visible `.monaco-editor`, then use the supported tab keyboard/type APIs; its zero-width native textbox cannot receive locator clicks. Read rendered `.view-line` content in vertical order because Monaco reuses line DOM nodes. Request full AX snapshots for assertions, since a diff can omit unchanged roles.
