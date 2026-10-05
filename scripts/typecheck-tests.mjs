import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);
const walk = async (path) => {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const children = await Promise.all(entries.map(async (entry) => {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) return ["dist", "node_modules", ".venv", ".git", "__pycache__", "build"].includes(entry.name) ? [] : await walk(child);
    return sourceExtensions.has(entry.name.slice(entry.name.lastIndexOf("."))) ? [child] : [];
  }));
  return children.flat();
};
const files = await walk(resolve(root, "tests"));
if (files.length === 0) {
  process.stdout.write("No TypeScript test sources are registered for compilation.\n");
} else {
  const child = spawnSync(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), "-p", "tests/tsconfig.json", "--pretty", "false"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 5 * 1024 * 1024,
    env: process.env
  });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
}
