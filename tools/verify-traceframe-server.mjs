import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const evidence = resolve(process.argv[2] ?? ".audit/verification/baseline");
const port = Number(process.argv[3] ?? 5175);
const apiPort = port + 20;
if (!Number.isInteger(port) || port < 1024 || apiPort > 65535)
  throw new Error("Invalid verification port");
mkdirSync(evidence, { recursive: false });
const log = openSync(resolve(evidence, "server.log"), "w");
const base = `http://127.0.0.1:${port}`;
const apiBase = `http://127.0.0.1:${apiPort}`;
const children = [];
const result = {
  base,
  apiBase,
  pids: [],
  doctor: false,
  cleanup: false,
  transitions: [],
};
let api;
let stopping = false;
let finish;
const finished = new Promise((resolveDone) => {
  finish = resolveDone;
});

function launch(args, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, ...env },
  });
  const owned = { child, exited: false, done: null };
  owned.done = new Promise((resolveExit) => {
    child.once("exit", () => {
      owned.exited = true;
      resolveExit();
    });
    child.once("error", (error) => {
      owned.exited = true;
      resolveExit();
      console.error(error.message);
      finish();
    });
  });
  children.push(owned);
  result.pids.push(child.pid);
  return owned;
}
async function reachable(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(600) })).ok;
  } catch (error) {
    if (error instanceof TypeError || error.name === "TimeoutError")
      return false;
    throw error;
  }
}
async function ready(owned, url) {
  const deadline = Date.now() + 15000;
  while (!owned.exited && Date.now() < deadline) {
    if (await reachable(url)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error(`Owned server did not become ready: ${url}`);
}
async function stop(owned) {
  if (owned && !owned.exited) owned.child.kill("SIGTERM");
  if (owned) await owned.done;
}
async function startApi() {
  api = launch(["apps/notebook-server/src/server.mjs"], {
    PORT: String(apiPort),
    NOTEBOOK_DB: resolve(evidence, "notebooks.sqlite"),
    NOTEBOOK_ORIGINS: base,
  });
  await ready(api, `${apiBase}/health`);
}
process.once("SIGINT", () => {
  stopping = true;
  finish();
});
process.once("SIGTERM", () => {
  stopping = true;
  finish();
});
const input = createInterface({ input: process.stdin });
let command = Promise.resolve();
input.on("line", (line) => {
  command = command
    .then(async () => {
      if (stopping) return;
      if (line.trim() === "offline") {
        await stop(api);
        if (await reachable(`${apiBase}/health`))
          throw new Error("Owned API still reachable");
      } else if (line.trim() === "online") {
        if (api && !api.exited) throw new Error("API already online");
        await startApi();
      } else return;
      const transition = { state: line.trim(), at: new Date().toISOString() };
      result.transitions.push(transition);
      writeFileSync(
        resolve(evidence, "transitions.json"),
        JSON.stringify(result.transitions, null, 2),
      );
      console.log(JSON.stringify(transition));
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
      finish();
    });
});
try {
  if ((await reachable(base)) || (await reachable(`${apiBase}/health`)))
    throw new Error("Verification port already in use");
  await startApi();
  const ui = launch(
    [
      "node_modules/vite/bin/vite.js",
      "apps/playground",
      "--config",
      "apps/playground/vite.config.ts",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    { NOTEBOOK_TARGET: apiBase },
  );
  await ready(ui, base);
  result.doctor = true;
  writeFileSync(
    resolve(evidence, "launch.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  await Promise.race([finished, ui.done]);
} finally {
  stopping = true;
  await command;
  await Promise.all(children.map(stop));
  input.close();
  closeSync(log);
  result.cleanup =
    !(await reachable(base)) && !(await reachable(`${apiBase}/health`));
  writeFileSync(
    resolve(evidence, "server-result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  if (!result.cleanup) process.exitCode = 1;
}
