import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const children = [];
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  for (const child of children)
    if (child.exitCode === null) child.kill("SIGTERM");
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
for (const args of [
  ["apps/notebook-server/src/server.mjs"],
  [
    "node_modules/vite/bin/vite.js",
    "apps/playground",
    "--config",
    "apps/playground/vite.config.ts",
    "--strictPort",
  ],
]) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
  children.push(child);
  child.once("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
    stop();
  });
  child.once("exit", (code) => {
    if (!stopping) {
      process.exitCode = code || 1;
      stop();
    }
  });
}
await Promise.all(
  children.map(
    (child) => new Promise((resolve) => child.once("exit", resolve)),
  ),
);
