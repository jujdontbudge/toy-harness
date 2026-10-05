import { readFile, readdir } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const registryPath = resolve(root, process.argv[2] ?? "tests/registry.yaml");
const testRoot = resolve(root, process.argv[3] ?? "tests");
const testFile = /\.(?:test|spec)\.(?:ts|tsx|py)$/;
const pytestFile = /^(?:test_.*|.*_test)\.py$/;
const rungSuffix = /\.(sim|cli|module|internal)\.(?:test|spec)\.(?:ts|tsx|py)$/;
const internalSuffix = /\.internal\.(?:test|spec)\.(?:ts|tsx|py)$/;

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
    return testFile.test(entry.name) || pytestFile.test(entry.name) ? [child] : [];
  }));
  return children.flat();
};

const failures = [];
let data;
try {
  data = JSON.parse(await readFile(registryPath, "utf8"));
} catch {
  failures.push(`${relative(root, registryPath)} must use the JSON-compatible YAML registry form`);
  data = [];
}
if (!Array.isArray(data)) failures.push(`${relative(root, registryPath)} must contain an array`);
const registrations = new Map();
const internalIds = new Set();
if (Array.isArray(data)) {
  for (const [index, row] of data.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      failures.push(`${relative(root, registryPath)} entry ${index + 1} must be an object`);
      continue;
    }
    const keys = Object.keys(row).sort();
    if (keys.join(",") !== "id,justification,rung") failures.push(`${relative(root, registryPath)} entry ${index + 1} must contain only id, rung and justification`);
    if (typeof row.id !== "string" || row.id.trim() === "") failures.push(`${relative(root, registryPath)} entry ${index + 1} has an invalid id`);
    if (row.rung !== "INT") failures.push(`${relative(root, registryPath)} entry ${index + 1} must use rung INT`);
    if (typeof row.justification !== "string" || row.justification.trim() === "") failures.push(`${relative(root, registryPath)} entry ${index + 1} needs a registry-only justification`);
    if (typeof row.id === "string") {
      if (registrations.has(row.id)) failures.push(`${relative(root, registryPath)} has duplicate INT id ${row.id}`);
      registrations.set(row.id, row);
    }
  }
}
const tests = await walk(testRoot);
for (const path of tests) {
  const relativePath = relative(root, path).replaceAll("\\", "/");
  const name = basename(path);
  const rung = name.match(rungSuffix)?.[1];
  if (!rung) {
    failures.push(`${relativePath} must declare its rung with .sim, .cli, .module or .internal before .test/.spec`);
    continue;
  }
  if (rung === "internal") internalIds.add(relative(testRoot, path).replaceAll("\\", "/").replace(internalSuffix, ""));
}
const required = internalIds;
for (const id of required) if (!registrations.has(id)) failures.push(`${relative(root, registryPath)} is missing INT registry entry ${id}`);
for (const id of registrations.keys()) if (!required.has(id)) failures.push(`${relative(root, registryPath)} has dangling INT registry entry ${id}`);

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${registrations.size} registry-only INT entries match ${tests.length} internal test files\n`);
}
