# Notebook protocol measurements

[Hosted run 39732085974](https://github.com/STEVVVU/collaborative-code-editor/actions/runs/39732085974), clean source `b7b76e43f0453ae7e982099958088e72a1e7c32c`. Linux 7.0.0-1017-azure, four allocated CPUs on AMD EPYC 9V45, 15.61 GiB reported RAM, Node 24.22.0. Follow the [frozen plan](benchmark-plan.md): `npm ci`, `npm run build:packages`, then `node tools/benchmark-notebooks.mjs`. Profiling is separate with `--profile`.

All 141 cells passed exact Yjs peer/persisted-source checks and owned cleanup: 135 matrix cells (2/8/32 clients × 1/16/48KiB × 1/10/50 aggregate edits/s × five repeats), five reconnect cases and one 120s stability case. All 29,150 offered edits were sent, acknowledged and observed by every client, with zero protocol failures/timeouts. An independent audit read every update's offer lateness, acknowledgment and per-peer observation: all were finite and nonnegative. The earlier run 39728421618 is retained, but fractional-timer early offers invalidate its precise latency claims. These figures use only the corrected deadline-wait run. This is one implementation baseline, without a measured speedup claim.

## Scheduled edit to all-client convergence

At the highest offered rate, 50 edits/s, each ten-second repeat sends 500 edits. Milliseconds below are the median of five per-repeat statistics, with their minimum–maximum across those five in parentheses. The scheduled deadline-to-observation boundary includes offer lateness and queueing. Source size is the initial owned source; edits append unique markers. Clients use authenticated HTTP/WebSocket/Yjs. Browser rendering and Monaco paint are outside this boundary.

| Clients | Initial KiB | p50 ms | p95 ms | Empirical p99 ms |
| ---: | ---: | ---: | ---: | ---: |
|2|1|2.71 (2.29–2.91)|4.25 (3.88–9.08)|6.79 (6.54–18.76)|
|2|16|2.96 (2.60–3.15)|4.30 (4.08–9.58)|9.39 (6.12–19.04)|
|2|48|3.71 (3.26–3.85)|5.26 (4.81–6.70)|11.37 (7.43–11.79)|
|8|1|3.71 (2.91–3.78)|5.12 (4.50–5.87)|6.94 (6.28–10.31)|
|8|16|4.14 (3.24–4.43)|6.38 (5.21–7.59)|9.24 (6.89–38.10)|
|8|48|4.81 (4.00–5.21)|6.61 (6.05–7.93)|11.31 (7.28–16.46)|
|32|1|7.00 (4.70–7.63)|10.50 (7.18–11.26)|11.18 (8.01–13.15)|
|32|16|8.01 (5.56–9.21)|12.36 (8.38–13.28)|17.48 (11.63–22.25)|
|32|48|8.72 (7.01–9.68)|12.48 (10.43–14.02)|15.52 (11.13–17.15)|

The lower offered rates remain in the full artifact, including outliers. At 32 clients / 48 KiB / 10 edits/s, p50 median 7.12 ms (6.91–7.70), empirical p99 median 12.33 ms (11.31–54.64), 100 samples/repeat. At 1 edit/s there are only 10 observations/repeat: observed maxima, rather than inferential p99, are meaningful. The 2 client / 1 KiB case had p50 median 3.04 ms (2.77–3.88) and maximum median 4.45 ms (3.50–429.98). The 429.98 ms outlier is retained; low-rate 16/48 KiB cells also reached 148.01/228.54 ms. No scheduler/disk cause is established for these outliers.

## Reconnect, stability and resources

Five eight-client reconnect cases recovered all 100 edits per repeat after the last peer's intentional middle-third disconnect. Socket reconnect-to-catch-up median was 1.80 ms (range1.42–1.95). The 120s eight-client stability case delivered all 1,200 edits; ack p50/p95/p99=3.92/5.66/9.13ms, maximum 23.12 ms. Its intentional 40s disconnect yields all-peer convergence p99 = 38.80s and maximum 40.00s; these offline delays remain in the data. Reconnect catch-up in that longer case took 3.24 ms.

Across the campaign, peak pending acknowledgments=4 and WebSocket buffered bytes=0. Sampled server RSS peaked 140.88 MiB; generator RSS observed at cell completion peaked 328.89 MiB (not a continuous high-water measurement). Generator event-loop p99 reached 15.22 ms. For 32 clients / 48 KiB / 50 edits/s, generator CPU was 2.67–3.89s per approximately 10.14s cell, server CPU 2.45–2.73s, and offer-lateness p99 = 1.50–2.09ms. This cell did not demonstrate a CPU ceiling; it does not establish maximum capacity beyond 50/s.

The separate profile uses the plan's eight-client/16KiB/50edits/s workload. Generator profile 15.24s includes 14.44s idle; server profile 10.16s includes 8.87s idle. Largest active server callback self time was 0.66s, dominated by the synchronous SQLite persistence call within that callback. The shipped DELETE-journal/full-snapshot durability path remains unchanged. A cost appearing in a profile does not establish saturation across the matrix. Marker-membership correctness work also costs generator CPU and must be monitored at larger client counts.

## Retained evidence

The run artifact is `notebook-benchmark-b7b76e43f0453ae7e982099958088e72a1e7c32c`. Full raw record: `notebooks-1792649323183/evidence.json`, SHA256 `df2014d7d983b25a2499527f160d242bbf0b2f86b64840e440aafe8fc2b002f2`. It contains all 141 cells and 29,150 update receipts, resource samples and cleanup results. Smoke is `notebooks-1792649313092`; separate profile is `notebooks-1792650817096`, with generator profile at artifact root and service profile in `sample-0`. Generated SQLite data/profiles/raw records stay outside Git; download the linked run artifact to inspect them. Retain the original invalid-timing run as historical evidence.
