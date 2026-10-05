import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { bootstrapJournalReadSchema, bootstrapResourcePreflightSchema, cliCommandSchemas, cliDeclarations, cliResultSchema, registeredCliProbeInventory, releaseSchema, schemaBundleArtifacts, schemaBundleDigest, serviceIdSchema } from "@toy/contracts";

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
const validateInvocation = (id: string, args: string[], exitCode: number, child: Pick<SpawnSyncReturns<string>, "stdout" | "stderr" | "status" | "error">) => {
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
const invoke = (id: string, args: string[], exitCode: number, environment?: NodeJS.ProcessEnv) => validateInvocation(id, args, exitCode,
  spawnSync(join(fixture, "node_modules/.bin/toy"), args, { cwd: fixture, encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024, ...(environment ? { env: environment } : {}) })
);
const invokeConcurrent = async (id: string, args: string[], exitCode: number) => {
  const child = spawn(join(fixture, "node_modules/.bin/toy"), args, { cwd: fixture, stdio: ["ignore", "pipe", "pipe"] });
  const stdout: Buffer[] = []; const stderr: Buffer[] = [];
  let bytes = 0; let error: Error | undefined;
  const timer = setTimeout(() => { error = new Error("CLI_TIMEOUT"); child.kill("SIGKILL"); }, 30000);
  const collect = (target: Buffer[], chunk: Buffer): void => {
    bytes += chunk.length;
    if (bytes > 2 * 1024 * 1024) { error = new Error("CLI_OUTPUT_LIMIT"); child.kill("SIGKILL"); }
    else target.push(chunk);
  };
  child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
  child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
  child.on("error", (failure) => { error = failure; });
  const status = await new Promise<number | null>((resolveStatus) => { child.on("close", resolveStatus); });
  clearTimeout(timer);
  return validateInvocation(id, args, exitCode, { stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), status, ...(error ? { error } : {}) });
};

