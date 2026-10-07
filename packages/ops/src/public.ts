import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
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

const inspectPostgresArtifact = (remainingMs: number): CheckViewV1 => {
  const started = process.hrtime.bigint();
  const expectedVersion = "17.11";
  const selector = "/opt/homebrew/opt/postgresql@17/bin/initdb";
  const cellarPrefix = "/opt/homebrew/Cellar/postgresql@17/";
  const requiredOptions = ["--pgdata", "--encoding", "--locale", "--data-checksums", "--auth-local", "--auth-host", "--username"] as const;
  const allowedSignals: readonly string[] = ["SIGABRT", "SIGBUS", "SIGFPE", "SIGHUP", "SIGILL", "SIGINT", "SIGKILL", "SIGPIPE", "SIGQUIT", "SIGSEGV", "SIGTERM", "SIGTRAP"];
  let executablePath: string | null = null;
  let cellarVersion: string | null = null;
  let executableDigest: string | null = null;
  let observedVersion: string | null = null;
  let versionObservation = "unmeasured";
  let versionStatus: number | null = null;
  let versionSignal: string | null = null;
  let versionErrorCategory = "unmeasured";
  let versionCanonicalPrefix = false;
  let versionHomebrewSuffix = false;
  let helpObservation = "unmeasured";
  let supportedOptions: string[] = [];
  let receiptPath: string | null = null;
  let receiptDigest: string | null = null;
  let receiptObservation = "unmeasured";
  let reasonCode = "POSTGRES_ARTIFACT_UNAVAILABLE";
  const remaining = (): number => Math.max(0, remainingMs - Number((process.hrtime.bigint() - started) / 1000000n));
  const environment = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C" };
  try {
    const realUid = process.getuid?.();
    const effectiveUid = process.geteuid?.();
    if (process.platform !== "darwin" || process.arch !== "arm64") reasonCode = "POSTGRES_ARTIFACT_PLATFORM_UNSUPPORTED";
    else if (realUid === undefined || effectiveUid === undefined || realUid === 0 || effectiveUid === 0) reasonCode = "POSTGRES_ARTIFACT_ROOT_CALLER_REFUSED";
    else {
      executablePath = realpathSync(selector);
      const pathMatch = executablePath.startsWith(cellarPrefix) ? /^([A-Za-z0-9._+-]+)\/bin\/initdb$/.exec(executablePath.slice(cellarPrefix.length)) : null;
      const resolvedCellarVersion = pathMatch?.[1] ?? null;
      if (resolvedCellarVersion === null || !/^17\.11(?:_[0-9]+)?$/.test(resolvedCellarVersion)) reasonCode = "POSTGRES_ARTIFACT_PATH_OUTSIDE_PINNED_CELLAR_VERSION";
      else {
        cellarVersion = resolvedCellarVersion;
        const executableStat = lstatSync(executablePath);
        if (!executableStat.isFile() || executableStat.isSymbolicLink()) reasonCode = "POSTGRES_ARTIFACT_NOT_REGULAR_FILE";
        else {
          executableDigest = createHash("sha256").update(readFileSync(executablePath)).digest("hex");
          receiptPath = join(dirname(dirname(executablePath)), "INSTALL_RECEIPT.json");
          try {
            const receiptStat = lstatSync(receiptPath);
            if (!receiptStat.isFile() || receiptStat.isSymbolicLink() || receiptStat.size > 65536) receiptObservation = "invalid";
            else {
              receiptDigest = createHash("sha256").update(readFileSync(receiptPath)).digest("hex");
              receiptObservation = "observed";
            }
          } catch (error) {
            const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : null;
            receiptObservation = code === "ENOENT" ? "absent" : "unreadable";
          }
          const versionTimeout = Math.min(remaining(), 2500);
          const versionChild = versionTimeout > 0 ? spawnSync(executablePath, ["--version"], {
            cwd: "/", env: environment, encoding: "utf8", timeout: versionTimeout, killSignal: "SIGKILL", maxBuffer: 4096
          }) : null;
          const childStatus = versionChild?.status ?? null;
          const childSignal = versionChild?.signal ?? null;
          versionStatus = childStatus !== null && childStatus >= 0 && childStatus <= 255 ? childStatus : null;
          versionSignal = childSignal === null ? null : allowedSignals.includes(childSignal) ? childSignal : "OTHER";
          const versionErrorCode = versionChild?.error && "code" in versionChild.error && typeof versionChild.error.code === "string" ? versionChild.error.code : null;
          const versionOutput = versionChild?.status === 0 && !versionChild.error ? versionChild.stdout.trim() : null;
          versionCanonicalPrefix = versionOutput?.startsWith("initdb (PostgreSQL) ") ?? false;
          versionHomebrewSuffix = versionOutput?.endsWith(" (Homebrew)") ?? false;
          const versionMatch = versionOutput === null ? null : /^initdb \(PostgreSQL\) (\d+\.\d+(?:\.\d+)?)(?: \(Homebrew\))?$/.exec(versionOutput);
          observedVersion = versionMatch?.[1] ?? null;
          versionObservation = observedVersion === null ? "unavailable_or_unrecognized" : "observed";
          if (versionChild === null) versionErrorCategory = "budget_exhausted";
          else if (versionErrorCode === "ETIMEDOUT") versionErrorCategory = "timeout";
          else if (versionChild.error) versionErrorCategory = "spawn_error";
          else if (versionChild.status !== 0) versionErrorCategory = "nonzero_exit";
          else versionErrorCategory = observedVersion === null ? "unrecognized_output" : "observed";
          if (observedVersion !== expectedVersion) {
            if (versionErrorCategory === "timeout" || versionErrorCategory === "budget_exhausted") reasonCode = "POSTGRES_VERSION_READ_TIMEOUT";
            else if (versionErrorCategory === "spawn_error") reasonCode = "POSTGRES_VERSION_SPAWN_FAILED";
            else if (versionErrorCategory === "nonzero_exit") reasonCode = "POSTGRES_VERSION_COMMAND_FAILED";
            else reasonCode = observedVersion === null ? "POSTGRES_VERSION_OUTPUT_UNRECOGNIZED" : "POSTGRES_VERSION_MISMATCH";
          } else {
            const helpTimeout = Math.min(remaining(), 2500);
            const helpChild = helpTimeout > 0 ? spawnSync(executablePath, ["--help"], {
              cwd: "/", env: environment, encoding: "utf8", timeout: helpTimeout, killSignal: "SIGKILL", maxBuffer: 65536
            }) : null;
            const helpOutput = helpChild?.status === 0 && !helpChild.error ? helpChild.stdout + "\n" + helpChild.stderr : null;
            helpObservation = helpOutput === null ? "unavailable" : "observed";
            supportedOptions = helpOutput === null ? [] : requiredOptions.filter(option => helpOutput.includes(option));
            reasonCode = helpOutput === null ? "POSTGRES_HELP_NOT_OBSERVED"
              : supportedOptions.length !== requiredOptions.length ? "POSTGRES_REQUIRED_OPTION_NAMES_INCOMPLETE"
                : "POSTGRES_ARTIFACT_ONLY_SERVICE_READINESS_PENDING";
          }
        }
      }
    }
  } catch (error) {
    const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : null;
    reasonCode = code === "ENOENT" ? "POSTGRES_ARTIFACT_ABSENT" : code === "EACCES" || code === "EPERM" ? "POSTGRES_ARTIFACT_UNREADABLE" : "POSTGRES_ARTIFACT_READ_FAILED";
  }
  const descriptor = {
    expectedVersion, observedVersion, versionMatches: observedVersion === expectedVersion, executablePath, cellarVersion,
    executableSha256: executableDigest, versionObservation,
    versionDiagnostic: { status: versionStatus, signal: versionSignal, errorCategory: versionErrorCategory, canonicalPrefix: versionCanonicalPrefix, homebrewSuffix: versionHomebrewSuffix },
    helpObservation, requiredOptionNames: requiredOptions,
    observedOptionNames: supportedOptions, acquisitionReceipt: { state: receiptObservation, path: receiptPath, sha256: receiptDigest },
    artifactOnly: true, serviceReadiness: "blocked"
  };
  const artifactDigests = [executableDigest, receiptDigest].filter((digest): digest is string => digest !== null);
  return checkViewSchema.parse({
    id: "service.postgres", owner: "ops", state: "BLOCKED", checkedAt: new Date().toISOString(), reasonCode,
    prerequisite: JSON.stringify(descriptor), nextCommandId: "doctor",
    links: { recordRefs: [], observations: [], artifactDigests }
  });
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
      const postgresIndex = checks.findIndex((check) => check.id === "service.postgres");
      if (postgresIndex >= 0) checks[postgresIndex] = inspectPostgresArtifact(context.timeoutMs - Number((process.hrtime.bigint() - started) / 1000000n));
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
