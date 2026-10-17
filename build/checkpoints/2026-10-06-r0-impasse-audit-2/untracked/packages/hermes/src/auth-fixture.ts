import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { checkViewSchema, hermesAuthFixtureResultSchema, hermesPublicRuntimeCommandSchema } from "@toy/contracts";
import type { CheckViewV1, HermesAuthFixtureResultV1 } from "@toy/contracts";
import { trustedCheckoutRoot, trustedToolEnvironment } from "@toy/ops/public";

const installedRoot = "/Users/johansardar/.hermes/hermes-agent";
const installedCommit = "8d5e3e412138342e8bf30443e72bd4e6a9abd057";
const maxArchiveBytes = 268435456;
const maxChildBytes = 65536;
const fixtureModule = "tests.fixtures.toy_auth_httpx_fixture";
type FixtureOperation = HermesAuthFixtureResultV1["observations"]["phase"];

const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const isWithin = (base: string, target: string): boolean => {
  const path = relative(base, target);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
};

const publicArgv = (operation: FixtureOperation): string[] => {
  const prefix = ["hermes", "--profile", "toy"];
  if (operation.startsWith("add")) return [...prefix, "auth", "add", "openai-codex", "--type", "oauth", "--no-browser"];
  if (operation.startsWith("list")) return [...prefix, "auth", "list", "openai-codex"];
  return [...prefix, "chat", "--provider", operation === "siwc-unbound" ? "siwc_responses" : "openai-codex", "--model", "gpt-6.1-sol", "--toolsets", "none", "-q", "Return the fixed fixture marker."];
};

const storeDigest = (path: string, privateRoot: string): { exists: boolean; digest: string | null } => {
  try {
    const stat = lstatSync(path);
    const resolved = realpathSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || !isWithin(privateRoot, resolved)) throw new Error("PRIVATE_STORE_PATH_INVALID");
    return { exists: true, digest: digest(readFileSync(resolved)) };
  } catch (error) {
    if (error instanceof Error && "code" in error && typeof error.code === "string" && error.code === "ENOENT") return { exists: false, digest: null };
    throw error;
  }
};

const privateStoreDigests = (hermesHome: string): { rootAuth: { exists: boolean; digest: string | null }; rootEnv: { exists: boolean; digest: string | null }; profileAuth: { exists: boolean; digest: string | null } } => {
  const privateRoot = realpathSync(hermesHome);
  return {
    rootAuth: storeDigest(join(hermesHome, "auth.json"), privateRoot),
    rootEnv: storeDigest(join(hermesHome, ".env"), privateRoot),
    profileAuth: storeDigest(join(hermesHome, "profiles", "toy", "auth.json"), privateRoot)
  };
};

const check = (state: CheckViewV1["state"], reasonCode: string, prerequisite: unknown, artifactDigests: string[]): CheckViewV1 => checkViewSchema.parse({
  id: "auth.native-fixture",
  owner: "hermes",
  state,
  checkedAt: new Date().toISOString(),
  reasonCode,
  prerequisite: JSON.stringify(prerequisite),
  nextCommandId: "probe.show",
  links: { recordRefs: [], observations: [], artifactDigests: [...new Set(artifactDigests)] }
});

