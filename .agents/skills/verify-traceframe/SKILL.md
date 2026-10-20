---
name: verify-traceframe
description: Launch the real Traceframe UI, drive Python execution and collaboration through the supported CUA browser, retain evidence, and stop only task-owned processes.
---

# Verify Traceframe

## Launch

From the repository root, use supported Node 24 and `npm ci`, then `npm run build:packages`. Create `.audit/verification` if absent. Start an owned terminal with:

```powershell
node tools/verify-traceframe-server.mjs .audit/verification/baseline-001 5175
```

Choose a fresh evidence directory and unused loopback port. This helper starts the real Vite app using the current Node executable, avoiding npm argument forwarding. Keep the terminal session handle for cleanup. Never attach verification to the user's existing session. The helper rejects an occupied port.

## Doctor

Read `launch.json` and the helper output. `doctor` must be true and the child must remain alive. The helper checks the actual app HTML on its owned port. Open that URL in a new background CUA browser tab. Wait for **Run code**, which indicates the initial real Pyodide trace completed. Python and Monaco may load public CDN assets on first use. A permanently loading runtime is a failed precondition, not a pass.

## Drive

In `mcp__cua_repl`, import the maintained module and pass the supported CUA tab:

```javascript
var traceDriver = await import('file:///C:/Users/steve/Projects/traceframe/tools/verify-traceframe-browser.mjs');
await traceDriver.driveExecutionBaseline(tab, 'C:/Users/steve/Projects/traceframe/.audit/verification/baseline-001');
```

Resolve those absolute paths against the actual checkout on another machine. The driver uses only supported CUA browser actions, modifies the example's public input form, runs actual Python, selects the final frame, and checks the rendered sorted result. It does not inject application state, intercept requests, or fake a trace.

Read [features/README.md](features/README.md) for mapped journeys. Keep unit, types, build, API and rendered behavior evidence distinct. After interface changes, inspect desktop and narrow screenshots with the real content and restore temporary viewport overrides.

## Evidence

The directory retains `launch.json`, `server.log`, `browser-actions.json`, `browser-result.json`, `execution.png`, and `server-result.json`. Browser success requires `passed: true` and the expected final values. Runtime state and capabilities belong only in ignored storage. Never commit access tokens, private notebook contents or local databases.

## Cleanup

Send Ctrl+C to the owned launch terminal. The helper stops its captured child and records `cleanup: true` after checking that its listener is unavailable. Confirm the process/session finished, then inspect `server-result.json`. Close the temporary verification tab unless it is a requested deliverable. Verify that the screenshot and action/result files still exist after cleanup.

## Helpers

`tools/verify-traceframe-server.mjs` handles Launch, Doctor, and Cleanup. `tools/verify-traceframe-browser.mjs` handles browser Drive and Evidence. Run existing `npm run check`, `npm test`, and `npm run build` separately. A mapped journey without a completed drive remains unverified.
