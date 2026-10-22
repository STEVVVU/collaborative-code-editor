# Traceframe project guidance

Traceframe is a React execution visualizer with a neutral TypeScript trace model and a Python/Pyodide browser worker. Preserve existing execution, replay, projection and accessibility behavior.

Use Node 24.15 or newer in the 24.x line, or another version supported by the locked toolchain. Node 25 does not satisfy jsdom 30's engine range. Install with `npm ci`. Existing checks are `npm run check`, `npm test`, and `npm run build`. Keep package versions exact and update the lockfile with dependency changes.

On Windows, an npm.cmd beside a different node.exe can override PATH. Check both `node --version` and `npm exec --call "node --version"`; invoke npm-cli.js with the intended Node executable when they differ. The project engine constraint rejects unsupported installations.

Before product changes, use `.agents/skills/verify-traceframe/SKILL.md`. Its browser driver uses the supported CUA API against the real Vite application. Do not use application-state injection or mocked trace responses as browser evidence. Verification data belongs under ignored `.audit/` and must survive cleanup.

The Python worker executes code locally. Collaboration must never trigger remote-code execution automatically. Room capabilities, document revisions and persistence belong in the notebook service, not the trace renderer. Do not expose edit capabilities in server logs, query strings, screenshots or committed fixtures. Frontend collaboration must retain unsynced updates and reject responses after room changes/disposal.

Apply the supplied global AGENTS rules, PStack and design-with-evidence. Keep shared product contracts typed and document concurrency and authorization invariants beside the owning package. For collaboration changes, re-drive the execution baseline as well as the affected notebook journeys.