export const runHermesAuthFixture = (interpreter: string, home: string, hermesHome: string, timeoutMs: number, firstOperation: FixtureOperation = "add"): CheckViewV1[] => {
  const started = process.hrtime.bigint();
  const remainingMs = (): number => timeoutMs - Number((process.hrtime.bigint() - started) / 1000000n);
  const evidence: Record<string, unknown> = { wholeATComplete: false, fixtureSubsetComplete: false };
  let artifacts: string[] = [];
  const operationChecks: CheckViewV1[] = [];
  const fail = (state: CheckViewV1["state"], reason: string, extra: Record<string, unknown> = {}): CheckViewV1[] => [...operationChecks, check(state, reason, { ...evidence, ...extra, wholeATComplete: false }, artifacts)];

  try {
    if (!["add", "add-enospc", "add-replace-fault", "siwc-unbound"].includes(firstOperation)) return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_OPERATION_INVALID");
    const siwcUnbound = firstOperation === "siwc-unbound";
    const saveFault = firstOperation === "add-enospc" || firstOperation === "add-replace-fault";
    const deniedGrant = saveFault || siwcUnbound;
    const operations: readonly FixtureOperation[] = siwcUnbound ? [firstOperation] : saveFault ? [firstOperation, "list-after-fault", "chat-after-fault"] : ["add", "list", "chat", "chat-expired", "chat-reloaded"];
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_TIMEOUT_INVALID");
    const homeRoot = realpathSync(home);
    const hermesRoot = realpathSync(hermesHome);
    if (!isWithin(homeRoot, hermesRoot) || !statSync(homeRoot).isDirectory() || !statSync(hermesRoot).isDirectory()) return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_PRIVATE_HOME_INVALID");
    const checkout = trustedCheckoutRoot();
    const profilePatch = join(checkout, siwcUnbound ? "patches/hermes-siwc.patch" : "patches/hermes-profile-auth.patch");
    const fixturePatch = join(checkout, "patches/hermes-auth-fixture.patch");
    const profilePatchDigest = digest(readFileSync(profilePatch));
    const fixturePatchDigest = digest(readFileSync(fixturePatch));
    artifacts = [profilePatchDigest, fixturePatchDigest, digest(readFileSync(new URL("./auth-fixture.js", import.meta.url)))];
    const scratch = join(homeRoot, "scratch");
    mkdirSync(scratch, { recursive: true, mode: 0o700 });
    const environment = {
      ...trustedToolEnvironment(),
      HOME: homeRoot,
      HERMES_HOME: hermesRoot,
      TMPDIR: scratch,
      TIRITH_ENABLED: "false",
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONNOUSERSITE: "1"
    };
    const bounded = (file: string, args: string[], maxBuffer: number, capMs: number, input?: Buffer, cwd = homeRoot) => {
      const budget = remainingMs();
      if (budget <= 0) return { timedOut: true as const, result: null };
      const result = spawnSync(file, args, {
        cwd,
        env: environment,
        timeout: Math.max(1, Math.min(budget, capMs)),
        maxBuffer,
        input
      });
      return { timedOut: false as const, result };
    };
    const gitPin = bounded("/usr/bin/git", ["-C", installedRoot, "rev-parse", "HEAD"], 4096, 3000);
    if (gitPin.timedOut || !gitPin.result || gitPin.result.error || gitPin.result.status !== 0 || gitPin.result.stdout.toString("utf8").trim() !== installedCommit) return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_PIN_UNAVAILABLE", { installedCommit });
    const archive = bounded("/usr/bin/git", ["-C", installedRoot, "archive", "--format=tar.gz", installedCommit], maxArchiveBytes, 30000);
    if (archive.timedOut || !archive.result || archive.result.error || archive.result.status !== 0) return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_ARCHIVE_UNAVAILABLE", { installedCommit, archiveExitCode: archive.result?.status ?? null, archiveSignal: archive.result?.signal ?? null, archiveOutputBytes: archive.result?.stdout.length ?? 0, archiveErrorDigest: digest(archive.result?.stderr ?? "") });
    const archiveBytes = archive.result.stdout;
    const archiveDigest = digest(archiveBytes);
    const candidate = join(homeRoot, "candidate");
    mkdirSync(candidate, { mode: 0o700 });
    const candidateRoot = realpathSync(candidate);
    if (!isWithin(homeRoot, candidateRoot) || archiveBytes.length > maxArchiveBytes) return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_ARCHIVE_INVALID", { installedCommit, archiveDigest });
    const extracted = bounded("/usr/bin/tar", ["-x", "-f", "-", "-C", candidateRoot, "--no-same-owner", "--no-same-permissions"], maxChildBytes, 15000, archiveBytes);
    if (extracted.timedOut || !extracted.result || extracted.result.error || extracted.result.status !== 0) return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_ARCHIVE_EXTRACTION_FAILED", { installedCommit, archiveDigest });
    for (const patchPath of [profilePatch, fixturePatch]) {
      const applied = bounded("/usr/bin/patch", ["-p1", "--forward", "--input", patchPath], maxChildBytes, 10000, undefined, candidateRoot);
      if (applied.timedOut || !applied.result || applied.result.error || applied.result.status !== 0) return fail("FAIL", "NATIVE_AUTH_FIXTURE_PATCH_REJECTED", { installedCommit, archiveDigest });
    }
    const candidateStore = join(candidateRoot, "hermes_cli", "_launchers.py");
    if (!statSync(candidateStore).isFile()) return fail("FAIL", "NATIVE_AUTH_FIXTURE_PUBLIC_LAUNCHER_MISSING", { installedCommit, archiveDigest });
    const storesBefore = privateStoreDigests(hermesRoot);
    const profileCreateArgs = ["profile", "create", "toy", "--no-skills"];
    const profileCreateRequest = bounded(interpreter, ["-B", "-I", candidateStore, "--print-runtime-command", "--module", "hermes_cli.main", "--", ...profileCreateArgs], maxChildBytes, 5000);
    if (profileCreateRequest.timedOut || !profileCreateRequest.result || profileCreateRequest.result.error || profileCreateRequest.result.status !== 0) return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_PROFILE_CREATE_COMMAND_UNAVAILABLE", { installedCommit, archiveDigest });
    const rawProfileCreateCommand: unknown = JSON.parse(profileCreateRequest.result.stdout.toString("utf8"));
    const profileCreateCommand = hermesPublicRuntimeCommandSchema.parse(rawProfileCreateCommand);
    const [profileCreateInterpreter, profileCreateIsolation, profileCreateExecution, profileCreateBootstrap] = profileCreateCommand;
    if (profileCreateCommand.length !== 4 + profileCreateArgs.length
      || profileCreateInterpreter === undefined
      || realpathSync(profileCreateInterpreter) !== realpathSync(interpreter)
      || profileCreateIsolation !== "-I"
      || profileCreateExecution !== "-c"
      || profileCreateBootstrap === undefined
      || !profileCreateBootstrap.includes("hermes_cli.main")
      || !profileCreateBootstrap.includes(candidateRoot)
      || profileCreateArgs.some((argument, index) => profileCreateCommand[index + 4] !== argument)) return fail("FAIL", "NATIVE_AUTH_FIXTURE_PROFILE_CREATE_COMMAND_INVALID", { installedCommit, archiveDigest });
    const profileCreateDigest = digest(JSON.stringify(profileCreateCommand));
    const profileCreate = bounded(interpreter, ["-B", ...profileCreateCommand.slice(1)], maxChildBytes, 30000);
    if (profileCreate.timedOut || !profileCreate.result || profileCreate.result.error || profileCreate.result.status !== 0) return fail("FAIL", "NATIVE_AUTH_FIXTURE_PROFILE_CREATE_FAILED", { installedCommit, archiveDigest, profileCreateDigest });
    const privateProfilePath = join(hermesRoot, "profiles", "toy");
    const profileStat = lstatSync(privateProfilePath);
    if (!profileStat.isDirectory() || profileStat.isSymbolicLink() || !isWithin(hermesRoot, realpathSync(privateProfilePath))) return fail("FAIL", "NATIVE_AUTH_FIXTURE_PROFILE_CREATE_UNVERIFIED", { installedCommit, archiveDigest, profileCreateDigest });
    const profileAuthAfterCreate = privateStoreDigests(hermesRoot).profileAuth;
    const fallback = [{ provider: "openai", model: "gpt-6.1-sol" }];
    const profileConfigCommands = [["--profile", "toy", "config", "set", "auxiliary.title_generation.enabled", "false"]];
    if (siwcUnbound) profileConfigCommands.push(["--profile", "toy", "config", "set", "fallback_model", JSON.stringify(fallback)], ["--profile", "toy", "config", "get", "fallback_model", "--json"]);
    for (const profileConfigArgs of profileConfigCommands) {
      const profileConfigRequest = bounded(interpreter, ["-B", "-I", candidateStore, "--print-runtime-command", "--module", "hermes_cli.main", "--", ...profileConfigArgs], maxChildBytes, 5000);
      if (profileConfigRequest.timedOut || !profileConfigRequest.result || profileConfigRequest.result.error || profileConfigRequest.result.status !== 0) return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_PROFILE_CONFIG_COMMAND_UNAVAILABLE");
      const rawProfileConfigCommand: unknown = JSON.parse(profileConfigRequest.result.stdout.toString("utf8"));
      const profileConfigCommand = hermesPublicRuntimeCommandSchema.parse(rawProfileConfigCommand);
      if (profileConfigCommand.length !== 4 + profileConfigArgs.length
        || profileConfigCommand[0] === undefined
        || realpathSync(profileConfigCommand[0]) !== realpathSync(interpreter)
        || profileConfigCommand[1] !== "-I"
        || profileConfigCommand[2] !== "-c"
        || !profileConfigCommand[3]?.includes("hermes_cli.main")
        || !profileConfigCommand[3]?.includes(candidateRoot)
        || profileConfigArgs.some((argument, index) => profileConfigCommand[index + 4] !== argument)) return fail("FAIL", "NATIVE_AUTH_FIXTURE_PROFILE_CONFIG_COMMAND_INVALID");
      const profileConfig = bounded(interpreter, ["-B", ...profileConfigCommand.slice(1)], maxChildBytes, 30000);
      if (profileConfig.timedOut || !profileConfig.result || profileConfig.result.error || profileConfig.result.status !== 0) return fail("FAIL", "NATIVE_AUTH_FIXTURE_PROFILE_CONFIG_FAILED");
      if (profileConfigArgs[3] === "get") {
        const readback: unknown = JSON.parse(profileConfig.result.stdout.toString("utf8"));
        if (JSON.stringify(readback) !== JSON.stringify(fallback)) return fail("FAIL", "NATIVE_AUTH_FIXTURE_FALLBACK_CONFIG_READBACK_FAILED");
      }
      artifacts.push(digest(JSON.stringify(profileConfigCommand)));
    }
    let profileAuthAfterAdd: { exists: boolean; digest: string | null } | null = null;
    const childPids = new Set<number>();
    for (const operation of operations) {
      const commandRequest = bounded(interpreter, ["-B", "-I", candidateStore, "--print-runtime-command", "--module", fixtureModule, "--", operation], maxChildBytes, 5000);
      if (commandRequest.timedOut || !commandRequest.result || commandRequest.result.error || commandRequest.result.status !== 0) return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_PUBLIC_COMMAND_UNAVAILABLE", { installedCommit, archiveDigest, operation });
      const rawPublicCommand: unknown = JSON.parse(commandRequest.result.stdout.toString("utf8"));
      const publicCommand = hermesPublicRuntimeCommandSchema.parse(rawPublicCommand);
      const [commandInterpreterValue, isolateFlag, executeFlag, bootstrap, commandOperation] = publicCommand;
      if (publicCommand.length !== 5 || commandInterpreterValue === undefined || isolateFlag !== "-I" || executeFlag !== "-c" || bootstrap === undefined || commandOperation !== operation) return fail("FAIL", "NATIVE_AUTH_FIXTURE_PUBLIC_COMMAND_INVALID", { installedCommit, archiveDigest, operation });
      const expectedInterpreter = realpathSync(interpreter);
      const commandInterpreter = realpathSync(commandInterpreterValue);
      if (commandInterpreter !== expectedInterpreter || !bootstrap.includes(fixtureModule) || !bootstrap.includes(candidateRoot)) return fail("FAIL", "NATIVE_AUTH_FIXTURE_PUBLIC_COMMAND_INVALID", { installedCommit, archiveDigest, operation });
      const commandDigest = digest(JSON.stringify(publicCommand));
      const child = bounded(interpreter, ["-B", ...publicCommand.slice(1)], maxChildBytes, 30000);
      if (child.timedOut || !child.result || child.result.error || child.result.status === null) return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_CHILD_UNAVAILABLE", { installedCommit, archiveDigest, operation, commandDigest, childExitCode: child.result?.status ?? null, childSignal: child.result?.signal ?? null, childError: child.result?.error?.message.includes("ETIMEDOUT") ? "TIMEOUT" : child.result?.error ? "EXECUTION_UNAVAILABLE" : null, stdoutDigest: digest(child.result?.stdout ?? ""), stderrDigest: digest(child.result?.stderr ?? "") });
      const stdout = child.result.stdout.toString("utf8");
      const stderrDigest = digest(child.result.stderr);
      let rawResult: unknown;
      try {
        rawResult = JSON.parse(stdout.trim());
      } catch {
        return fail("FAIL", "NATIVE_AUTH_FIXTURE_RESULT_INVALID", { installedCommit, archiveDigest, operation, commandDigest, stdoutDigest: digest(child.result.stdout), stderrDigest });
      }
      const parsedResult = hermesAuthFixtureResultSchema.safeParse(rawResult);
      if (!parsedResult.success) return fail("FAIL", "NATIVE_AUTH_FIXTURE_RESULT_INVALID", { installedCommit, archiveDigest, operation, commandDigest, stdoutDigest: digest(child.result.stdout), stderrDigest });
      const result: HermesAuthFixtureResultV1 = parsedResult.data;
      const expectedArgv = publicArgv(operation);
      const addOperation = operation.startsWith("add");
      const listOperation = operation.startsWith("list");
      const resultMarker = siwcUnbound ? "SIWC_AUTHORIZATION_REQUIRED" : addOperation ? saveFault ? "AUTH_SAVE_DENIED" : "AUTH_ADD_OK" : listOperation ? saveFault ? "AUTH_LIST_EMPTY" : "AUTH_LIST_READBACK_OK" : saveFault ? "CHAT_GRANT_UNUSABLE" : "CHAT_RESPONSE_OK";
      const chatOperation = operation.startsWith("chat") || siwcUnbound;
      const expectedLedger = addOperation
        ? { device_code_requests: 1, device_code_polls: 1, token_exchanges: 1, token_refreshes: 0, model_catalog_requests: 0, model_requests: 0, denied_http_requests: 0, blocked_socket_events: 0 }
        : listOperation || deniedGrant
          ? { device_code_requests: 0, device_code_polls: 0, token_exchanges: 0, token_refreshes: 0, model_catalog_requests: 0, model_requests: 0, denied_http_requests: 0, blocked_socket_events: 0 }
          : { device_code_requests: 0, device_code_polls: 0, token_exchanges: 0, token_refreshes: operation === "chat-expired" ? 1 : 0, model_catalog_requests: result.http_ledger.model_catalog_requests, model_requests: 1, denied_http_requests: 0, blocked_socket_events: 0 };
      const identity = result.processIdentity;
      const freshChildPid = !childPids.has(identity.pid);
      childPids.add(identity.pid);
      const identityMatches = freshChildPid
        && identity.pid === child.result.pid
        && identity.parentPid === process.pid
        && typeof process.getuid === "function" && identity.uid === process.getuid()
        && typeof process.getgid === "function" && identity.gid === process.getgid();
      const markerMatches = deniedGrant ? result.markers.includes(resultMarker) && !result.markers.includes("AUTH_ADD_OK") && !result.markers.includes("CHAT_RESPONSE_OK") : result.markers.length === 1 && result.markers[0] === resultMarker;
      const countMatches = !listOperation || result.observations.credential_count === (saveFault ? 0 : 1);
      const ledgerMatches = result.http_ledger.model_catalog_requests <= 1 && JSON.stringify(result.http_ledger) === JSON.stringify(expectedLedger);
      const storesAfterOperation = privateStoreDigests(hermesRoot);
      const rootStoreUnchanged = JSON.stringify(storesBefore.rootAuth) === JSON.stringify(storesAfterOperation.rootAuth)
        && JSON.stringify(storesBefore.rootEnv) === JSON.stringify(storesAfterOperation.rootEnv);
      const profileStoreVerified = deniedGrant ? !storesAfterOperation.profileAuth.exists : storesAfterOperation.profileAuth.exists
        && (operation !== "add" || storesAfterOperation.profileAuth.digest !== profileAuthAfterCreate.digest)
        && (operation !== "chat-expired" || storesAfterOperation.profileAuth.digest !== profileAuthAfterAdd?.digest);
      const expectedGeneration = deniedGrant ? null : chatOperation ? operation === "chat" ? "initial" : "rotated" : null;
      const exitMatches = result.exit_code === child.result.status && (deniedGrant && (addOperation || chatOperation) ? result.exit_code !== 0 : result.exit_code === 0);
      const operationPassed = result.operation === (chatOperation ? "chat" : addOperation ? "add" : "list")
        && result.observations.phase === operation
        && result.observations.provider === (siwcUnbound ? "openai-chatgpt" : "openai-codex")
        && result.observations.access_generation === expectedGeneration
        && result.observations.network_denials.length === 0
        && result.observations.socket_origin === null
        && result.observations.token_hygiene
        && !result.observations.fallback_attempted
        && result.observations.storage_fault_triggered === (saveFault && addOperation)
        && (!deniedGrant || result.observations.success_claim_absent)
        && result.public_argv.length === expectedArgv.length
        && result.public_argv.every((argument, index) => argument === expectedArgv[index])
        && exitMatches
        && markerMatches
        && countMatches
        && result.network_audit === "socket-audit-hook-installed"
        && ledgerMatches
        && profileStoreVerified
        && rootStoreUnchanged
        && identityMatches;
      if (addOperation) profileAuthAfterAdd = storesAfterOperation.profileAuth;
      const storeEvidence = addOperation
        ? { rootAuthBefore: storesBefore.rootAuth, rootEnvBefore: storesBefore.rootEnv, rootStoreUnchanged, profileAuthBefore: storesBefore.profileAuth, profileAuthAfterCreate, profileAuthAfterAdd }
        : chatOperation
          ? { rootAuthBefore: storesBefore.rootAuth, rootAuthAfter: storesAfterOperation.rootAuth, rootEnvBefore: storesBefore.rootEnv, rootEnvAfter: storesAfterOperation.rootEnv, rootStoreUnchanged, profileAuthCurrent: storesAfterOperation.profileAuth }
          : { rootStoreUnchanged };
      const operationCheck = check(
        operationPassed ? "PASS" : "FAIL",
        operationPassed ? `NATIVE_AUTH_FIXTURE_${operation.toUpperCase().replaceAll("-", "_")}_OBSERVED` : "NATIVE_AUTH_FIXTURE_OPERATION_FAILED",
        {
          ...(operation === firstOperation ? { profileCreate: {
            publicArgv: ["hermes", ...profileCreateArgs],
            exitCode: profileCreate.result.status,
            profileCreated: true,
            autoTitleDisabledByPublicConfig: true,
            ...(siwcUnbound ? { paidFallbackConfiguredAndReadBack: true, inheritedKeysSynthetic: true } : {}),
            stdoutDigest: digest(profileCreate.result.stdout),
            stderrDigest: digest(profileCreate.result.stderr)
          } } : {}),
          result,
          childPidMatches: identity.pid === child.result.pid,
          freshChildPid,
          parentPidMatches: identity.parentPid === process.pid,
          uidMatches: typeof process.getuid === "function" && identity.uid === process.getuid(),
          gidMatches: typeof process.getgid === "function" && identity.gid === process.getgid(),
          childStdoutDigest: digest(child.result.stdout),
          childStderrDigest: stderrDigest,
          ...storeEvidence,
          wholeATComplete: false
        },
        [...artifacts, archiveDigest, profileCreateDigest, commandDigest]
      );
      operationChecks.push(operationCheck);
      if (!operationPassed) return operationChecks;
    }
    return operationChecks;
  } catch {
    return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_SETUP_UNAVAILABLE");
  }
};
