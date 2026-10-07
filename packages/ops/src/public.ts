import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { trustedToolEnvironment } from "./checkout-root.js";
import {
  capabilityViewSchema, checkViewSchema, cliDeclarations, controlStatusInputSchema, controlStatusSchema, doctorInputSchema, doctorReportSchema,
  evidenceLinksSchema, installedCodexRuntimeSchema, opsControlContextSchema, opsControlReadInventory, opsErrorMessages, opsTestStackResultSchema,
  releaseSchema, secretReadinessSchema, serviceIdSchema, testStackDownInputSchema, testStackUpInputSchema
} from "@toy/contracts";
import type {
  CheckViewV1, ControlStatusInputV1, ControlStatusV1, DoctorInputV1, DoctorReportV1, OpsControlContextV1, OpsErrorCode, Release,
  FilePatchV1, Result, TestStackDownInputV1, TestStackOperationV1, TestStackUpInputV1
} from "@toy/contracts";
export type { ModuleId } from "@toy/contracts";
export { trustedCheckoutRoot, trustedToolEnvironment } from "./checkout-root.js";
export { RoleIdentityBootstrap } from "./identity-bootstrap.js";
import { inspectBootstrapJournal } from "./bootstrap-journal.js";
import { inspectBuildInventory } from "./build-inventory.js";
import { inspectCodexProtocol } from "./codex-protocol.js";
import { measureBootstrapResources } from "./bootstrap-resources.js";
import { inspectRoleIdentities } from "./role-identities.js";
import { BackupCapacity } from "./backup-capacity.js";
import { fixtureStackUp, fixtureStackDown, fixtureStackInspect, FixtureClock, FixtureProbe } from "./fixture-stack.js";
export { FixtureClock as TestClockControl, FixtureProbe as TestProbeControl };

const inspectCodexRuntime = (remainingMs: number): CheckViewV1 => {
  const started = process.hrtime.bigint();
  let executable: string | null = null;
  let observedVersion: string | null = null;
  let executableDigest: string | null = null;
  let reasonCode = "CODEX_RUNTIME_UNAVAILABLE";
  try {
    executable = realpathSync("/Users/johansardar/.local/bin/codex");
    executableDigest = createHash("sha256").update(readFileSync(executable)).digest("hex");
    const environment = trustedToolEnvironment();
    const child = remainingMs > 0 ? spawnSync(executable, ["--version"], { encoding: "utf8", timeout: Math.min(remainingMs, 3000), maxBuffer: 4096, env: { ...environment, CODEX_HOME: join(environment.HOME, "provider-version") } }) : null;
    const match = child?.status === 0 && !child.error ? /^codex-cli (\d+\.\d+\.\d+)\s*$/.exec(child.stdout) : null;
    observedVersion = match?.[1] ?? null;
    reasonCode = observedVersion === "0.160.0" ? "CODEX_PIN_MATCH_INFERENCE_PENDING" : observedVersion === null ? "CODEX_VERSION_NOT_OBSERVED" : "CODEX_PIN_MISMATCH";
  } catch { reasonCode = "CODEX_RUNTIME_UNAVAILABLE"; }
  const protocol = inspectCodexProtocol(observedVersion === "0.160.0" && executable !== null ? executable : "", observedVersion === "0.160.0" ? remainingMs - Number((process.hrtime.bigint() - started) / 1000000n) : 0);
  const measured = installedCodexRuntimeSchema.parse({ expectedVersion: "0.160.0", observedVersion, executableDigest, versionMatches: observedVersion === "0.160.0", protocol, inferenceAttested: false, authorizationInspected: false, paidFallbackPermitted: false });
  return checkViewSchema.parse({ id: "read.model-route", owner: "ops", state: measured.versionMatches ? "PASS" : "BLOCKED", checkedAt: new Date().toISOString(), reasonCode, prerequisite: JSON.stringify(measured), nextCommandId: "probe.run", links: { recordRefs: [], observations: [], artifactDigests: executableDigest === null ? [] : [executableDigest] } });
};

