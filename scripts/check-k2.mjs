import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const results = [];
const attemptId = `${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${randomUUID()}`;
const execute = (id, executable, args, options = {}) => {
  const child = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    timeout: options.timeout ?? 120000,
    maxBuffer: 5 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: resolve(root, "python") }
  });
  const output = `${child.stdout ?? ""}${child.stderr ?? ""}`;
  const diagnostic = options.diagnostic ? new RegExp(options.diagnostic).test(output) : undefined;
  const passed = !child.error && (options.reject
    ? child.status !== 0 && diagnostic === true
    : child.status === 0);
  const sanitizedOutput = output.replaceAll(root, "<repo>").replaceAll("\r\n", "\n").trim();
  const result = {
    id,
    command: [executable, ...args],
    exitCode: child.status,
    passed,
    output: sanitizedOutput.length <= 12000 ? sanitizedOutput : `${sanitizedOutput.slice(0, 6000)}\n<truncated>\n${sanitizedOutput.slice(-6000)}`,
    ...(options.diagnostic ? { expectedDiagnostic: options.diagnostic, diagnosticMatched: diagnostic } : {})
  };
  results.push(result);
  return result;
};
const fixtures = new Map();
const fixtureDirectories = new Set();
const createFixture = async (path, content) => {
  const absolute = resolve(root, path);
  let parent = resolve(absolute, "..");
  while (parent.startsWith(root) && parent !== root) {
    try {
      await stat(parent);
      break;
    } catch {
      try {
        await mkdir(parent);
        fixtureDirectories.add(parent);
      } catch (error) {
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error;
      }
      parent = resolve(parent, "..");
    }
  }
  await writeFile(absolute, content, { flag: "wx", encoding: "utf8" });
  const created = await stat(absolute);
  fixtures.set(absolute, { content, dev: created.dev, ino: created.ino });
};
const removeOwnedFixture = async (path) => {
  const absolute = resolve(root, path);
  const owned = fixtures.get(absolute);
  if (!owned) return;
  try {
    const current = await stat(absolute);
    if (current.dev === owned.dev && current.ino === owned.ino && await readFile(absolute, "utf8") === owned.content) {
      await rm(absolute);
    }
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  fixtures.delete(absolute);
};
const digest = async (path) => {
  try {
    return createHash("sha256").update(await readFile(resolve(root, path))).digest("hex");
  } catch {
    return null;
  }
};
let driftedOutput;
let originalGeneratedTypes;
let driftedGeneratedTypes;
let generatedTypesIdentity;

try {
  execute("bootstrap-contract-generation", "npm", ["run", "contracts:generate"]);
  execute("baseline-static-gates", "npm", ["run", "check"]);

  const fixtureFiles = [
    ["cli/src/k2-any-fixture.ts", "export const unsafe: any = 1;\n"],
    ["cli/src/k2-cast-fixture.ts", "export const unsafe = 1 as string;\n"],
    ["cli/src/k2-promise-fixture.ts", "const pending = async (): Promise<void> => {};\npending();\n"],
    ["cli/src/k2-comment-fixture.ts", "// FIXME injected comment\nexport {};\n"],
    ["cli/src/k2-runtime-js-fixture.js", "export const runtime = true;\n"],
    ["cli/src/k2-template-comment-fixture.ts", "export const label = `value ${1}`; // forbidden rationale\n"],
    ["cli/src/k2-identifier-fixture.ts", "export const FIXME = 1;\n"],
    ["cli/src/k2-compiler-fixture.ts", "export const unsafe: string = [\"value\"][1];\n"],
    ["tests/fixtures/k2-license.ts", "// SPDX-License-Identifier: MIT\nexport {};\n"],
    ["tests/fixtures/k2-as-const.ts", "export const tuple = [\"one\", \"two\"] as const;\n"],
    ["tests/fixtures/k2-token-literal.ts", "export const url = \"https://example.invalid\";\nexport const literal = \"// TODO FIXME workaround any\";\n"],
    ["tests/fixtures/k2-template-literal.ts", "export const label = `value ${1} // TODO is data`;\nexport const matcher = /https?:\\/\\/|\\/\\/ TODO/;\n"],
    ["tests/fixtures/k2-registry-fixture.internal.test.ts", "export {};\n"],
    ["tests/fixtures/k2-sim-route.sim.test.ts", "export {};\n"],
    ["tests/fixtures/k2-rung-bypass.test.ts", "export {};\n"],
    ["tests/fixtures/k2-copy.ts", "export type ModuleIdCopy = \"contracts\" | \"obligations\" | \"attention\" | \"authority\" | \"sources\" | \"lifestore\" | \"hermes\" | \"client\" | \"hands\" | \"self-improvement\" | \"adhd\" | \"ops\";\n"],
    ["python/toy_adapter/k2-python-fixture.py", "from typing import Any, cast\n\nvalue: Any = cast(Any, 1)\n"],
    ["python/toy_adapter/k2-python-any-alias-fixture.py", "from typing import Any as Opaque\nfrom typing_extensions import Any as ExtendedOpaque\n\nvalue: Opaque = 1\nother: ExtendedOpaque = value\n"],
    ["python/toy_adapter/k2-python-cast-alias-fixture.py", "from typing import cast as convert\nfrom typing_extensions import cast as convert_extended\n\nvalue = convert(str, 1)\nother = convert_extended(str, value)\n"],
    ["python/toy_adapter/k2-python-license.py", "# SPDX-License-Identifier: MIT\nvalue = 1\n"],
    ["python/toy_adapter/k2-pyright-fixture.py", "def value() -> str:\n    return 1\n"],
    ["python/toy_adapter/k2-ruff-fixture.py", "import typing\n\nvalue = 1\n"],
    ["packages/k2-pin-fixture/package.json", "{\"name\":\"k2-pin-fixture\",\"dependencies\":{\"zod\":\"4.6.5\"}}\n"]
  ];
  for (const [path, content] of fixtureFiles) await createFixture(path, content);

  const policies = [
    ["valid-license-header", "node", ["scripts/check-source-policy.mjs", "tests/fixtures/k2-license.ts"]],
    ["eslint-const-assertion-passes", process.execPath, ["node_modules/eslint/bin/eslint.js", "tests/fixtures/k2-as-const.ts"]],
    ["valid-generated-banner", "node", ["scripts/check-source-policy.mjs", "packages/contracts/generated/types.ts"]],
    ["comment-markers-in-strings-pass", "node", ["scripts/check-source-policy.mjs", "tests/fixtures/k2-token-literal.ts"]],
    ["comment-markers-in-template-and-regex-pass", "node", ["scripts/check-source-policy.mjs", "tests/fixtures/k2-template-literal.ts"]],
    ["comment-policy-denies-comment", "node", ["scripts/check-source-policy.mjs", "cli/src/k2-comment-fixture.ts"], { reject: true, diagnostic: "forbidden code comment" }],
    ["runtime-javascript-denied", "node", ["scripts/check-source-policy.mjs", "cli/src/k2-runtime-js-fixture.js"], { reject: true, diagnostic: "Toy product code must use strict TypeScript" }],
    ["trailing-template-comment-denied", "node", ["scripts/check-source-policy.mjs", "cli/src/k2-template-comment-fixture.ts"], { reject: true, diagnostic: "forbidden code comment" }],
    ["identifier-policy-denies-debt-marker", "node", ["scripts/check-source-policy.mjs", "cli/src/k2-identifier-fixture.ts"], { reject: true, diagnostic: "forbidden debt marker identifier" }],
    ["eslint-denies-any", process.execPath, ["node_modules/eslint/bin/eslint.js", "cli/src/k2-any-fixture.ts"], { reject: true, diagnostic: "no-explicit-any" }],
    ["eslint-denies-unchecked-cast", process.execPath, ["node_modules/eslint/bin/eslint.js", "cli/src/k2-cast-fixture.ts"], { reject: true, diagnostic: "no-unchecked-casts" }],
    ["eslint-denies-floating-promise", process.execPath, ["node_modules/eslint/bin/eslint.js", "cli/src/k2-promise-fixture.ts"], { reject: true, diagnostic: "no-floating-promises" }],
    ["tsc-denies-unchecked-index", process.execPath, ["node_modules/typescript/bin/tsc", "--ignoreConfig", "--strict", "--noUncheckedIndexedAccess", "--noEmit", "--target", "ES2024", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--types", "node", "cli/src/k2-compiler-fixture.ts"], { reject: true, diagnostic: "TS2322" }],
    ["ownership-denies-renamed-structural-copy", "node", ["scripts/check-contract-ownership.mjs", "tests/fixtures/k2-copy.ts"], { reject: true, diagnostic: "structural copy of generated contract ModuleId" }],
    ["python-policy-denies-any-and-cast", ".venv/bin/python", ["scripts/check-python-policy.py", "python/toy_adapter/k2-python-fixture.py"], { reject: true, diagnostic: "explicit Any is forbidden" }],
    ["python-policy-denies-aliased-any", ".venv/bin/python", ["scripts/check-python-policy.py", "python/toy_adapter/k2-python-any-alias-fixture.py"], { reject: true, diagnostic: "explicit Any is forbidden" }],
    ["python-policy-denies-aliased-cast", ".venv/bin/python", ["scripts/check-python-policy.py", "python/toy_adapter/k2-python-cast-alias-fixture.py"], { reject: true, diagnostic: "unchecked casts are forbidden" }],
    ["pyright-denies-invalid-python-return", process.execPath, ["node_modules/pyright/index.js", "python/toy_adapter/k2-pyright-fixture.py"], { reject: true, diagnostic: "reportReturnType" }],
    ["ruff-denies-python-lint-error", ".venv/bin/ruff", ["check", "python/toy_adapter/k2-ruff-fixture.py"], { reject: true, diagnostic: "F401" }]
  ];
  for (const [id, executable, args, options = {}] of policies) {
    execute(id, executable, args, options);
  }
  execute("single-contract-pin-enforced", "node", ["scripts/check-contract-pin.mjs"], { reject: true, diagnostic: "Zod must have one exact 4.6.5 runtime pin" });

  execute("int-registry-missing-entry-denied", "node", ["scripts/check-int-registry.mjs", "tests/registry.yaml", "tests/fixtures"], { reject: true, diagnostic: "missing INT registry entry k2-registry-fixture" });
  const validRegistry = "build/tmp/k2-int-registry.yaml";
  await createFixture(validRegistry, `${JSON.stringify([{ id: "k2-registry-fixture", rung: "INT", justification: "The fixture validates registry metadata parsing without executing behavior." }])}\n`);
  const bypassFixture = resolve(root, "tests/fixtures/k2-rung-bypass.test.ts");
  await removeOwnedFixture(bypassFixture);
  execute("int-registry-entry-passes", "node", ["scripts/check-int-registry.mjs", validRegistry, "tests/fixtures"]);
  await createFixture("tests/fixtures/k2-rung-bypass.test.ts", "export {};\n");
  execute("test-rung-rename-bypass-denied", "node", ["scripts/check-int-registry.mjs", validRegistry, "tests/fixtures"], { reject: true, diagnostic: "must declare its rung" });
  await createFixture("tests/fixtures/pytest-prefix/test_math.py", "value = 1\n");
  execute("pytest-prefix-test-name-rung-required", "node", ["scripts/check-int-registry.mjs", validRegistry, "tests/fixtures/pytest-prefix"], { reject: true, diagnostic: "must declare its rung" });
  await createFixture("tests/fixtures/pytest-suffix/math_test.py", "value = 1\n");
  execute("pytest-suffix-test-name-rung-required", "node", ["scripts/check-int-registry.mjs", validRegistry, "tests/fixtures/pytest-suffix"], { reject: true, diagnostic: "must declare its rung" });

  const generatedTypesPath = resolve(root, "packages/contracts/generated/types.ts");
  originalGeneratedTypes = await readFile(generatedTypesPath, "utf8");
  const generatedTypesStats = await stat(generatedTypesPath);
  generatedTypesIdentity = { dev: generatedTypesStats.dev, ino: generatedTypesStats.ino };
  driftedGeneratedTypes = `${originalGeneratedTypes}\n`;
  driftedOutput = true;
  await writeFile(generatedTypesPath, driftedGeneratedTypes, "utf8");
  execute("codegen-drift-denied", "node", ["scripts/generate-contracts.mjs", "--check"], { reject: true, diagnostic: "generated artifact drift" });
  await writeFile(generatedTypesPath, originalGeneratedTypes, "utf8");
  driftedOutput = false;
} catch (error) {
  results.push({ id: "gate-execution", passed: false, error: error instanceof Error ? error.message : String(error) });
} finally {
  if (driftedOutput && originalGeneratedTypes !== undefined) {
    const generatedTypesPath = resolve(root, "packages/contracts/generated/types.ts");
    try {
      const current = await stat(generatedTypesPath);
      if (current.dev === generatedTypesIdentity?.dev && current.ino === generatedTypesIdentity?.ino && await readFile(generatedTypesPath, "utf8") === driftedGeneratedTypes) {
        await writeFile(generatedTypesPath, originalGeneratedTypes, "utf8");
      } else {
        results.push({ id: "generated-drift-fixture-cleanup", passed: false, error: "Generated artifact changed during fixture; preserved the current file." });
      }
    } catch (error) {
      results.push({ id: "generated-drift-fixture-cleanup", passed: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const path of [...fixtures.keys()].reverse()) await removeOwnedFixture(path);
  for (const directory of [...fixtureDirectories].sort((left, right) => right.length - left.length)) {
    try {
      await rmdir(directory);
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || !["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
    }
  }
}

execute("post-fixture-static-gates", "npm", ["run", "check"]);
const policyGeneratorPaths = [
  ".dependency-cruiser.cjs",
  "architecture/modules.json",
  "eslint.config.mjs",
  "package-lock.json",
  "package.json",
  "packages/contracts/package.json",
  "packages/contracts/src/cli.ts",
  "packages/contracts/src/public.ts",
  "packages/contracts/src/primitives.ts",
  "packages/contracts/tsconfig.json",
  "pyproject.toml",
  "pyrightconfig.json",
  "scripts/check-contract-ownership.mjs",
  "scripts/check-contract-pin.mjs",
  "scripts/check-foundations.mjs",
  "scripts/check-int-registry.mjs",
  "scripts/check-k2.mjs",
  "scripts/check-python-policy.py",
  "scripts/check-source-policy.mjs",
  "scripts/generate-contracts.mjs",
  "scripts/generated-artifacts.json",
  "scripts/run-eslint.mjs",
  "scripts/static-gate.json",
  "scripts/tsconfig.json",
  "scripts/typecheck-tests.mjs",
  "tests/registry.yaml",
  "tests/tsconfig.json",
  "tsconfig.base.json",
  "tsconfig.json"
];
const policyGeneratorInputs = Object.fromEntries(await Promise.all(policyGeneratorPaths.map(async (path) => [path, await digest(path)])));
const generatedCodePaths = JSON.parse(await readFile(resolve(root, "scripts/generated-artifacts.json"), "utf8")).codeArtifacts;
const generatedCode = Object.fromEntries(await Promise.all(generatedCodePaths.map(async (path) => [path, await digest(path)])));
const generatedSchemaDirectory = resolve(root, "packages/contracts/generated/schemas");
const generatedSchemaPaths = (await readdir(generatedSchemaDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".schema.json"))
  .map((entry) => `packages/contracts/generated/schemas/${entry.name}`)
  .sort();
const generatedSchemaHashes = Object.fromEntries(await Promise.all(generatedSchemaPaths.map(async (path) => [path, await digest(path)])));
const staticGate = JSON.parse(await readFile(resolve(root, "scripts/static-gate.json"), "utf8"));
const report = {
  schemaVersion: "toy.bootstrap-gate.v1",
  card: "R0.K2",
  attemptId,
  generatedAt: new Date().toISOString(),
  verdict: results.every((result) => result.passed) ? "PASS" : "FAIL",
  acceptanceComplete: false,
  pendingATs: ["AT-hermes-config-101"],
  limitation: "K2 bootstrap static proof only; AT-hermes-config-101 remains pending until K4's complete CLI-driven compiler/lint/codegen/map gate passes.",
  route: "kitchen.bootstrap.static",
  intendedCanonicalRoute: `${staticGate.id} via ${staticGate.commandId} ${staticGate.scenarioId}`,
  policyGeneratorInputs,
  generatedCode,
  generatedSchemaHashes,
  results
};
const evidenceDirectory = resolve(root, "build/evidence/R0.K2");
const attemptsDirectory = resolve(evidenceDirectory, "attempts");
await mkdir(attemptsDirectory, { recursive: true });
const attemptEvidence = resolve(attemptsDirectory, `${attemptId}.json`);
const reportContents = `${JSON.stringify(report, null, 2)}\n`;
await writeFile(attemptEvidence, reportContents, { flag: "wx", encoding: "utf8" });
const latestEvidence = resolve(evidenceDirectory, "bootstrap.json");
await writeFile(latestEvidence, reportContents, "utf8");
process.stdout.write(`${JSON.stringify({ verdict: report.verdict, checks: results.map(({ id, passed }) => ({ id, passed })), evidence: "build/evidence/R0.K2/bootstrap.json", attemptEvidence: `build/evidence/R0.K2/attempts/${attemptId}.json`, acceptanceComplete: false })}\n`);
if (report.verdict !== "PASS") process.exitCode = 1;
