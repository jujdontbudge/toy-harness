import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { cliCommandSchemas, cliDeclarations, cliResultSchema, registeredCliProbeInventory, releaseSchema, schemaBundleArtifacts, schemaBundleDigest, serviceIdSchema } from "@toy/contracts";

const root = resolve(import.meta.dirname, "../..");
const attemptId = new Date().toISOString().replaceAll(":", "-") + "-" + randomUUID();
const receiptDirectory = join(root, "build/evidence/R0.K3/attempts", attemptId);
await mkdir(join(root, "build/tmp"), { recursive: true });
const fixture = await mkdtemp(join(root, "build/tmp/k3-packed-"));
await mkdir(receiptDirectory, { recursive: true });
const setup = (args: string[]): void => {
  const child = spawnSync("npm", args, { cwd: fixture, encoding: "utf8", timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
  assert.ok(child.error === undefined, "Offline package preparation did not complete");
  assert.equal(child.status, 0, "Offline package preparation failed");
};
const canaries = new Set<string>();
const receipts: { id: string; argumentCount: number; exitCode: number | null; stdoutBytes: number; stderrBytes: number; stdout: string | null; protocolValidated: boolean }[] = [];
const invoke = (id: string, args: string[], exitCode: number) => {
  const child = spawnSync(join(fixture, "node_modules/.bin/toy"), args, { cwd: fixture, encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  const receipt = { id, argumentCount: args.length, exitCode: child.status, stdoutBytes: Buffer.byteLength(child.stdout), stderrBytes: Buffer.byteLength(child.stderr), stdout: null, protocolValidated: false };
  receipts.push(receipt);
  assert.ok(child.error === undefined, "CLI process did not complete");
  assert.equal(child.status, exitCode);
  assert.equal(receipt.stderrBytes, 0, "CLI wrote diagnostics to stderr");
  assert.ok([...canaries].every((canary) => !child.stdout.includes(canary) && !child.stderr.includes(canary)), "CLI disclosed a private canary");
  assert.ok(child.stdout.endsWith("\n"));
  if (!args.includes("--json")) {
    assert.ok(!/[\u001b\u009b]/.test(child.stdout));
    if (args[0] === "status" || args[0] === "doctor") {
      assert.ok(child.stdout.startsWith("prod:"));
      assert.ok(child.stdout.includes('"checkedAt":'));
      assert.ok(child.stdout.includes('"nextCommandId":'));
      if (args[0] === "status") {
        assert.ok(child.stdout.includes('"capabilities":'));
        assert.ok(child.stdout.includes('"secrets":'));
      }
    }
    receipt.protocolValidated = true;
    const validatedReceipt = receipts.at(-1);
    assert.ok(validatedReceipt);
    validatedReceipt.stdout = child.stdout;
    return null;
  }
  assert.equal(child.stdout.split("\n").length, 2);
  let decoded: unknown;
  try {
    decoded = JSON.parse(child.stdout);
  } catch {
    assert.fail("CLI JSON could not be decoded");
  }
  const parsed = cliResultSchema.safeParse(decoded);
  assert.ok(parsed.success, "CLI output did not match its public schema");
  const result = parsed.data;
  const validatedOutput = JSON.stringify(result) + "\n";
  assert.ok([...canaries].every((canary) => !validatedOutput.includes(canary)), "Validated CLI output disclosed a private canary");
  assert.equal(result.meta.exitCode, exitCode);
  assert.equal(result.schemaDigest, schemaBundleDigest);
  assert.equal(result.meta.effectState, "none");
  receipt.protocolValidated = true;
  const validatedReceipt = receipts.at(-1);
  assert.ok(validatedReceipt);
  validatedReceipt.stdout = validatedOutput;
  return result;
};

try {
  for (const path of ["cli", "packages/contracts", "packages/ops", "node_modules/zod"]) {
    setup(["pack", join(root, path), "--pack-destination", fixture, "--ignore-scripts", "--offline", "--json"]);
  }
  await writeFile(join(fixture, "package.json"), JSON.stringify({ name: "toy-k3-offline-fixture", version: "1.0.0", private: true }) + "\n", { flag: "wx" });
  setup(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", join(fixture, "cache"), "./toy-cli-1.0.0.tgz", "./toy-contracts-1.0.0.tgz", "./toy-ops-1.0.0.tgz", "./zod-4.6.5.tgz"]);

  await test("compiled packed CLI offline inventory and protocol boundary", async (suite) => {
    await suite.test("all declarations and concrete offline schema aliases survive packing", async () => {
      const result = invoke("help-json", ["--help", "--json"], 0);
      assert.ok(result?.ok && result.commandId === "help");
      cliCommandSchemas.help.result.parse(result);
      assert.deepEqual(result.data.commands, cliDeclarations);
      assert.deepEqual(result.data.commands.filter((entry) => entry.ownerSchemas === "registered").map((entry) => entry.id).sort(), Object.keys(cliCommandSchemas).sort());
      assert.equal(new Set(registeredCliProbeInventory.map((entry) => entry.id)).size, registeredCliProbeInventory.length);
      for (const artifact of schemaBundleArtifacts) {
        const bytes = await readFile(join(fixture, "node_modules/@toy/contracts", artifact.path.replace("packages/contracts/", "")));
        assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.digest);
      }
      const groups = new Set(cliDeclarations.flatMap((entry) => entry.id.split(".").slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join("."))));
      for (const group of groups) {
        const scoped = invoke("help-group-" + group, [...group.split("."), "--help", "--json"], 0);
        assert.ok(scoped?.ok && scoped.commandId === "help");
        assert.ok(scoped.data.commands.every((entry) => entry.id.startsWith(group + ".")));
        invoke("help-human-" + group, ["help", ...group.split(".")], 0);
        invoke("help-bare-" + group, [...group.split(".")], 0);
      }
    });
    await suite.test("version digests identify packed bytes", async () => {
      const result = invoke("version-json", ["--version", "--json"], 0);
      assert.ok(result?.ok && result.commandId === "version");
      cliCommandSchemas.version.result.parse(result);
      const bytes = await readFile(join(fixture, "node_modules/@toy/cli/dist/main.js"));
      assert.equal(result.data.executableDigest, createHash("sha256").update(bytes).digest("hex"));
      invoke("version-human", ["version"], 0);
    });
    await suite.test("invalid syntax and privilege options reject without payload disclosure", () => {
      const marker = "K3_" + randomUUID();
      const sentinel = marker + "_\u001b[31m";
      canaries.add(marker);
      const invalid = [
        ["--json", "--json", "status"], ["status", "--timeout-ms", "999", "--json"],
        ["status", "--release", "R9", "--json"], ["unknown", sentinel, "--json"],
        ["status", "--actor", sentinel, "--json"], ["status", "--uid", "0", "--json"],
        ["status", "--sql", sentinel, "--json"], ["status", "--show-secrets", "--json"],
        ["version", "extra", "--json"], ["help", "unknown", "--json"],
        ["status", "--deep", "--json"], ["obligations", "show", "invalid", "--json"],
        ["trace", "550e8400-e29b-41d4-a716-446655440000", "--after-sequence", "18446744073709551616", "--json"],
        ["trace", "550e8400-e29b-41d4-a716-446655440000", "--after-sequence", "01", "--json"],
        ["--env", "test", "status", "--json"], ["--stack", "550e8400-e29b-41d4-a716-446655440000", "status", "--json"]
      ];
      for (const [index, args] of invalid.entries()) {
        const result = invoke("invalid-" + index, args, 2);
        assert.ok(result && !result.ok && result.error.code === "INVALID_INPUT");
        assert.ok(!JSON.stringify(result).includes(marker));
      }
    });
    await suite.test("production test commands deny and absent owners stay unavailable", () => {
      const denied = invoke("prod-clock-denied", ["clock", "show", "--json"], 3);
      assert.ok(denied && !denied.ok && denied.error.code === "TEST_ONLY");
      const absent = invoke("test-clock-unavailable", ["--env", "test", "--stack", "550e8400-e29b-41d4-a716-446655440000", "clock", "show", "--json"], 5);
      assert.ok(absent && !absent.ok && absent.error.code === "DEPENDENCY_UNAVAILABLE");
      for (const sequence of ["9007199254740993", "18446744073709551615"]) {
        const result = invoke("lossless-" + sequence, ["trace", "550e8400-e29b-41d4-a716-446655440000", "--after-sequence", sequence, "--json"], 5);
        assert.ok(result && !result.ok && result.error.code === "NOT_IMPLEMENTED");
      }
      for (const kind of ["observation", "entity", "fact", "aggregate", "conflict"]) {
        const result = invoke("life-ref-" + kind, ["life", "get", "life://" + kind + "/550e8400-e29b-41d4-a716-446655440000", "--json"], 5);
        assert.ok(result && !result.ok && result.error.code === "NOT_IMPLEMENTED");
      }
    });
    await suite.test("registered stack and probe schemas reject unregistered selectors before dispatch", () => {
      const requestId = "550e8400-e29b-41d4-a716-446655440000";
      const testStack = ["--env", "test", "--stack", requestId];
      const invalid = [
        ["--env", "test", "stack", "up", "--release", "R0", "--request-id", requestId, "--world", "unknown-world", "--json"],
        [...testStack, "probe", "run", "AT-unregistered-1", "--request-id", requestId, "--json"],
        [...testStack, "probe", "run", "AT-user-sim-1", "--request-id", requestId, "--json"],
        [...testStack, "probe", "run", "AT-cli-4", "--request-id", requestId, "--case", "unknown-case", "--json"]
      ];
      for (const [index, args] of invalid.entries()) {
        const result = invoke("unregistered-selector-" + index, args, 2);
        assert.ok(result && !result.ok && result.error.code === "INVALID_INPUT");
      }
      const probe = invoke("registered-probe-unavailable", [...testStack, "probe", "run", "AT-cli-4", "--request-id", requestId, "--case", "native-entry", "--json"], 5);
      assert.ok(probe && !probe.ok && probe.error.code === "DEPENDENCY_UNAVAILABLE");
      cliCommandSchemas["probe.run"].result.parse(probe);
      const stack = invoke("registered-world-unavailable", ["--env", "test", "stack", "up", "--release", "R0", "--request-id", requestId, "--world", "r0-bootstrap", "--json"], 5);
      assert.ok(stack && !stack.ok && stack.error.code === "DEPENDENCY_UNAVAILABLE");
      cliCommandSchemas["stack.up"].result.parse(stack);
    });
    await suite.test("uninstalled status and doctor preserve incomplete inventory and fail closed", () => {
      for (const release of releaseSchema.options) {
        const result = invoke("status-uninstalled-" + release, ["status", "--release", release, "--json"], 5);
        assert.ok(result?.ok && result.commandId === "status");
        cliCommandSchemas.status.result.parse(result);
        assert.equal(result.data.requiredRelease, release);
        assert.equal(result.data.complete, false);
        assert.equal(result.data.ops, null);
        assert.equal(result.data.sources, null);
        assert.equal(result.data.attention, null);
        assert.equal(result.data.quota, null);
        assert.equal(result.data.cadence, null);
        assert.equal(result.data.release, null);
        for (const id of serviceIdSchema.options) {
          assert.ok(result.data.probes.some((probe) => probe.id === "service." + id && probe.state === "NOT_IMPLEMENTED"));
          assert.ok(result.data.secrets.some((secret) => secret.serviceId === id && secret.state === "unknown"));
        }
        for (const owner of ["ops", "sources", "attention", "quota", "cadence", "release"]) {
          assert.ok(result.data.probes.some((probe) => probe.id === "read." + owner && probe.state === "NOT_IMPLEMENTED"));
        }
        assert.equal(result.data.capabilities.length, cliDeclarations.length);
        assert.ok(result.data.capabilities.every((capability) => !capability.tested && !capability.installed && !capability.deployed));
        assert.ok(result.data.capabilities.some((capability) => capability.id === "control.help" && capability.implementation === "built"));
        assert.ok(result.data.capabilities.some((capability) => capability.id === "control.capture" && capability.implementation === "specified"));
      }
      const defaultStatus = invoke("status-default-release", ["status", "--json"], 5);
      assert.ok(defaultStatus?.ok && defaultStatus.commandId === "status" && defaultStatus.data.requiredRelease === "R0");
      for (const deep of [false, true]) {
        const result = invoke("doctor-uninstalled-" + deep, ["doctor", "--release", "R3", ...(deep ? ["--deep"] : []), "--json"], 5);
        assert.ok(result?.ok && result.commandId === "doctor");
        cliCommandSchemas.doctor.result.parse(result);
        assert.equal(result.data.requiredRelease, "R3");
        assert.equal(result.data.deep, deep);
        assert.equal(result.data.complete, false);
        assert.equal(result.data.verdict, "NOT_IMPLEMENTED");
        assert.equal(result.data.checks.length, serviceIdSchema.options.length + 6);
        assert.ok(result.data.checks.every((check) => check.state !== "PASS" && check.links.recordRefs.length === 0));
      }
      invoke("status-human", ["status"], 5);
      invoke("doctor-human", ["doctor", "--deep"], 5);
      const unattested = invoke("status-unattested-stack", ["--env", "test", "--stack", "550e8400-e29b-41d4-a716-446655440000", "status", "--json"], 5);
      assert.ok(unattested && !unattested.ok && unattested.error.code === "ATTESTATION_INVALID");
    });
  });
} finally {
  try {
    const archive = JSON.stringify({
      schemaVersion: "toy.bootstrap-cli.v2", card: "R0.K3", attemptId, generatedAt: new Date().toISOString(),
      route: "compiled-packed-cli-subprocess", acceptanceComplete: false,
      receiptPolicy: "No arguments or raw stderr; only validated stdout, otherwise byte counts",
      limitation: "Offline/parser subset only. Full assigned AT assertions, owner schemas/transports, input files, actual identities and attested stacks remain pending.",
      schemaDigest: schemaBundleDigest, receipts
    }, null, 2) + "\n";
    assert.ok([...canaries].every((canary) => !archive.includes(canary)), "Receipt archive disclosed a private canary");
    assert.ok(receipts.every((receipt) => receipt.protocolValidated || receipt.stdout === null), "Receipt archive retained unvalidated output");
    await writeFile(join(receiptDirectory, "receipts.json"), archive, { flag: "wx" });
  } finally {
    await rm(fixture, { recursive: true });
  }
}