const unavailableSnapshot = (release: Release, context: OpsControlContextV1): ControlStatusV1 => {
  opsControlContextSchema.parse(context);
  const evaluatedAt = new Date().toISOString();
  const links = evidenceLinksSchema.parse({ recordRefs: [], observations: [], artifactDigests: [] });
  const probes = opsControlReadInventory.map((probe) => checkViewSchema.parse({
    ...probe, state: "NOT_IMPLEMENTED", checkedAt: evaluatedAt, reasonCode: "OWNER_TRANSPORT_NOT_IMPLEMENTED",
    prerequisite: "Verified installed-service manifest and authenticated public owner transport are required.", links
  }));
  const capabilities = cliDeclarations.map((declaration) => capabilityViewSchema.parse({
    id: declaration.featureIds[0], firstRelease: declaration.firstRelease,
    required: releaseSchema.options.indexOf(declaration.firstRelease) <= releaseSchema.options.indexOf(release),
    implementation: declaration.implementation, state: "NOT_IMPLEMENTED", tested: false, installed: false, deployed: false,
    checkedAt: evaluatedAt, prerequisite: "Current digest-bound acceptance, installation and deployment records are required.", links
  }));
  const secrets = serviceIdSchema.options.map((serviceId) => secretReadinessSchema.parse({ serviceId, state: "unknown", checkedAt: evaluatedAt, expiresAt: null }));
  return controlStatusSchema.parse({
    requiredRelease: release, ops: null, probes, sources: null, attention: null, quota: null, cadence: null, release: null,
    secrets, capabilities, complete: false
  });
};

export const OpsControlRead = {
  validateBuildInventory(context: OpsControlContextV1, testSources: readonly FilePatchV1[] = []): Result<CheckViewV1[]> {
    return inspectBuildInventory(context, testSources);
  },
  status(input: ControlStatusInputV1, context: OpsControlContextV1): Promise<ControlStatusV1> {
    const request = controlStatusInputSchema.parse(input);
    const snapshot = unavailableSnapshot(request.release ?? "R0", context);
    if (context.environment.kind === "test") {
      const fixture = fixtureStackInspect(context);
      if (fixture.ok && fixture.data.result) snapshot.probes.push(...fixture.data.result.components);
    }
    return Promise.resolve(controlStatusSchema.parse(snapshot));
  },
  async doctor(input: DoctorInputV1, context: OpsControlContextV1, ownerReads: readonly CheckViewV1[] = []): Promise<DoctorReportV1> {
    const started = process.hrtime.bigint();
    const request = doctorInputSchema.parse(input);
    const snapshot = unavailableSnapshot(request.release ?? "R0", context);
    const checks = [...snapshot.probes];
    if (request.deep) for (const supplied of ownerReads) {
      const read = checkViewSchema.parse(supplied);
      if (read.id !== "read.model-route-policy" || read.owner !== "hermes") throw new Error("OWNER_READ_NOT_REGISTERED");
      const index = checks.findIndex(check => check.id === read.id);
      if (index >= 0) checks[index] = read;
    }
    if (context.environment.kind === "test") {
      const fixture = fixtureStackInspect(context);
      if (fixture.ok && fixture.data.result) checks.push(...fixture.data.result.components);
    }
    if (request.deep) {
      const inventory = inspectBuildInventory(context, []);
      if (inventory.ok) checks.push(...inventory.data);
      else checks.push(checkViewSchema.parse({ id: "build.source-inventory", owner: "ops", state: "FAIL", checkedAt: new Date().toISOString(), reasonCode: inventory.error.code, prerequisite: "Actual source inventory could not be validated.", nextCommandId: "probe.run", links: { recordRefs: [], observations: [], artifactDigests: [] } }));
      const runtime = inspectCodexRuntime(context.timeoutMs - Number((process.hrtime.bigint() - started) / 1000000n));
      const runtimeIndex = checks.findIndex((check) => check.id === "read.model-route");
      if (runtimeIndex >= 0) checks[runtimeIndex] = runtime;
      checks.push(inspectBootstrapJournal(context.timeoutMs - Number((process.hrtime.bigint() - started) / 1000000n)));
      checks.push(inspectRoleIdentities(context.timeoutMs - Number((process.hrtime.bigint() - started) / 1000000n)));
      const storage = BackupCapacity.inspect(context.timeoutMs - Number((process.hrtime.bigint() - started) / 1000000n));
      checks.push(checkViewSchema.parse({
        id: "backup.local-inventory", owner: "ops", state: storage.localCapacityState === "measured" ? "PASS" : "BLOCKED",
        checkedAt: storage.observedAt, reasonCode: "LOCAL_CAPACITY_REMOTE_AND_RESTORE_PENDING", nextCommandId: "probe.run",
        prerequisite: JSON.stringify(storage), links: { recordRefs: [], observations: [], artifactDigests: [] }
      }));
      const measured = await measureBootstrapResources(context.timeoutMs - Number((process.hrtime.bigint() - started) / 1000000n));
      checks.push(checkViewSchema.parse({
        id: "bootstrap.resource-admission", owner: "ops", state: measured.admissionState === "admitted" ? "PASS" : "BLOCKED", checkedAt: measured.measuredAt,
        reasonCode: measured.reasons.join(",") || "MEMORY_ADMITTED", nextCommandId: "stack.up", links: { recordRefs: [], observations: [], artifactDigests: [] },
        prerequisite: JSON.stringify(measured)
      }));
    }
    return doctorReportSchema.parse({
      requiredRelease: snapshot.requiredRelease, deep: request.deep, checks, verdict: checks.some((check) => check.state === "FAIL") ? "FAIL" : "NOT_IMPLEMENTED",
      complete: false, links: { recordRefs: [], observations: [], artifactDigests: [] }
    });
  }
};

