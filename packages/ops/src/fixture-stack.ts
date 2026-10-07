import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  bootstrapUpRequestSchema, durableCadenceCheckInventory, fixtureStackRecordSchema, fixtureWorkerStateSchema, opsErrorMessages,
  schemaBundleDigest, testClockReceiptSchema, testClockStateSchema, testStackOperationSchema,
  registeredProbeOperationSchema, registeredCliProbeInventory, registeredCliAcceptanceManifestInventory, clockAdvanceOperationSchema, checkViewSchema, roleBootstrapRoot
} from "@toy/contracts";
import type {
  FixtureStackRecordV1, OpsControlContextV1, OpsErrorCode, Result, TestStackOperationV1, TestStackUpInputV1,
  TestStackDownInputV1, TestClockStateV1, TestClockReceiptV1, TestClockFreezeInputV1, TestClockAdvanceInputV1,
  TestClockResumeInputV1, ClockAdvanceOperationV1, RegisteredProbeInputV1, RegisteredProbeShowInputV1, RegisteredProbeOperationV1, CheckViewV1
} from "@toy/contracts";
import { findBlockedBootstrapUp } from "./bootstrap-journal.js";
import { measureBootstrapResources } from "./bootstrap-resources.js";
import { trustedCheckoutRoot } from "./checkout-root.js";

