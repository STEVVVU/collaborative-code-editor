import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const evidence = resolve(process.argv[2] ?? ".audit/verification/baseline");
const port = Number(process.argv[3] ?? 5175);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid verification port");
mkdirSync(evidence, { recursive: false });
const log = openSync(resolve(evidence, "server.log"), "w");
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [
  "node_modules/vite/bin/vite.js", "apps/playground", "--config", "apps/playground/vite.config.ts",
  "--host", "127.0.0.1", "--port", String(port), "--strictPort",
], { cwd: root, windowsHide: true, stdio: ["ignore", log, log] });
let exited = false;
const done = new Promise((resolveExit) => child.once("exit", (code) => { exited = true; resolveExit(code); }));
child.once("error", (error) => { console.error(error.message); });
const result = { base, pid: child.pid, doctor: false, cleanup: false };
const stop = () => { if (!exited) child.kill("SIGTERM"); };
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  const deadline = Date.now() + 15000;
  while (!exited && Date.now() < deadline) {
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.text()).includes("Traceframe")) {
        result.doctor = true;
        break;
      }
    } catch (error) {
      if (!(error instanceof TypeError) && error.name !== "TimeoutError") throw error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  if (!result.doctor) throw new Error("Owned Vite server did not become ready");
  writeFileSync(resolve(evidence, "launch.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await done;
} finally {
  stop();
  await done;
  closeSync(log);
  try {
    await fetch(base, { signal: AbortSignal.timeout(500) });
  } catch {
    result.cleanup = true;
  }
  writeFileSync(resolve(evidence, "server-result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
