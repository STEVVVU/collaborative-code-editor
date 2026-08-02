import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const [source, destination] = process.argv.slice(2).map((path) =>
  resolve(process.cwd(), path),
);

if (!source || !destination) {
  throw new Error("Usage: copy-file.mjs <source> <destination>");
}

await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