class FixtureRefusal extends Error {
  constructor(readonly code: OpsErrorCode) { super(code); }
}
const refuse = (code: OpsErrorCode): never => { throw new FixtureRefusal(code); };
const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const workerPath = join(import.meta.dirname, "fixture-worker.js");
const links = { recordRefs: [], observations: [], artifactDigests: [] };
const home = userInfo();
const fixtureRoot = (create = false): string => {
  if (home.uid !== 0) return join(trustedCheckoutRoot(), "build/.toy-r0-fixtures");
  const control = roleBootstrapRoot + "/control";
  const rootStat = lstatSync(roleBootstrapRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || rootStat.uid !== 0 || rootStat.gid !== 0 || (rootStat.mode & 0o022) !== 0) return refuse("ATTESTATION_INVALID");
  const stat = lstatSync(control);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o7777) !== 0o700) return refuse("ATTESTATION_INVALID");
  const tests = join(control, "protected-tests");
  if (!existsSync(tests)) {
    if (create) mkdirSync(tests, { mode: 0o700 });
  } else owned(tests, true);
  return join(tests, "r0-fixtures");
};
const owned = (path: string, directory = false): void => {
  const stat = lstatSync(path);
  if (stat.uid !== home.uid || (stat.mode & 0o077) !== 0 || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) refuse("ATTESTATION_INVALID");
};
const privateDirectory = (path: string): void => {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
  owned(path, true);
};
const newFile = (path: string, bytes = ""): void => {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); } finally { closeSync(fd); }
};
const decode = (value: unknown): unknown => {
  if (typeof value !== "string" || Buffer.byteLength(value) > 262144) return refuse("ATTESTATION_INVALID");
  try { const parsed: unknown = JSON.parse(value); return parsed; } catch { return refuse("ATTESTATION_INVALID"); }
};
const index = (create = false): DatabaseSync => {
  const root = fixtureRoot(create);
  if (create) privateDirectory(root); else owned(root, true);
  const path = join(root, "control.db");
  const fresh = !existsSync(path);
  if (fresh && create) newFile(path); else owned(path);
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout=1000");
  if (fresh) db.exec("CREATE TABLE stack (id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, record TEXT NOT NULL CHECK(json_valid(record))) STRICT");
  return db;
};
const worldPath = (id: string): string => join(fixtureRoot(), id);
const record = (db: DatabaseSync, stackId: string): FixtureStackRecordV1 => {
  const row = db.prepare("SELECT record FROM stack WHERE id=?").get(stackId);
  if (!row) return refuse("ATTESTATION_INVALID");
  const value = fixtureStackRecordSchema.parse(decode(row.record));
  if (value.stackId !== stackId || value.ownerUid !== home.uid) return refuse("ATTESTATION_INVALID");
  const path = worldPath(stackId); owned(path, true); owned(join(path, "manifest.json")); owned(join(path, "world.db"));
  const manifest = fixtureStackRecordSchema.parse(decode(readFileSync(join(path, "manifest.json"), "utf8")));
  if (manifest.nonce !== value.nonce || manifest.stackId !== value.stackId || manifest.request.requestId !== value.request.requestId
    || manifest.runtimeDigest !== value.runtimeDigest || manifest.schemaDigest !== value.schemaDigest || JSON.stringify(manifest.request) !== JSON.stringify(value.request)) refuse("ATTESTATION_INVALID");
  return value;
};
const world = (value: FixtureStackRecordV1): DatabaseSync => {
  const db = new DatabaseSync(join(worldPath(value.stackId), "world.db"));
  db.exec("PRAGMA busy_timeout=1000");
  return db;
};
const worker = (db: DatabaseSync, value: FixtureStackRecordV1) => {
  const row = db.prepare("SELECT receipt FROM worker WHERE singleton=1").get();
  if (!row) return null;
  const observed = fixtureWorkerStateSchema.parse(decode(row.receipt));
  if (observed.stackId !== value.stackId || observed.nonce !== value.nonce || value.pid !== null && observed.pid !== value.pid) refuse("ATTESTATION_INVALID");
  return observed;
};
const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return !(error instanceof Error && "code" in error && error.code === "ESRCH"); }
};
const view = (value: FixtureStackRecordV1, completeTeardown = false, startupResource: string | null = null): TestStackOperationV1 => {
  const ready = value.state === "running";
  return testStackOperationSchema.parse({
    operation: { ...value.operation, state: ready || completeTeardown ? "succeeded" : value.state === "starting" ? "running" : "blocked" },
    requestId: value.request.requestId, stackId: value.stackId, links,
    result: {
      stackId: value.stackId, release: "R0", manifestDigest: digest(readFileSync(join(worldPath(value.stackId), "manifest.json"))),
      clock: "fake", model: "fake", ready, evidenceLocation: value.evidenceId,
      components: [
        ...(value.resourcePreflight === undefined ? [] : [{ id: "bootstrap.resource-admission", owner: "ops", state: value.resourcePreflight.admissionState === "admitted" ? "PASS" : "BLOCKED",
          checkedAt: value.resourcePreflight.measuredAt, reasonCode: "AVAILABLE_MEMORY_AND_OBSERVED_PRESSURE", nextCommandId: "stack.up", prerequisite: JSON.stringify(value.resourcePreflight), links }]),
        { id: "bootstrap.fixture-runtime", owner: "ops", state: ready ? "PASS" : completeTeardown ? "PASS" : "BLOCKED",
          checkedAt: new Date().toISOString(), reasonCode: ready ? "TRUSTED_FAKE_FIXTURE_READY" : completeTeardown ? "OWNED_FIXTURE_STOPPED" : value.failureCode ?? "FIXTURE_UNAVAILABLE", links, nextCommandId: "stack.up", prerequisite: startupResource },
        { id: "bootstrap.fixture-identities", owner: "ops", state: "NOT_IMPLEMENTED", checkedAt: new Date().toISOString(),
          reasonCode: "R0_04_05_ACTUAL_PREREQUISITES_PENDING", links, nextCommandId: "doctor", prerequisite: "Actual protected service identities and signed target launcher remain pending." }
      ],
      ownedResourceRefs: [{ module: "ops", kind: "test_world", id: value.stackId }],
      teardown: completeTeardown ? { stackId: value.stackId, checkpointRefs: [], fenceRefs: [], stoppedResourceRefs: [{ module: "ops", kind: "test_world", id: value.stackId }], retainedArtifactRefs: [{ module: "ops", kind: "test_world", id: value.stackId }], unresolvedResourceRefs: [], complete: true } : null
    }
  });
};
const save = (db: DatabaseSync, value: FixtureStackRecordV1): void => { db.prepare("UPDATE stack SET record=? WHERE id=?").run(JSON.stringify(value), value.stackId); };
const failure = <T>(error: unknown): Result<T> => {
  const code = error instanceof FixtureRefusal ? error.code : "ATTESTATION_INVALID";
  return { ok: false, error: { module: "ops", code, message: opsErrorMessages[code], retryable: code === "TIMEOUT" } };
};
const selected = (context: OpsControlContextV1): string => {
  if (context.environment.kind !== "test") return refuse("UNAUTHORIZED");
  return context.environment.stackId ?? refuse("INVALID_INPUT");
};
const current = (value: FixtureStackRecordV1): void => {
  if (value.state !== "running" || value.schemaDigest !== schemaBundleDigest || value.runtimeDigest !== digest(readFileSync(workerPath))
    || Date.now() >= Date.parse(value.realExpiresAt)) refuse("ATTESTATION_INVALID");
};

