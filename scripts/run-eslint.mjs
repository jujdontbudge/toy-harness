import { readdir } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const roots = ["packages", "cli", "plugins/toy", "behavior", "tests", "scripts"];
const extensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
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
    return extensions.has(extname(entry.name)) && !relative(root, child).startsWith("packages/contracts/generated/") ? [child] : [];
  }));
  return children.flat();
};
const files = [...new Set([resolve(root, "eslint.config.mjs"), ...(await Promise.all(roots.map((path) => walk(resolve(root, path)))).then((items) => items.flat()))])].sort();
const child = spawnSync(process.execPath, [resolve(root, "node_modules/eslint/bin/eslint.js"), ...files], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 5 * 1024 * 1024,
  env: process.env
});
if (child.stdout) process.stdout.write(child.stdout);
if (child.stderr) process.stderr.write(child.stderr);
if (child.error) throw child.error;
process.exitCode = child.status ?? 1;
