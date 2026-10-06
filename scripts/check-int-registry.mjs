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
const cliRegistrations = new Map();
const registeredIds = new Set();
const internalIds = new Set();
if (Array.isArray(data)) {
  for (const [index, row] of data.entries()) {
    const label = `${relative(root, registryPath)} entry ${index + 1}`;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      failures.push(`${label} must be an object`);
      continue;
    }
    if (typeof row.id !== "string" || row.id.trim() === "") failures.push(`${label} has an invalid id`);
    if (typeof row.id === "string") {
      if (registeredIds.has(row.id)) failures.push(`${relative(root, registryPath)} has duplicate registry id ${row.id}`);
      registeredIds.add(row.id);
    }
    if (row.rung === "INT") {
      const keys = Object.keys(row).sort();
      if (keys.join(",") !== "id,justification,rung") failures.push(`${label} must contain only id, rung and justification`);
      if (typeof row.justification !== "string" || row.justification.trim() === "") failures.push(`${label} needs a registry-only justification`);
      if (typeof row.id === "string") registrations.set(row.id, row);
    } else if (row.rung === "CLI") {
      if (typeof row.id === "string") cliRegistrations.set(row.id, row);
    } else {
      failures.push(`${label} must use rung INT or CLI`);
    }
  }
}
if (cliRegistrations.size > 0) {
  try {
    const contracts = await import(new URL("../packages/contracts/dist/public.js", import.meta.url).href);
    for (const [id, row] of cliRegistrations) {
      const parsed = contracts.schemaInventory.RegisteredCliAcceptanceManifestV1.safeParse(row);
      if (!parsed.success) failures.push(`${relative(root, registryPath)} CLI entry ${id} does not satisfy RegisteredCliAcceptanceManifestV1`);
    }
  } catch {
    failures.push(`${relative(root, registryPath)} CLI registrations require compiled @toy/contracts; run npm run typecheck`);
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
  process.stdout.write(`${registrations.size} INT entries match ${internalIds.size} internal test files and ${cliRegistrations.size} CLI acceptance registrations satisfy the public contract; ${tests.length} total test files declare a rung\n`);
}
