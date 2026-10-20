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

Choose a fresh evidence directory and unused loopback port. This helper starts the real Vite app and a notebook API on that port plus 20 using the current Node executable. It keeps SQLite state in the ignored evidence directory and configures the proxy and allowed Origin. Keep the terminal session handle for cleanup. Never attach verification to the user's existing session. The helper rejects an occupied port.

## Doctor

Read `launch.json` and the helper output. `doctor` must be true and both children must remain alive. The helper checks the owned API and application endpoints. Open the base URL in a new background CUA browser tab. Wait for **Run code**, which indicates the initial real Pyodide trace completed. Python and Monaco may load public CDN assets on first use. A permanently loading runtime is a failed precondition, not a pass.

## Drive

In `mcp__cua_repl`, import the maintained module and pass the supported CUA tab:

```javascript
var traceDriver = await import('file:///C:/Users/steve/Projects/traceframe/tools/verify-traceframe-browser.mjs');
await traceDriver.driveExecutionBaseline(tab, 'C:/Users/steve/Projects/traceframe/.audit/verification/baseline-001');
```

Resolve those absolute paths against the actual checkout on another machine. The driver uses only supported CUA browser actions, modifies the example's public input form, runs actual Python, selects the final frame, and checks the rendered sorted result. It does not inject application state, intercept requests, or fake a trace.

Read [features/README.md](features/README.md) for mapped journeys. Keep unit, types, build, API and rendered behavior evidence distinct. After interface changes, inspect desktop and narrow screenshots with the real content and restore temporary viewport overrides.

## Evidence

The directory retains `launch.json`, `server.log`, browser action/result files, screenshots, optional offline/online `transitions.json`, and `server-result.json`. Browser success requires `passed: true` and the expected final values. Runtime state and capabilities belong only in ignored storage. Never commit access tokens, private notebook contents or local databases.

## Cleanup

Send Ctrl+C to the owned launch terminal. The helper stops its captured children and records `cleanup: true` after checking that both listeners are unavailable. Confirm the process/session finished, then inspect `server-result.json`. Close the temporary verification tabs unless they are requested deliverables. Verify that screenshots and action/result files still exist after cleanup.

## Helpers

`tools/verify-traceframe-server.mjs` handles Launch, Doctor, and Cleanup. `tools/verify-traceframe-browser.mjs` and `tools/verify-notebook-browser.mjs` handle browser Drive and Evidence. Run `npm run check`, `npm test`, `npm run build`, `npm run experiment:annotations`, and `npm audit` separately. A mapped journey without a completed drive remains unverified.
