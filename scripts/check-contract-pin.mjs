import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageRoots = [".", "packages", "cli", "plugins/toy"];
const manifests = new Set([resolve(root, "package.json")]);
const walk = async (path) => {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) {
      if (!["dist", "node_modules", ".venv", ".git", "__pycache__", "build"].includes(entry.name)) await walk(child);
    } else if (entry.name === "package.json") {
      manifests.add(child);
    }
  }
};
for (const packageRoot of packageRoots.slice(1)) await walk(resolve(root, packageRoot));
const failures = [];
const pins = [];
for (const path of manifests) {
  const manifest = JSON.parse(await readFile(path, "utf8"));
  for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    if (manifest[section] && Object.hasOwn(manifest[section], "zod")) pins.push({ path, section, version: manifest[section].zod });
  }
}
const contracts = resolve(root, "packages/contracts/package.json");
if (pins.length !== 1 || pins[0]?.path !== contracts || pins[0]?.section !== "dependencies" || pins[0]?.version !== "4.6.5") {
  failures.push(`Zod must have one exact 4.6.5 runtime pin in packages/contracts/package.json; found ${pins.map((pin) => `${relative(root, pin.path)}:${pin.section}=${pin.version}`).join(", ") || "none"}`);
}
if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("The sole Zod runtime pin is @toy/contracts 4.6.5.\n");
}
