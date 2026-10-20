# Feature map

| Feature | Driver | Status |
| --- | --- | --- |
| [Execution and timeline](execution.md) | `driveExecutionBaseline` | Baseline and post-change real Python drive passed |
| Replay import/export | Existing file controls, manual CUA journey | Export availability checked; full file round trip requires a separate drive |
| Projection inspection | `driveProjectionSwitch` after pinning graph in a BFS notebook | Graph/structure switch retains frames and replay |
| [Shared notebooks](notebooks.md) | `createNotebookPeers`, `editNotebookPeers` | Real editor/viewer links, comment and three-tab updates |
| Offline and restart | `editAndReloadOffline`, `verifyNotebookReconnection` | Two writers, offline reload, server restart, merged drafts, explicit local execution |

A plan or test fixture does not certify a user path. Browser evidence is local; hosted CI runs API, static, unit and experiment checks.