try {
  for (const path of ["cli", "packages/contracts", "packages/ops", "node_modules/zod"]) {
    setup(["pack", join(root, path), "--pack-destination", fixture, "--ignore-scripts", "--offline", "--json"]);
  }
  await writeFile(join(fixture, "package.json"), JSON.stringify({ name: "toy-k3-offline-fixture", version: "1.0.0", private: true }) + "\n", { flag: "wx" });
  setup(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", join(fixture, "cache"), "./toy-cli-1.0.0.tgz", "./toy-contracts-1.0.0.tgz", "./toy-ops-1.0.0.tgz", "./zod-4.6.5.tgz"]);

  await test("compiled packed CLI offline inventory and protocol boundary", async (suite) => {
    await suite.test("online-backed journal transition preserves pre-existing blocked identity across processes", async () => {
      const historical: unknown = JSON.parse(await readFile(join(root, "build/evidence/R0.K3/attempts/2026-10-05T16-48-55.354Z-9974e8bc-29de-46f6-9144-bb6841df71de/receipts.json"), "utf8"));
      assert.ok(typeof historical === "object" && historical !== null && "receipts" in historical && Array.isArray(historical.receipts));
      const witness: unknown = historical.receipts.find((entry: unknown) => typeof entry === "object" && entry !== null && "id" in entry && entry.id === "journal-blocked-initial");
      assert.ok(typeof witness === "object" && witness !== null && "stdout" in witness && typeof witness.stdout === "string");
      const previous: unknown = JSON.parse(witness.stdout);
      const original = cliResultSchema.parse(previous);
      assert.ok(original.ok && original.commandId === "stack.up");
      const before = invoke("journal-before-version-transition", ["doctor", "--deep", "--json"], 5);
      assert.ok(before?.ok && before.commandId === "doctor");
      const beforeCheck = before.data.checks.find((check) => check.id === "bootstrap.journal");
      assert.ok(beforeCheck?.prerequisite);
      const beforeRead = bootstrapJournalReadSchema.parse(JSON.parse(beforeCheck.prerequisite));
      assert.equal(beforeRead.runtimeAdmissionAvailable, false);
      const args = ["--env", "test", "stack", "up", "--release", "R0", "--request-id", original.data.requestId, "--json"];
      const retried = invoke("journal-pre-existing-after-transition", args, 5);
      assert.ok(retried?.ok && retried.commandId === "stack.up");
      assert.deepEqual(retried.data, original.data);
      const after = invoke("journal-after-version-transition", ["doctor", "--deep", "--json"], 5);
      assert.ok(after?.ok && after.commandId === "doctor");
      const afterCheck = after.data.checks.find((check) => check.id === "bootstrap.journal");
      assert.ok(afterCheck?.prerequisite);
      const afterRead = bootstrapJournalReadSchema.parse(JSON.parse(afterCheck.prerequisite));
      assert.equal(afterCheck.state, "PASS");
      assert.equal(afterRead.storeVersion, "2");
      assert.equal(afterRead.storeId, beforeRead.storeId);
      assert.deepEqual(afterRead.counts, beforeRead.counts);
      assert.equal(afterRead.nextGeneration, beforeRead.nextGeneration);
      assert.equal(afterRead.backupVerified, true);
      assert.ok(afterRead.backupId && afterRead.backupArtifactDigest && afterRead.backupReceiptDigest && afterRead.migrationId && afterRead.preservedLogicalDigest);
      assert.ok(afterRead.preservedCounts && BigInt(afterRead.preservedCounts.operations) > 0n);
      assert.equal(afterRead.ownerCount, "0");
      assert.equal(afterRead.leaseCount, "0");
      assert.equal(afterRead.runtimeAdmissionAvailable, false);
      assert.equal(afterRead.protectedGlobalLeaseVerified, false);
      const final = invoke("journal-pre-existing-separate-retry", [...args, "--wait-ms", "120000"], 5);
      assert.ok(final?.ok && final.commandId === "stack.up");
      assert.deepEqual(final.data, original.data);
    });
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
      const requestId = randomUUID();
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
      const stack = invoke("registered-world-blocked", ["--env", "test", "stack", "up", "--release", "R0", "--request-id", requestId, "--world", "r0-bootstrap", "--json"], 5);
      assert.ok(stack?.ok && stack.commandId === "stack.up" && stack.data.operation.state === "blocked");
      assert.ok(stack.data.stackId);
      assert.equal(stack.data.result, null);
      cliCommandSchemas["stack.up"].result.parse(stack);
      const down = invoke("unattested-stack-down", [...testStack, "stack", "down", "--request-id", requestId, "--json"], 5);
      assert.ok(down && !down.ok && down.error.module === "ops" && down.error.code === "ATTESTATION_INVALID");
      cliCommandSchemas["stack.down"].result.parse(down);
    });
    await suite.test("durable blocked stack intent survives retries, concurrent calls and ambient path changes", async () => {
      const requestId = randomUUID();
      const args = ["--env", "test", "stack", "up", "--release", "R0", "--request-id", requestId, "--json"];
      const initial = invoke("journal-blocked-initial", args, 5);
      assert.ok(initial?.ok && initial.commandId === "stack.up");
      assert.equal(initial.data.operation.state, "blocked");
      assert.equal(initial.data.result, null);
      assert.ok(initial.data.stackId);
      const retry = invoke("journal-blocked-normalized-retry", [...args, "--world", "r0-bootstrap", "--wait-ms", "120000"], 5);
      assert.ok(retry?.ok && retry.commandId === "stack.up");
      assert.deepEqual(retry.data, initial.data);
      const uppercase = invoke("journal-blocked-uppercase-retry", args.map((arg) => arg === requestId ? requestId.toUpperCase() : arg), 5);
      assert.ok(uppercase?.ok && uppercase.commandId === "stack.up");
      assert.deepEqual(uppercase.data, initial.data);
      const ambientHome = join(fixture, "unused-home");
      const ambientTemporary = join(fixture, "unused-temporary");
      const ambient = invoke("journal-blocked-ambient-path-retry", args, 5, { ...process.env, HOME: ambientHome, TMPDIR: ambientTemporary });
      assert.ok(ambient?.ok && ambient.commandId === "stack.up");
      assert.deepEqual(ambient.data, initial.data);
      await assert.rejects(readFile(join(ambientHome, "Library/Application Support/ToyBootstrap/control/ops.db")));
      await assert.rejects(readFile(join(ambientTemporary, "ops.db")));
      for (const [flag, value] of [["--release", "R1"], ["--clock", "real"], ["--model", "supported"]] as const) {
        const changed = flag === "--release" ? args.map((arg) => arg === "R0" ? value : arg) : [...args, flag, value];
        const conflict = invoke("journal-blocked-conflict-" + flag, changed, 4);
        assert.ok(conflict && !conflict.ok && conflict.error.code === "CONFLICT");
      }
      const concurrentId = randomUUID();
      const concurrentArgs = args.map((arg) => arg === requestId ? concurrentId : arg);
      const pair = await Promise.all([invokeConcurrent("journal-concurrent-first", concurrentArgs, 5), invokeConcurrent("journal-concurrent-second", concurrentArgs, 5)]);
      const first = pair[0]; const second = pair[1];
      assert.ok(first?.ok && first.commandId === "stack.up" && second?.ok && second.commandId === "stack.up");
      assert.deepEqual(first.data, second.data);
      assert.notEqual(first.data.operation.operationId, initial.data.operation.operationId);
      assert.notEqual(first.data.stackId, initial.data.stackId);
      const down = invoke("journal-unattested-down", ["--env", "test", "--stack", initial.data.stackId, "stack", "down", "--request-id", randomUUID(), "--json"], 5);
      assert.ok(down && !down.ok && down.error.code === "ATTESTATION_INVALID");
      const retained = invoke("journal-blocked-retained-after-refusal", args, 5);
      assert.ok(retained?.ok && retained.commandId === "stack.up");
      assert.deepEqual(retained.data, initial.data);
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
        assert.equal(result.data.checks.length, serviceIdSchema.options.length + 6 + Number(deep) * 2);
        assert.equal(result.data.checks.filter((check) => check.state === "NOT_IMPLEMENTED").length, serviceIdSchema.options.length + 6);
        assert.ok(result.data.checks.every((check) => ["bootstrap.journal", "bootstrap.resource-admission"].includes(check.id) ? check.state !== "FAIL" : check.state !== "PASS" && check.links.recordRefs.length === 0));
        if (deep) {
          const check = result.data.checks.find((entry) => entry.id === "bootstrap.resource-admission");
          assert.ok(check?.prerequisite);
          const measured = bootstrapResourcePreflightSchema.parse(JSON.parse(check.prerequisite));
          assert.equal(check.nextCommandId, "stack.up");
          assert.equal(measured.samples.length, 1);
          assert.equal(measured.resourcePermitIssued, false);
          assert.equal(BigInt(measured.requiredAvailableBytes), BigInt(measured.jobNeedBytes) + 536870912n);
          assert.equal(measured.headroomSatisfied, measured.minimumAvailableBytes !== null && BigInt(measured.minimumAvailableBytes) >= BigInt(measured.requiredAvailableBytes));
          assert.equal(measured.normalPressureObserved, measured.samples.every((sample) => sample.pressure === "normal"));
          for (const sample of measured.samples) {
            if (sample.availableBytes === null) continue;
            assert.ok(sample.freeBytes !== null && sample.inactiveBytes !== null && sample.purgeableBytes !== null && sample.speculativeBytes !== null);
            assert.equal(BigInt(sample.availableBytes), BigInt(sample.freeBytes) + BigInt(sample.inactiveBytes) + BigInt(sample.purgeableBytes) + BigInt(sample.speculativeBytes));
          }
          assert.equal(measured.admissionState, measured.completeMeasurements && measured.normalPressureObserved && measured.headroomSatisfied ? "admitted" : "blocked");
          assert.equal(check.state, measured.admissionState === "admitted" ? "PASS" : "BLOCKED");
        }
      }
      invoke("status-human", ["status"], 5);
      invoke("doctor-human", ["doctor", "--deep"], 5);
      const unattested = invoke("status-unattested-stack", ["--env", "test", "--stack", "550e8400-e29b-41d4-a716-446655440000", "status", "--json"], 5);
      assert.ok(unattested && !unattested.ok && unattested.error.code === "ATTESTATION_INVALID");
    });
    await suite.test("deep doctor measures available pages within a bounded real-time deadline", () => {
      const started = process.hrtime.bigint();
      const result = invoke("doctor-resource-short-deadline", ["doctor", "--deep", "--timeout-ms", "1000", "--json"], 5);
      const elapsed = process.hrtime.bigint() - started;
      assert.ok(result?.ok && result.commandId === "doctor");
      const check = result.data.checks.find((entry) => entry.id === "bootstrap.resource-admission");
      assert.ok(check?.prerequisite);
      const measured = bootstrapResourcePreflightSchema.parse(JSON.parse(check.prerequisite));
      assert.equal(measured.resourcePermitIssued, false);
      assert.equal(measured.admissionState, measured.reasons.length === 0 ? "admitted" : "blocked");
      assert.equal(result.data.complete, false);
      assert.ok(elapsed < 5000000000n);
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
