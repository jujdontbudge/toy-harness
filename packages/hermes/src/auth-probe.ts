import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { checkViewSchema, hermesPublicRuntimeCommandSchema, installedHermesDependencyRecordSchema, opsErrorMessages, registeredCliAcceptanceManifestInventory, registeredProbeInputSchema } from "@toy/contracts";
import type { OpsControlContextV1, RegisteredProbeInputV1, RegisteredProbeOperationV1, Result } from "@toy/contracts";
import { OpsTestStack, TestProbeControl, trustedCheckoutRoot, trustedToolEnvironment } from "@toy/ops/public";
import { runHermesAuthFixture } from "./auth-fixture.js";

const installedRoot = "/Users/johansardar/.hermes/hermes-agent";
const installedCommit = "8d5e3e412138342e8bf30443e72bd4e6a9abd057";
const launcher = join(installedRoot, ".hermes/bin/hermes");
const digest = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");

export const HermesAuthProbe = {
  async run(input: RegisteredProbeInputV1, context: OpsControlContextV1): Promise<Result<RegisteredProbeOperationV1>> {
    const started = process.hrtime.bigint();
    const invalid: Result<RegisteredProbeOperationV1> = { ok: false, error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false } };
    const unfilteredAuth = ["AT-hermes-config-84", "AT-hermes-config-85", "AT-hermes-config-86", "AT-hermes-config-87", "AT-hermes-config-88", "AT-hermes-config-89", "AT-hermes-config-90", "AT-hermes-config-91"].includes(input.probeId) && input.caseId === undefined;
    if (!registeredProbeInputSchema.safeParse(input).success || (!unfilteredAuth && input.caseId !== "native-auth-cli") || !["AT-hermes-config-84", "AT-hermes-config-85", "AT-hermes-config-86", "AT-hermes-config-87", "AT-hermes-config-88", "AT-hermes-config-89", "AT-hermes-config-90", "AT-hermes-config-91", "AT-hermes-config-78", "AT-ops-55"].includes(input.probeId)) return Promise.resolve(invalid);
    if (input.probeId === "AT-hermes-config-90") {
      const manifest = registeredCliAcceptanceManifestInventory.find(entry => entry.id === input.probeId);
      const mandatoryCases = ["dashboard-profile-success", "dashboard-fresh-profile-use", "dashboard-save-failure-400"].map(id => ({ id, publicOperation: "HermesAuthProbe.run", phase: id }));
      const faultControls = [{ id: "profile-auth-atomic-replace-eio", seam: "os", affectedPhases: ["dashboard-save-failure-400"] }];
      if (!manifest || manifest.owner !== "hermes" || manifest.scenarioId !== "auth.dashboard-scope" || manifest.kind !== "behavioral" || JSON.stringify(manifest.mandatoryCases) !== JSON.stringify(mandatoryCases) || JSON.stringify(manifest.faultControls) !== JSON.stringify(faultControls)) return Promise.resolve({ ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } });
    }
    if (input.probeId === "AT-hermes-config-86") {
      const manifest = registeredCliAcceptanceManifestInventory.find(entry => entry.id === input.probeId);
      const cases = ["root-add-one", "root-add-two", "root-readback-one", "root-readback-two", "profile-add-one", "profile-add-two", "profile-add-new", "profile-readback-one", "profile-readback-two", "profile-readback-new", "profile-priority-one", "profile-use-one", "profile-priority-two", "profile-use-two", "profile-priority-new", "profile-use-new"];
      const mandatoryCases = cases.map(id => ({ id, publicOperation: "HermesAuthProbe.run", phase: id }));
      if (!manifest || manifest.owner !== "hermes" || manifest.scenarioId !== "auth.siblings" || manifest.kind !== "behavioral" || JSON.stringify(manifest.mandatoryCases) !== JSON.stringify(mandatoryCases)) return Promise.resolve({ ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } });
    }
    if (input.probeId === "AT-hermes-config-88") {
      const manifest = registeredCliAcceptanceManifestInventory.find(entry => entry.id === input.probeId);
      const mandatoryCases = ["root-add", "borrowed-list", "borrowed-use", "borrowed-refresh", "profile-reload", "root-reload"].map(id => ({ id, publicOperation: "HermesAuthProbe.run", phase: id }));
      if (!manifest || manifest.owner !== "hermes" || manifest.scenarioId !== "auth.borrowed-refresh" || manifest.kind !== "behavioral" || JSON.stringify(manifest.mandatoryCases) !== JSON.stringify(mandatoryCases)) return Promise.resolve({ ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } });
    }
    if (input.probeId === "AT-hermes-config-89") {
      const manifest = registeredCliAcceptanceManifestInventory.find(entry => entry.id === input.probeId);
      const mandatoryCases = ["root-add", "copied-lineage-heal", "copied-lineage-use", "copied-lineage-refresh", "copied-lineage-reload", "independent-manual-add", "independent-profile-readback", "independent-profile-use", "independent-profile-refresh", "independent-profile-reload"].map(id => ({ id, publicOperation: "HermesAuthProbe.run", phase: id }));
      const faultControls = [{ id: "mixed-root-auth-store-copy", seam: "os", affectedPhases: ["copied-lineage-heal"] }, { id: "mixed-access-token-expiry", seam: "clock", affectedPhases: ["copied-lineage-refresh", "independent-profile-refresh"] }];
      if (!manifest || manifest.owner !== "hermes" || manifest.scenarioId !== "auth.mixed-lineage" || manifest.kind !== "behavioral" || JSON.stringify(manifest.mandatoryCases) !== JSON.stringify(mandatoryCases) || JSON.stringify(manifest.faultControls) !== JSON.stringify(faultControls)) return Promise.resolve({ ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } });
    }
    if (input.probeId === "AT-hermes-config-91") {
      const manifest = registeredCliAcceptanceManifestInventory.find(entry => entry.id === input.probeId);
      const cases = ["root-add", "profile-add-target", "profile-add-sibling", "profile-initial-readback", "priority-reorder-target", "priority-target-rate-limit", "reset-exhausted-readback", "reset-target", "reset-target-readback", "reset-target-refresh", "reset-target-reload", "remove-target", "remove-fresh-readback", "remove-sibling-fresh-use", "root-final-readback", "root-fresh-use"];
      const mandatoryCases = cases.map(id => ({ id, publicOperation: "HermesAuthProbe.run", phase: id }));
      const faultControls = [
        { id: "lifecycle-target-rate-limit", seam: "provider", affectedPhases: ["priority-target-rate-limit", "reset-exhausted-readback"] },
        { id: "expired-access-after-target-reset", seam: "clock", affectedPhases: ["reset-target-refresh"] },
        { id: "temporary-store-boundary", seam: "os", affectedPhases: ["root-add", "profile-add-target", "profile-add-sibling", "remove-target"] }
      ];
      if (!manifest || manifest.owner !== "hermes" || manifest.scenarioId !== "auth.lifecycle" || manifest.kind !== "behavioral" || JSON.stringify(manifest.mandatoryCases) !== JSON.stringify(mandatoryCases) || JSON.stringify(manifest.faultControls) !== JSON.stringify(faultControls)) return Promise.resolve({ ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } });
    }
    if (input.probeId === "AT-hermes-config-87") {
      const manifest = registeredCliAcceptanceManifestInventory.find(entry => entry.id === input.probeId);
      const mandatoryCases = ["add-first", "refresh-first", "before-replace", "after-replace"].map(id => ({ id, publicOperation: "HermesAuthProbe.run", phase: id }));
      if (!manifest || manifest.scenarioId !== "auth.concurrent-persistence" || JSON.stringify(manifest.mandatoryCases) !== JSON.stringify(mandatoryCases)) return Promise.resolve({ ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } });
    }
    if (input.probeId === "AT-hermes-config-84") {
      const manifest = registeredCliAcceptanceManifestInventory.find(entry => entry.id === input.probeId);
      const phases = ["add-enospc", "add-replace-fault"];
      const mandatoryCases = phases.map(id => ({ id, publicOperation: "hermes --profile toy auth add openai-codex --type oauth --no-browser", phase: id }));
      const faults = [{ id: "profile-store-enospc", seam: "os", affectedPhases: ["add-enospc"] }, { id: "profile-auth-atomic-replace-eio", seam: "os", affectedPhases: ["add-replace-fault"] }];
      if (!manifest || manifest.scenarioId !== "auth.save-fault" || JSON.stringify(manifest.mandatoryCases) !== JSON.stringify(mandatoryCases) || JSON.stringify(manifest.faultControls) !== JSON.stringify(faults)) return Promise.resolve({ ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } });
    }
    const owned = OpsTestStack.inspect(context);
    if (!owned.ok) return Promise.resolve(owned);
    const snapshot = owned.data.result;
    if (!snapshot?.ready || snapshot.release !== "R0" || snapshot.clock !== "fake" || snapshot.model !== "fake") return Promise.resolve(invalid);
    try {
      const home = mkdtempSync(join(trustedCheckoutRoot(), "build/.toy-r0-fixtures", snapshot.stackId, "native-auth-runtime-"));
      const hermesHome = join(home, "hermes");
      const scratch = join(home, "scratch");
      mkdirSync(hermesHome, { mode: 0o700 });
      mkdirSync(scratch, { mode: 0o700 });
      const environment = { ...trustedToolEnvironment(), HOME: home, HERMES_HOME: hermesHome, TMPDIR: scratch };
      const pin = spawnSync("/usr/bin/git", ["-C", installedRoot, "rev-parse", "HEAD"], { encoding: "utf8", timeout: Math.min(context.timeoutMs, 3000), maxBuffer: 4096, env: environment, cwd: home });
      if (pin.error || pin.status !== 0 || pin.stdout.trim() !== installedCommit) return Promise.resolve({ ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } });
      const launcherDigest = digest(readFileSync(launcher));
      const installState = join("/Users/johansardar/.hermes/installs", digest(realpathSync(installedRoot)).slice(0, 16));
      const facts: unknown = JSON.parse(readFileSync(join(installState, "facts.json"), "utf8"));
      const record = installedHermesDependencyRecordSchema.parse(facts);
      const generation = realpathSync(record.packages.venv.environment);
      const generationRoot = realpathSync(join(installState, "environments"));
      const generationRelative = relative(generationRoot, generation);
      if (!generationRelative || generationRelative.startsWith("..") || isAbsolute(generationRelative) || !statSync(join(generation, "pyvenv.cfg")).isFile()) return Promise.resolve({ ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } });
      const interpreter = join(generation, "bin/python3");
      const interpreterDigest = digest(readFileSync(interpreter));
      const commandBudgetMs = context.timeoutMs - Number((process.hrtime.bigint() - started) / 1000000n);
      if (commandBudgetMs <= 0) return Promise.resolve({ ok: false, error: { module: "ops", code: "DEPENDENCY_UNAVAILABLE", message: opsErrorMessages.DEPENDENCY_UNAVAILABLE, retryable: true } });
      const command = spawnSync(launcher, ["--print-runtime-command", "--", "--help"], { encoding: "utf8", timeout: Math.min(commandBudgetMs, 3000), maxBuffer: 32768, env: environment, cwd: home });
      if (command.error || command.status !== 0) return Promise.resolve({ ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } });
      const rawCommand: unknown = JSON.parse(command.stdout);
      const publicCommand = hermesPublicRuntimeCommandSchema.parse(rawCommand);
      if (publicCommand.length !== 5 || publicCommand[1] !== "-I" || publicCommand[2] !== "-c" || publicCommand[4] !== "--help") return Promise.resolve({ ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } });
      const remainingMs = context.timeoutMs - Number((process.hrtime.bigint() - started) / 1000000n);
      const child = remainingMs > 0 ? spawnSync(interpreter, ["-B", ...publicCommand.slice(1)], { encoding: "utf8", timeout: Math.min(remainingMs, 10000), maxBuffer: 32768, env: environment, cwd: home }) : null;
      const publicHelpObserved = child !== null && child.status === 0 && !child.error && /^usage:\s+hermes\b/m.test(child.stdout);
      const permissionDenied = /PermissionError|Operation not permitted|Permission denied|install state is not writable/.test(child?.stderr ?? "");
      const dependencyEnvironmentUnavailable = /dependency environment|site-packages|managed Python|preparing dependencies/.test(child?.stderr ?? "");
      const missingModule = /ModuleNotFoundError: No module named/.test(child?.stderr ?? "");
      const repairSuggested = /run `hermes pm repair`/.test(child?.stderr ?? "");
      const sourceUpdateIncomplete = /source-update completion failed|source update.*unfinished|source update completion failed/.test(child?.stderr ?? "");
      const reasonCode = publicHelpObserved ? "NATIVE_PUBLIC_CLI_READY_AUTH_PENDING" : permissionDenied ? "NATIVE_CLI_PERMISSION_DENIED" : dependencyEnvironmentUnavailable ? "NATIVE_DEPENDENCY_ENVIRONMENT_UNAVAILABLE" : missingModule ? "NATIVE_MODULE_UNAVAILABLE" : child === null || child.error ? "NATIVE_CLI_EXECUTION_UNAVAILABLE" : "NATIVE_PUBLIC_CLI_HELP_NOT_OBSERVED";
      const check = checkViewSchema.parse({
        id: "auth.native-runtime", owner: "hermes", state: publicHelpObserved ? "PASS" : "BLOCKED", checkedAt: new Date().toISOString(), reasonCode, nextCommandId: "probe.show",
        prerequisite: JSON.stringify({ interface: "hermes --help", installedCommit, launcherDigest, interpreterSource: "existing-committed-venv", interpreterDigest, publicRuntimeCommandDigest: digest(command.stdout), bytecodeWritesDisabled: true, isolatedHome: true, inheritedProviderEnvironment: false, publicHelpObserved, childExitCode: child?.status ?? null, childSignal: child?.signal ?? null, outputDigest: digest(child?.stdout ?? ""), errorOutputDigest: digest(child?.stderr ?? ""), dependencyEnvironmentUnavailable, missingModule, repairSuggested, sourceUpdateIncomplete, authExecuted: false, credentialInspected: false, wholeATComplete: false }),
        links: { recordRefs: [], observations: [], artifactDigests: [launcherDigest, interpreterDigest, digest(readFileSync(new URL("./auth-probe.js", import.meta.url)))] }
      });
      const fixtureBudgetMs = context.timeoutMs - Number((process.hrtime.bigint() - started) / 1000000n);
      const checks = [check];
      if (publicHelpObserved && fixtureBudgetMs > 0 && input.probeId === "AT-hermes-config-85") checks.push(...await runHermesAuthFixture(interpreter, home, hermesHome, fixtureBudgetMs));
      if (publicHelpObserved && fixtureBudgetMs > 0 && input.probeId === "AT-hermes-config-86") checks.push(...await runHermesAuthFixture(interpreter, home, hermesHome, fixtureBudgetMs, "add", "profile-siblings"));
      if (publicHelpObserved && fixtureBudgetMs > 0 && input.probeId === "AT-hermes-config-88") checks.push(...await runHermesAuthFixture(interpreter, home, hermesHome, fixtureBudgetMs, "add", "borrowed-root"));
      if (publicHelpObserved && fixtureBudgetMs > 0 && input.probeId === "AT-hermes-config-89") checks.push(...await runHermesAuthFixture(interpreter, home, hermesHome, fixtureBudgetMs, "add", "mixed-lineage"));
      if (publicHelpObserved && fixtureBudgetMs > 0 && input.probeId === "AT-hermes-config-90") checks.push(...await runHermesAuthFixture(interpreter, home, hermesHome, fixtureBudgetMs, "add", "dashboard-scope"));
      if (publicHelpObserved && fixtureBudgetMs > 0 && input.probeId === "AT-hermes-config-91") checks.push(...await runHermesAuthFixture(interpreter, home, hermesHome, fixtureBudgetMs, "add", "lifecycle"));
      if (publicHelpObserved && fixtureBudgetMs > 0 && input.probeId === "AT-hermes-config-87") {
        checks.push(...await runHermesAuthFixture(interpreter, home, hermesHome, fixtureBudgetMs, "concurrent-refresh-add"));
        const contentionBudgetMs = context.timeoutMs - Number((process.hrtime.bigint() - started) / 1000000n);
        if (contentionBudgetMs > 0) {
          const contentionHome = mkdtempSync(join(home, "single-grant-contention-"));
          const contentionHermesHome = join(contentionHome, "hermes");
          mkdirSync(contentionHermesHome, { mode: 0o700 });
          checks.push(...await runHermesAuthFixture(interpreter, contentionHome, contentionHermesHome, contentionBudgetMs, "concurrent-refresh-add", "single-grant-concurrency"));
        } else {
          checks.push(checkViewSchema.parse({ id: "auth.native-fixture", owner: "hermes", state: "FAIL", checkedAt: new Date().toISOString(), reasonCode: "NATIVE_AUTH_SINGLE_GRANT_DEADLINE_EXCEEDED", nextCommandId: "probe.show", prerequisite: JSON.stringify({ caseId: "refresh-first", isolatedSingleGrant: true, expiredPathEntered: false, wholeATComplete: false }), links: { recordRefs: [], observations: [], artifactDigests: [] } }));
        }
      }
      if (publicHelpObserved && fixtureBudgetMs > 0 && ["AT-hermes-config-78", "AT-ops-55"].includes(input.probeId)) checks.push(...await runHermesAuthFixture(interpreter, home, hermesHome, fixtureBudgetMs, "siwc-unbound"));
      if (publicHelpObserved && input.probeId === "AT-hermes-config-84") {
        for (const phase of ["add-enospc", "add-replace-fault"] as const) {
          const storageHome = mkdtempSync(join(home, "storage-fault-"));
          const storageHermesHome = join(storageHome, "hermes");
          mkdirSync(storageHermesHome, { mode: 0o700 });
          const storageBudgetMs = context.timeoutMs - Number((process.hrtime.bigint() - started) / 1000000n);
          checks.push(...await runHermesAuthFixture(interpreter, storageHome, storageHermesHome, storageBudgetMs, phase));
        }
      }
      return Promise.resolve(TestProbeControl.run(input, context, checks));
    } catch { return Promise.resolve({ ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } }); }
  }
};
