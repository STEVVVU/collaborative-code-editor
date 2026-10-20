# Execution and timeline

## Sub-features

Example selection, editable function arguments, real Python worker execution, materialized frames, final values, and replay availability.

## How to get to it (user POV)

Open the playground, choose Bubble sort, change the function arguments, and select Run code. Move the execution timeline to its end.

## Driving it with CUA

Use `driveExecutionBaseline(tab, evidenceDirectory)`. It supplies `[[3,1,2]]`, executes the real adapter, presses End on the timeline, and verifies `nums sequence 1 2 3` in the actual accessibility state. Save replay must become enabled. Preserve the screenshot and result JSON.

## Gotchas

The first browser run loads Pyodide and Monaco from public CDNs. The helper allows a bounded readiness wait. It fails if the runtime stays loading or the final values are absent. The driver assumes the app's existing English control labels. It never sends code to the notebook server or a model provider.