export const fixtureStackUp = async (input: TestStackUpInputV1, context: OpsControlContextV1): Promise<Result<TestStackOperationV1>> => {
  const prior = home.uid === 0 ? null : findBlockedBootstrapUp(input, context.timeoutMs);
  if (prior) return prior;
  let db: DatabaseSync | undefined;
  let target: DatabaseSync | undefined;
  try {
    const supported = input.release === "R0" && input.clock === "fake" && input.model === "fake";
    if (!supported && !existsSync(fixtureRoot())) refuse("DEPENDENCY_UNAVAILABLE");
    const request = bootstrapUpRequestSchema.parse({ schemaVersion: "toy.bootstrap-up-request.v1", requestId: input.requestId.toLowerCase(), release: input.release, world: input.world ?? "r0-bootstrap", clock: input.clock, model: input.model, observedPressure: input.observedPressure });
    db = index(supported);
    db.exec("BEGIN IMMEDIATE");
    const existing = db.prepare("SELECT id,record FROM stack WHERE request_id=?").get(request.requestId);
    if (existing) {
      const old = fixtureStackRecordSchema.parse(decode(existing.record));
      if (JSON.stringify(old.request) !== JSON.stringify(request)) refuse("CONFLICT");
      db.exec("COMMIT");
      return { ok: true, data: view(record(db, old.stackId), old.state === "stopped") };
    }
    if (!supported) refuse("DEPENDENCY_UNAVAILABLE");
    const measured = await measureBootstrapResources(context.timeoutMs, 1073741824n, input.observedPressure);
    if (measured.admissionState !== "admitted") refuse(measured.completeMeasurements ? "MEMORY_PRESSURE" : "DEPENDENCY_UNAVAILABLE");
    const stackId = randomUUID(); const now = new Date().toISOString();
    const value = fixtureStackRecordSchema.parse({ schemaVersion: "toy.r0-fixture-stack.v1", stackId, request,
      operation: { operationId: randomUUID(), state: "queued", acceptedAt: now }, generation: "1", ownerUid: home.uid,
      nonce: randomUUID(), schemaDigest: schemaBundleDigest, runtimeDigest: digest(readFileSync(workerPath)), state: "starting", pid: null,
      createdAt: now, realExpiresAt: new Date(Date.now() + 7200000).toISOString(), evidenceId: randomUUID(), resourcePreflight: measured });
    const path = worldPath(stackId); privateDirectory(path); newFile(join(path, "manifest.json"), JSON.stringify(value)); newFile(join(path, "world.db"));
    target = world(value);
    target.exec("CREATE TABLE control (singleton INTEGER PRIMARY KEY CHECK(singleton=1), stop INTEGER NOT NULL CHECK(stop IN (0,1))); INSERT INTO control VALUES (1,0); CREATE TABLE worker (singleton INTEGER PRIMARY KEY CHECK(singleton=1), receipt TEXT NOT NULL CHECK(json_valid(receipt))); CREATE TABLE clock (singleton INTEGER PRIMARY KEY CHECK(singleton=1), state TEXT NOT NULL CHECK(json_valid(state))); CREATE TABLE request (id TEXT PRIMARY KEY, digest TEXT NOT NULL, receipt TEXT NOT NULL CHECK(json_valid(receipt))) STRICT");
    const clock = testClockStateSchema.parse({ stackId, revision: "0", virtualWall: "2026-10-05T00:00:00.000Z", awakeSeconds: "0", activeSeconds: "0", realMonotonicMs: String(process.hrtime.bigint() / 1000000n), frozen: true, pendingWorkRefs: [], coverage: { policyDigest: schemaBundleDigest, requiredAiEverySeconds: 180, periods: [], pendingRunRefs: [] } });
    target.prepare("INSERT INTO clock VALUES (1,?)").run(JSON.stringify(clock));
    db.prepare("INSERT INTO stack VALUES (?,?,?)").run(stackId, request.requestId, JSON.stringify(value));
    db.exec("COMMIT");
    const reads = [dirname(import.meta.dirname), dirname(dirname(fileURLToPath(import.meta.resolve("@toy/contracts")))), dirname(fileURLToPath(import.meta.resolve("zod"))), path];
    for (const packageId of ["@toy/contracts", "zod"]) {
      for (const location of createRequire(import.meta.url).resolve.paths(packageId) ?? []) {
        const packageRoot = join(location, packageId);
        if (existsSync(join(packageRoot, "package.json"))) reads.push(packageRoot);
      }
    }
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--max-old-space-size=128", "--permission", ...reads.map(read => "--allow-fs-read=" + read), "--allow-fs-write=" + path, workerPath, path], {
      env: { HOME: path, TMPDIR: path, LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" }, stdio: ["ignore", "ignore", "pipe"], detached: true
    });
    let spawnFailed = false; let closed = false; let diagnostic = "";
    child.stderr.on("data", (bytes: Buffer) => { if (diagnostic.length < 8192) diagnostic += bytes.toString("utf8").slice(0, 8192 - diagnostic.length); });
    child.on("error", () => { spawnFailed = true; }); child.on("close", () => { closed = true; }); child.unref();
    const deadline = process.hrtime.bigint() + BigInt(Math.min(context.timeoutMs, 5000)) * 1000000n;
    while (process.hrtime.bigint() < deadline && !spawnFailed && !closed) {
      const observed = worker(target, value);
      if (observed?.state === "running" && child.pid === observed.pid) {
        const ready = fixtureStackRecordSchema.parse({ ...value, state: "running", pid: observed.pid }); save(db, ready);
        child.stderr.destroy();
        return { ok: true, data: view(ready) };
      }
      await delay(25);
    }
    target.exec("UPDATE control SET stop=1 WHERE singleton=1");
    const failureCode = spawnFailed ? "SPAWN_FAILED" : diagnostic.includes("ERR_ACCESS_DENIED")
      ? diagnostic.includes("package.json") ? "PACKAGE_METADATA_DENIED"
        : diagnostic.includes("zod") ? "ZOD_READ_DENIED"
          : diagnostic.includes("contracts") ? "CONTRACTS_READ_DENIED"
            : diagnostic.includes(path) ? "WORLD_READ_DENIED" : "RUNTIME_READ_DENIED"
      : diagnostic.includes("MODULE_NOT_FOUND") ? "MODULE_NOT_FOUND"
        : diagnostic.includes("ZodError") ? "SCHEMA_INVALID"
          : diagnostic.includes("SQLITE") ? "SQLITE_FAILURE" : closed ? "UNKNOWN_EXIT" : "STARTUP_TIMEOUT";
    const failed = fixtureStackRecordSchema.parse({ ...value, state: "failed", pid: child.pid ?? null, failureCode });
    save(db, failed);
    const deniedResource = /resource: '([^'\n]{1,512})'/.exec(diagnostic)?.[1];
    const packageResource = deniedResource?.endsWith("/package.json") ? deniedResource.replace(home.homedir, "~") : null;
    return { ok: true, data: view(failed, false, packageResource) };
  } catch (error) { if (target) target.exec("UPDATE control SET stop=1 WHERE singleton=1"); if (db?.isTransaction) db.exec("ROLLBACK"); return failure(error); }
  finally { target?.close(); db?.close(); }
};