const unavailableStack = (code: OpsErrorCode): Result<TestStackOperationV1> => opsTestStackResultSchema.parse({
  ok: false, error: { module: "ops", code, retryable: false, message: opsErrorMessages[code] }
});

export const OpsTestStack = {
  up(input: TestStackUpInputV1, context: OpsControlContextV1): Promise<Result<TestStackOperationV1>> {
    if (!testStackUpInputSchema.safeParse(input).success || !opsControlContextSchema.safeParse(context).success) {
      return Promise.resolve(unavailableStack("INVALID_INPUT"));
    }
    if (context.environment.kind !== "test") return Promise.resolve(unavailableStack("UNAUTHORIZED"));
    if (context.environment.stackId !== null) return Promise.resolve(unavailableStack("INVALID_INPUT"));
    if (input.observedPressure !== undefined && (input.release !== "R0" || input.clock !== "fake" || input.model !== "fake")) return Promise.resolve(unavailableStack("INVALID_INPUT"));
    return fixtureStackUp(input, context);
  },
  down(input: TestStackDownInputV1, context: OpsControlContextV1): Promise<Result<TestStackOperationV1>> {
    if (!testStackDownInputSchema.safeParse(input).success || !opsControlContextSchema.safeParse(context).success) {
      return Promise.resolve(unavailableStack("INVALID_INPUT"));
    }
    if (context.environment.kind !== "test") return Promise.resolve(unavailableStack("UNAUTHORIZED"));
    if (context.environment.stackId === null) return Promise.resolve(unavailableStack("INVALID_INPUT"));
    return fixtureStackDown(input, context);
  },
  inspect(context: OpsControlContextV1): Result<TestStackOperationV1> {
    if (!opsControlContextSchema.safeParse(context).success) return unavailableStack("INVALID_INPUT");
    return fixtureStackInspect(context);
  }
};

export { ModelAdmissionPolicy } from "./model-admission-policy.js";
export { NativeReleaseEligibilityPolicy } from "./native-release-eligibility.js";
export { NativeReleaseEligibilityProbe } from "./native-release-eligibility-probe.js";
export { BackupCapacity } from "./backup-capacity.js";
export { BackupCapacityProbe } from "./backup-capacity-probe.js";

export { RoleControlProbe } from "./role-control-probe.js";
export { QueueFaultProbe } from "./queue-fault-probe.js";

