import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const results = [];
const attemptId = `${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${randomUUID()}`;
const execute = (id, executable, argv, rejectionPattern = null, extraEnv = {}) => {
  const child = spawnSync(executable, argv, { cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH, PYTHONPATH: resolve(root, "python"), ...extraEnv } });
  const output = (child.stdout ?? "") + (child.stderr ?? "");
  const passed = !child.error && (rejectionPattern ? child.status !== 0 && rejectionPattern.test(output) : child.status === 0);
  results.push({ id, executable, argv, exitCode: child.status, passed, output });
  return passed;
};
const fixture = async (files, action) => {
  const created = [];
  try {
    for (const [path, content] of files) {
      await mkdir(resolve(root, path, ".."), { recursive: true });
      await writeFile(resolve(root, path), content, { flag: "wx" });
      const identity = await lstat(resolve(root, path));
      created.push({ path, content, dev: identity.dev, ino: identity.ino });
    }
    action();
  } finally {
    for (const { path, content, dev, ino } of created) {
      const current = await lstat(resolve(root, path));
      if (current.isFile() && current.dev === dev && current.ino === ino && await readFile(resolve(root, path), "utf8") === content) {
        await rm(resolve(root, path));
      } else {
        results.push({ id: "fixture-ownership-changed", passed: false, path });
      }
      if (path.endsWith(".ts") && path.includes("/src/")) {
        const output = path.replace("/src/", "/dist/").slice(0, -3);
        for (const suffix of [".js", ".js.map", ".d.ts"]) {
          try {
            await lstat(resolve(root, output + suffix));
            results.push({ id: "unexpected-fixture-emission", passed: false, path: output + suffix });
          } catch (error) {
            if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
          }
        }
      }
    }
  }
};

execute("valid-types", process.execPath, ["node_modules/typescript/bin/tsc", "-b", "--pretty", "false"]);
execute("valid-boundaries", process.execPath, ["node_modules/dependency-cruiser/bin/dependency-cruiser.mjs", "--config", ".dependency-cruiser.cjs", "packages", "cli"]);
execute("valid-pyright", process.execPath, ["node_modules/pyright/index.js"]);
execute("valid-ruff", ".venv/bin/ruff", ["check", "python"]);
execute("valid-python-boundaries", ".venv/bin/lint-imports", ["--no-cache"]);
await fixture([
  ["packages/sources/src/denial-fixture.ts", "export const fixtureValue = 1;\n"],
  ["packages/obligations/src/denial-fixture.ts", "export { fixtureValue } from '../../sources/src/denial-fixture.js';\n"]
], () => execute("private-import-denied", process.execPath, ["node_modules/dependency-cruiser/bin/dependency-cruiser.mjs", "--config", ".dependency-cruiser.cjs", "packages", "cli"], /obligations-public-boundaries/));
await fixture([
  ["cli/src/denial-fixture.ts", "export type { ModuleId } from '@toy/contracts';\nexport type { ModuleId as OpsModuleId } from '@toy/ops/public';\n"]
], () => execute("compiled-public-import-allowed", process.execPath, ["node_modules/dependency-cruiser/bin/dependency-cruiser.mjs", "--config", ".dependency-cruiser.cjs", "packages", "cli"]));
await fixture([
  ["packages/contracts/src/denial-fixture.ts", "export const fixtureValue = 1;\n"],
  ["packages/obligations/src/denial-fixture.ts", "export { fixtureValue } from '../../contracts/src/denial-fixture.js';\n"]
], () => execute("contracts-private-import-denied", process.execPath, ["node_modules/dependency-cruiser/bin/dependency-cruiser.mjs", "--config", ".dependency-cruiser.cjs", "packages", "cli"], /obligations-public-boundaries/));
await fixture([
  ["packages/contracts/src/denial-fixture.ts", "export const fixtureValue = 1;\n"],
  ["tests/fixtures/denial-fixture.ts", "export { fixtureValue } from '../../packages/contracts/src/denial-fixture.js';\n"]
], () => execute("tests-private-import-denied", process.execPath, ["node_modules/dependency-cruiser/bin/dependency-cruiser.mjs", "--config", ".dependency-cruiser.cjs", "packages", "cli", "tests"], /tests-public-only/));
await fixture([
  ["control/evaluator/denial-fixture.ts", "export const oracleValue = 1;\n"],
  ["cli/src/denial-fixture.ts", "export { oracleValue } from '../../control/evaluator/denial-fixture.js';\n"]
], () => execute("protected-import-denied", process.execPath, ["node_modules/dependency-cruiser/bin/dependency-cruiser.mjs", "--config", ".dependency-cruiser.cjs", "packages", "cli"], /protected-controls/));
await fixture([
  ["cli/src/denial-fixture.ts", "export const unsafeIndex: string = ['value'][1];\n"]
], () => execute("unchecked-index-denied", process.execPath, ["node_modules/typescript/bin/tsc", "-b", "--pretty", "false"], /TS2322/));
await fixture([
  ["python/toy_adapter/denial_fixture.py", "def value() -> str:\n    return 42\n"]
], () => execute("python-unsafe-type-denied", process.execPath, ["node_modules/pyright/index.js"], /reportReturnType/));
await fixture([
  ["python/toy_adapter/denial_fixture.py", "from toy_control import public\n\n__all__ = ['public']\n"]
], () => execute("python-protected-import-denied", ".venv/bin/lint-imports", ["--no-cache"], /BROKEN/));
execute("clean-after-fixtures", process.execPath, ["node_modules/typescript/bin/tsc", "-b", "--pretty", "false"]);
const inputs = ["architecture/modules.json", "tsconfig.base.json", ".dependency-cruiser.cjs", "pyrightconfig.json", "pyproject.toml", "package-lock.json", "scripts/check-foundations.mjs"];
const digests = Object.fromEntries(await Promise.all(inputs.map(async (path) => [path, createHash("sha256").update(await readFile(resolve(root, path))).digest("hex")])));
const report = { schemaVersion: "toy.bootstrap-gate.v1", card: "R0.K1", attemptId, generatedAt: new Date().toISOString(), verdict: results.every((row) => row.passed) ? "PASS" : "FAIL", acceptanceComplete: false, pendingATs: ["AT-hermes-config-101"], limitation: "Bootstrap compiler/import proof only; full CLI/generator/map assertion and independently protected filesystem identities remain pending.", digests, results };
await mkdir(resolve(root, "build/evidence/R0.K1"), { recursive: true });
await mkdir(resolve(root, "build/evidence/R0.K1/attempts"), { recursive: true });
await writeFile(resolve(root, `build/evidence/R0.K1/attempts/${attemptId}.json`), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
await writeFile(resolve(root, "build/evidence/R0.K1/foundations.json"), JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify({ verdict: report.verdict, checks: results.map(({ id, passed, exitCode }) => ({ id, passed, exitCode })), evidence: "build/evidence/R0.K1/foundations.json", acceptanceComplete: false }) + "\n");
process.exitCode = report.verdict === "PASS" ? 0 : 1;