export const fixtureStackDown = async (input: TestStackDownInputV1, context: OpsControlContextV1): Promise<Result<TestStackOperationV1>> => {
  let db: DatabaseSync | undefined; let target: DatabaseSync | undefined;
  try {
    db = index(); const value = record(db, selected(context)); target = world(value);
    const key = "stack.down:" + input.requestId; const hash = digest(JSON.stringify({ stackId: value.stackId, requestId: input.requestId }));
    const existing = target.prepare("SELECT digest,receipt FROM request WHERE id=?").get(key);
    if (existing) { if (existing.digest !== hash) refuse("CONFLICT"); return { ok: true, data: testStackOperationSchema.parse(decode(existing.receipt)) }; }
    const observed = worker(target, value);
    if (observed === null && (value.state !== "failed" || value.pid !== null && alive(value.pid))) refuse("ATTESTATION_INVALID");
    if (observed !== null && value.pid !== null && value.pid !== observed.pid) refuse("ATTESTATION_INVALID");
    const pid = observed?.pid ?? value.pid;
    target.exec("UPDATE control SET stop=1 WHERE singleton=1");
    const deadline = process.hrtime.bigint() + BigInt(Math.min(context.timeoutMs, 5000)) * 1000000n;
    while (pid !== null && alive(pid) && process.hrtime.bigint() < deadline) await delay(25);
    if (pid !== null && alive(pid)) {
      const incomplete = view(value);
      const stopObservation = JSON.stringify({ processPresent: alive(pid), worker: worker(target, value) });
      return { ok: true, data: testStackOperationSchema.parse({ ...incomplete, requestId: input.requestId,
        operation: { ...incomplete.operation, state: "blocked" }, result: { ...incomplete.result, ready: false,
          components: incomplete.result?.components.map(check => check.id === "bootstrap.fixture-runtime" ? { ...check, state: "BLOCKED", reasonCode: "FIXTURE_STOP_NOT_CONFIRMED", prerequisite: stopObservation } : check) } }) };
    }
    const stopped = fixtureStackRecordSchema.parse({ ...value, state: "stopped" }); save(db, stopped);
    const receipt = testStackOperationSchema.parse({ ...view(stopped, true), requestId: input.requestId,
      operation: { operationId: randomUUID(), state: "succeeded", acceptedAt: new Date().toISOString() } });
    target.prepare("INSERT INTO request VALUES (?,?,?)").run(key, hash, JSON.stringify(receipt));
    return { ok: true, data: receipt };
  } catch (error) { return failure(error); } finally { target?.close(); db?.close(); }
};

export const fixtureStackInspect = (context: OpsControlContextV1): Result<TestStackOperationV1> => {
  let db: DatabaseSync | undefined; let target: DatabaseSync | undefined;
  try {
    db = index(); const value = record(db, selected(context)); current(value); target = world(value);
    const observed = worker(target, value);
    if (!observed || observed.state !== "running" || !alive(observed.pid) || Date.now() - Date.parse(observed.checkedAt) > 2000) refuse("ATTESTATION_INVALID");
    return { ok: true, data: view(value) };
  } catch (error) { return failure(error); } finally { target?.close(); db?.close(); }
};

const clockRead = (db: DatabaseSync): TestClockStateV1 => {
  const value = testClockStateSchema.parse(decode(db.prepare("SELECT state FROM clock WHERE singleton=1").get()?.state));
  if (value.frozen) return value;
  const now = process.hrtime.bigint() / 1000000n; const elapsed = now - BigInt(value.realMonotonicMs);
  return testClockStateSchema.parse({ ...value, virtualWall: new Date(Date.parse(value.virtualWall) + Number(elapsed)).toISOString(), realMonotonicMs: String(now) });
};
const clockCall = <T>(context: OpsControlContextV1, body: (db: DatabaseSync, value: FixtureStackRecordV1) => T): Result<T> => {
  let db: DatabaseSync | undefined; let target: DatabaseSync | undefined;
  try { db = index(); const value = record(db, selected(context)); current(value); target = world(value); const observed = worker(target, value); if (!observed || observed.state !== "running" || !alive(observed.pid) || Date.now() - Date.parse(observed.checkedAt) > 2000) return refuse("ATTESTATION_INVALID"); target.exec("BEGIN IMMEDIATE"); const result = body(target, value); target.exec("COMMIT"); return { ok: true, data: result }; }
  catch (error) { if (target?.isTransaction) target.exec("ROLLBACK"); return failure(error); }
  finally { target?.close(); db?.close(); }
};
const clockChange = (command: string, input: TestClockFreezeInputV1 | TestClockAdvanceInputV1 | TestClockResumeInputV1, context: OpsControlContextV1): Result<TestClockReceiptV1> => clockCall(context, db => {
  const key = "clock:" + input.requestId; const hash = digest(JSON.stringify({ command, ...input, ...("waitMs" in input ? { waitMs: 0 } : {}) }));
  const old = db.prepare("SELECT digest,receipt FROM request WHERE id=?").get(key);
  if (old) { if (old.digest !== hash) refuse("CONFLICT"); return testClockReceiptSchema.parse(decode(old.receipt)); }
  const before = clockRead(db); let virtualWall = before.virtualWall;
  let elapsedSeconds = 0n;
  if ("at" in input) virtualWall = input.at;
  if ("by" in input) {
    const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d{1,3})?)S)?)?$/.exec(input.by);
    if (!match) refuse("INVALID_INPUT");
    const seconds = match?.[4]?.split(".");
    const millis = BigInt(match?.[1] ?? "0") * 86400000n + BigInt(match?.[2] ?? "0") * 3600000n + BigInt(match?.[3] ?? "0") * 60000n + BigInt(seconds?.[0] ?? "0") * 1000n + BigInt((seconds?.[1] ?? "").padEnd(3, "0"));
    if (millis > 8640000000000000n - BigInt(Date.parse(before.virtualWall))) refuse("INVALID_INPUT");
    virtualWall = new Date(Date.parse(before.virtualWall) + Number(millis)).toISOString(); elapsedSeconds = millis / 1000n;
  }
  const after = testClockStateSchema.parse({ ...before, revision: String(BigInt(before.revision) + 1n), virtualWall,
    awakeSeconds: String(BigInt(before.awakeSeconds) + elapsedSeconds), activeSeconds: String(BigInt(before.activeSeconds) + elapsedSeconds),
    realMonotonicMs: String(process.hrtime.bigint() / 1000000n), frozen: command === "freeze" ? true : command === "resume" ? false : before.frozen });
  const receipt = testClockReceiptSchema.parse({ requestId: input.requestId, before, after, barrierRef: { module: "ops", kind: "test_clock_barrier", id: randomUUID() } });
  db.prepare("UPDATE clock SET state=? WHERE singleton=1").run(JSON.stringify(after)); db.prepare("INSERT INTO request VALUES (?,?,?)").run(key, hash, JSON.stringify(receipt));
  return receipt;
});
export const FixtureClock = {
  get: (context: OpsControlContextV1): Result<TestClockStateV1> => clockCall(context, db => clockRead(db)),
  freeze: (input: TestClockFreezeInputV1, context: OpsControlContextV1): Result<TestClockReceiptV1> => clockChange("freeze", input, context),
  resume: (input: TestClockResumeInputV1, context: OpsControlContextV1): Result<TestClockReceiptV1> => clockChange("resume", input, context),
  advance(input: TestClockAdvanceInputV1, context: OpsControlContextV1): Result<ClockAdvanceOperationV1> {
    const result = clockChange("advance", input, context);
    if (!result.ok) return result;
    return clockCall(context, (db, value) => {
      const key = "clock-operation:" + input.requestId;
      const old = db.prepare("SELECT receipt FROM request WHERE id=?").get(key);
      if (old) return clockAdvanceOperationSchema.parse(decode(old.receipt));
      const operation = clockAdvanceOperationSchema.parse({ operation: { operationId: result.data.barrierRef.id, state: "succeeded", acceptedAt: new Date().toISOString() }, requestId: input.requestId, stackId: value.stackId, result: result.data, links, requestedThrough: result.data.after.virtualWall, reachedAt: result.data.after.virtualWall, barrier: "settled", unsettledRefs: [] });
      db.prepare("INSERT INTO request VALUES (?,?,?)").run(key, digest(JSON.stringify(input)), JSON.stringify(operation));
      return operation;
    });
  }
};
export const FixtureProbe = {
  run(input: RegisteredProbeInputV1, context: OpsControlContextV1, observations: readonly CheckViewV1[] = []): Result<RegisteredProbeOperationV1> {
    return clockCall(context, (db, value) => {
      const key = "probe:" + input.requestId; const hash = digest(JSON.stringify(input)); const old = db.prepare("SELECT digest,receipt FROM request WHERE id=?").get(key);
      if (old) { if (old.digest !== hash) refuse("CONFLICT"); return registeredProbeOperationSchema.parse(decode(old.receipt)); }
      const registered = registeredCliProbeInventory.find(entry => entry.id === input.probeId);
      if (!registered) refuse("INVALID_INPUT");
      const sourceRegistration = registeredCliAcceptanceManifestInventory.find(entry => entry.id === input.probeId);
      const lifecycle = (input.probeId === "AT-cli-4" || input.probeId === "AT-hermes-config-100") && (input.caseId === undefined || input.caseId === "stack-lifecycle");
      const checks = observations.map(check => checkViewSchema.parse(check));
      const reference = input.probeId === "AT-hermes-config-101" && ["k4a-connector", "k4a-tool", "k4a-skill"].includes(input.caseId ?? "");
      const modelPolicy = (input.caseId === "model-route-policy" && ["AT-hermes-config-1", "AT-hermes-config-76", "AT-hermes-config-77"].includes(input.probeId)) || (input.caseId === undefined && sourceRegistration?.owner === "hermes" && ["model-route.roles", "delegation.route-skill"].includes(sourceRegistration.scenarioId));
      const modelStream = input.caseId === "model-route-stream" && ["AT-hermes-config-40", "AT-self-improvement-58"].includes(input.probeId);
      const profileConsumers = input.caseId === undefined && sourceRegistration?.owner === "hermes" && sourceRegistration.scenarioId === "profile.gateway-consumers";
      const mcpHttp = input.caseId === undefined && sourceRegistration?.owner === "hermes" && sourceRegistration.scenarioId === "profile.mcp-http";
      const accounting = (input.caseId === undefined || input.caseId === "model-admission") && ["AT-ops-10", "AT-ops-11", "AT-ops-49", "AT-ops-50", "AT-ops-51", "AT-ops-52"].includes(input.probeId);
      const componentComparison = ["AT-authority-60", "AT-attention-66", "AT-obligations-74", "AT-self-improvement-54", "AT-sources-188", "AT-sources-190", "AT-ops-44", "AT-ops-45", "AT-lifestore-45", "AT-workflows-1"].includes(input.probeId) && input.caseId === undefined;
      const dtoRoundtrip = input.probeId === "AT-hermes-config-50" && input.caseId === undefined && sourceRegistration?.owner === "contracts" && sourceRegistration.scenarioId === "contracts.dto-roundtrip";
      const buildInventory = input.probeId === "AT-authority-61" && input.caseId === undefined && sourceRegistration?.owner === "ops" && sourceRegistration.scenarioId === "build.source-inventory";
      const leastFragileTools = input.probeId === "AT-adhd-features-106" && input.caseId === undefined && sourceRegistration?.owner === "self-improvement" && sourceRegistration.scenarioId === "engineering.least-fragile-tools";
      const capacityTrial = (input.caseId === undefined || input.caseId === "capacity-trial") && ["AT-ops-47", "AT-self-improvement-59", "AT-self-improvement-60", "AT-RESEARCH-REGISTER-6"].includes(input.probeId);
      const durableCadence = (input.caseId === undefined || input.caseId === "durable-cadence-owner-floor") && ["AT-hermes-config-69", "AT-activity-focus-86"].includes(input.probeId) && sourceRegistration?.owner === "self-improvement" && sourceRegistration.scenarioId === "cadence.owner-floor";
      const nativeEligibility = ["AT-ops-81", "AT-client-apps-49", "AT-activity-focus-64"].includes(input.probeId) && (input.caseId === "native-release-eligibility" || (input.caseId === undefined && sourceRegistration?.owner === "ops" && sourceRegistration.scenarioId === "native-release-eligibility"));
      const nativeAuth = (input.caseId === undefined && sourceRegistration?.owner === "hermes" && sourceRegistration.kind === "behavioral" && sourceRegistration.scenarioId.startsWith("auth.")) || (input.caseId === "native-auth-cli" && ["AT-hermes-config-84", "AT-hermes-config-85", "AT-hermes-config-86", "AT-hermes-config-87", "AT-hermes-config-88", "AT-hermes-config-89", "AT-hermes-config-91", "AT-hermes-config-78", "AT-ops-55"].includes(input.probeId));
      const roleDenials = (input.caseId === undefined || input.caseId === "control-filesystem-denial") && input.probeId === "AT-authority-35";
      const queueFaults = input.probeId === "AT-obligations-76" && (input.caseId === undefined || input.caseId === "queue-transaction-faults");
      const backupCapacity = ["AT-ops-62", "AT-lifestore-63", "AT-sources-216"].includes(input.probeId) && (input.caseId === "backup-capacity" || (input.caseId === undefined && sourceRegistration?.owner === "ops" && sourceRegistration.scenarioId === "backup-capacity"));
      if (checks.length > 0 && !reference && !(modelPolicy || modelStream || profileConsumers || mcpHttp || accounting || componentComparison || dtoRoundtrip || buildInventory || leastFragileTools || capacityTrial || durableCadence || nativeEligibility || nativeAuth || backupCapacity || roleDenials || queueFaults)) refuse("INVALID_INPUT");
      if (buildInventory && checks.some(check => check.id !== "build.source-inventory" || check.owner !== "ops")) refuse("INVALID_INPUT");
      if (leastFragileTools && checks.some(check => check.id !== "engineering.least-fragile-tools" || check.owner !== "self-improvement")) refuse("INVALID_INPUT");
      if (dtoRoundtrip && checks.some(check => check.id !== "contracts.dto-roundtrip" || check.owner !== "contracts")) refuse("INVALID_INPUT");
      if (profileConsumers && checks.some(check => check.id !== "profile.native-gateway" || check.owner !== "hermes")) refuse("INVALID_INPUT");
      if (mcpHttp && checks.some(check => check.id !== "profile.native-mcp-http" || check.owner !== "hermes")) refuse("INVALID_INPUT");
      if ((modelPolicy || modelStream) && checks.some(check => check.id !== "read.model-route-policy" || check.owner !== "hermes")) refuse("INVALID_INPUT");
      if (accounting && checks.some(check => check.id !== "accounting.model-admission" || check.owner !== "self-improvement")) refuse("INVALID_INPUT");
      if (componentComparison && checks.some(check => check.id !== "research.component-comparison" || check.owner !== "self-improvement")) refuse("INVALID_INPUT");
      if (capacityTrial && checks.some(check => check.id !== "capacity.trial-journal" || check.owner !== "self-improvement")) refuse("INVALID_INPUT");
      if (durableCadence && (checks.length !== durableCadenceCheckInventory.length || new Set(checks.map(check => check.id)).size !== durableCadenceCheckInventory.length || checks.some(check => !durableCadenceCheckInventory.some(declaration => declaration.id === check.id && declaration.owner === check.owner)))) refuse("INVALID_INPUT");
      if (nativeEligibility && checks.some(check => check.id !== "release.native-eligibility" || check.owner !== "ops")) refuse("INVALID_INPUT");
      if (nativeAuth && checks.some(check => !["auth.native-runtime", "auth.native-fixture"].includes(check.id) || check.owner !== "hermes")) refuse("INVALID_INPUT");
      if (roleDenials && checks.some(check => check.id !== "bootstrap.role-control-denials" || check.owner !== "ops")) refuse("INVALID_INPUT");
      if (queueFaults && checks.some(check => check.id !== "queue.obligation-faults" || check.owner !== "ops")) refuse("INVALID_INPUT");
      if (backupCapacity && checks.some(check => check.id !== "backup.capacity" || check.owner !== "ops")) refuse("INVALID_INPUT");
      if (input.probeId === "AT-hermes-config-101" && input.caseId === "k4a-migration") {
        const sql = readFileSync(join(dirname(import.meta.dirname), "migrations/0001-k4a-reference.sql"));
        const descriptor = readFileSync(join(dirname(import.meta.dirname), "migrations/0001-k4a-reference.json"));
        if (digest(sql) !== "937f34c9c347e6306cc39a30f8910eade7ae539d17823627b57e645dd24a4e22" || digest(descriptor) !== "0dd2c45c2d1810d6fd93e510b417a866d59b3e2751e14b8bd51fb45d0e433839") refuse("ATTESTATION_INVALID");
        if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='k4a_reference_marker'").get()) db.exec(sql.toString("utf8"));
        db.prepare("INSERT OR IGNORE INTO k4a_reference_marker VALUES (?,?)").run("R0.K4a", "ops");
        const readback = db.prepare("SELECT reference_id,owner FROM k4a_reference_marker WHERE reference_id=?").get("R0.K4a");
        checks.push(checkViewSchema.parse({ id: "bootstrap.reference.migration", owner: "ops", state: readback?.owner === "ops" ? "PASS" : "FAIL", checkedAt: new Date().toISOString(), reasonCode: "DISPOSABLE_OWNER_MIGRATION_READBACK", prerequisite: JSON.stringify({ migrationId: "ops.k4a.reference.0001", schema: "main", readback }), nextCommandId: "probe.show", links: { ...links, artifactDigests: [digest(sql), digest(descriptor)] } }));
      }
      const implemented = lifecycle || checks.length > 0;
      const caseManifestDigest = digest(JSON.stringify({ probeId: input.probeId, caseId: input.caseId ?? sourceRegistration?.scenarioId ?? "stack-lifecycle", source: registered, sourceRegistration: sourceRegistration ?? null, artifacts: checks.flatMap(check => check.links.artifactDigests) }));
      const observed = worker(db, value);
      const operation = registeredProbeOperationSchema.parse({ operation: { operationId: randomUUID(), state: implemented ? "succeeded" : "blocked", acceptedAt: new Date().toISOString() }, requestId: input.requestId, stackId: value.stackId, links,
        probeId: input.probeId, binding: { releaseDigest: value.runtimeDigest, controlDigest: value.runtimeDigest, schemaDigest: value.schemaDigest, fixtureDigest: digest(readFileSync(join(worldPath(value.stackId), "manifest.json"))) }, caseManifestDigest, result: { probeId: input.probeId, caseManifestDigest, ...(sourceRegistration === undefined ? {} : { sourceRegistration }), state: "NOT_IMPLEMENTED", complete: false, links, cases: checks.length > 0 ? checks : [{ id: "bootstrap.fixture-runtime", owner: "ops", state: implemented && observed?.state === "running" ? "PASS" : "BLOCKED", checkedAt: new Date().toISOString(), reasonCode: implemented ? "TRUSTED_FIXTURE_LIFECYCLE_SUBSET" : "REGISTERED_CASE_NOT_IMPLEMENTED", nextCommandId: "probe.show", links, prerequisite: JSON.stringify(observed) }] } });
      db.prepare("INSERT INTO request VALUES (?,?,?)").run(key, hash, JSON.stringify(operation));
      return operation;
    });
  },
  show(input: RegisteredProbeShowInputV1, context: OpsControlContextV1): Result<RegisteredProbeOperationV1> {
    return clockCall(context, db => {
      const rows = db.prepare("SELECT receipt FROM request WHERE id LIKE 'probe:%'").all();
      for (const row of rows) { const value = registeredProbeOperationSchema.parse(decode(row.receipt)); if (value.operation.operationId === input.operationId) return value; }
      return refuse("ATTESTATION_INVALID");
    });
  }
};
