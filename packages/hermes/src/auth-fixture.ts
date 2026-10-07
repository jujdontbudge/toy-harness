import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { checkViewSchema, hermesAuthFixtureResultSchema, hermesPublicRuntimeCommandSchema } from "@toy/contracts";
import type { CheckViewV1, HermesAuthConcurrencyObservationV1, HermesAuthFixtureResultV1, HermesAuthRefreshEffectV1 } from "@toy/contracts";
import { trustedCheckoutRoot, trustedToolEnvironment } from "@toy/ops/public";

const installedRoot = "/Users/johansardar/.hermes/hermes-agent";
const installedCommit = "8d5e3e412138342e8bf30443e72bd4e6a9abd057";
const maxArchiveBytes = 268435456;
const maxChildBytes = 65536;
const fixtureModule = "tests.fixtures.toy_auth_httpx_fixture";
type FixtureOperation = HermesAuthFixtureResultV1["observations"]["phase"];
type AuthFixtureMode = "standard" | "borrowed-root" | "profile-siblings";
type FixtureStoreDigest = { exists: boolean; digest: string | null };
type ProfileSiblingStep = {
  caseId: string;
  operation: FixtureOperation;
  scope: "root" | "profile";
  actor: string;
  label: string;
  expectedCount?: number;
  expectedLabelPresent?: boolean;
  expectedGeneration?: Exclude<HermesAuthFixtureResultV1["observations"]["access_generation"], null>;
};

const profileSiblingSteps: readonly ProfileSiblingStep[] = [
  { caseId: "root-add-one", operation: "add", scope: "root", actor: "sibling-root-one", label: "toy-fixture-sibling-root-one" },
  { caseId: "root-add-two", operation: "add", scope: "root", actor: "sibling-root-two", label: "toy-fixture-sibling-root-two" },
  { caseId: "root-readback-one", operation: "list", scope: "root", actor: "sibling-root-one", label: "toy-fixture-sibling-root-one", expectedCount: 2, expectedLabelPresent: true },
  { caseId: "root-readback-two", operation: "list", scope: "root", actor: "sibling-root-two", label: "toy-fixture-sibling-root-two", expectedCount: 2, expectedLabelPresent: true },
  { caseId: "profile-add-one", operation: "add", scope: "profile", actor: "sibling-profile-one", label: "toy-fixture-sibling-profile-one" },
  { caseId: "profile-add-two", operation: "add", scope: "profile", actor: "sibling-profile-two", label: "toy-fixture-sibling-profile-two" },
  { caseId: "profile-add-new", operation: "add", scope: "profile", actor: "sibling-profile-new", label: "toy-fixture-sibling-profile-new" },
  { caseId: "profile-readback-one", operation: "list", scope: "profile", actor: "sibling-profile-one", label: "toy-fixture-sibling-profile-one", expectedCount: 3, expectedLabelPresent: true },
  { caseId: "profile-readback-two", operation: "list", scope: "profile", actor: "sibling-profile-two", label: "toy-fixture-sibling-profile-two", expectedCount: 3, expectedLabelPresent: true },
  { caseId: "profile-readback-new", operation: "list", scope: "profile", actor: "sibling-profile-new", label: "toy-fixture-sibling-profile-new", expectedCount: 3, expectedLabelPresent: true },
  { caseId: "profile-priority-one", operation: "priority-added", scope: "profile", actor: "sibling-profile-one", label: "toy-fixture-sibling-profile-one" },
  { caseId: "profile-use-one", operation: "chat", scope: "profile", actor: "sibling-profile-one", label: "toy-fixture-sibling-profile-one", expectedGeneration: "stale" },
  { caseId: "profile-priority-two", operation: "priority-added", scope: "profile", actor: "sibling-profile-two", label: "toy-fixture-sibling-profile-two" },
  { caseId: "profile-use-two", operation: "chat", scope: "profile", actor: "sibling-profile-two", label: "toy-fixture-sibling-profile-two", expectedGeneration: "added" },
  { caseId: "profile-priority-new", operation: "priority-added", scope: "profile", actor: "sibling-profile-new", label: "toy-fixture-sibling-profile-new" },
  { caseId: "profile-use-new", operation: "chat", scope: "profile", actor: "sibling-profile-new", label: "toy-fixture-sibling-profile-new", expectedGeneration: "added-rotated" }
];

const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const isWithin = (base: string, target: string): boolean => {
  const path = relative(base, target);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
};

const publicArgv = (operation: FixtureOperation, order?: HermesAuthConcurrencyObservationV1["order"], storageContext = false, rootScope = false, labelOverride?: string): string[] => {
  const prefix = rootScope ? ["hermes"] : ["hermes", "--profile", "toy"];
  const label = labelOverride ?? (storageContext ? "toy-fixture-storage-cut" : `toy-fixture-added-${order}`);
  if (operation.startsWith("add")) return [...prefix, "auth", "add", "openai-codex", "--type", "oauth", "--no-browser", ...(order === undefined && labelOverride === undefined ? [] : ["--label", label])];
  if (operation.startsWith("list")) return [...prefix, "auth", "list", "openai-codex"];
  if (operation === "priority-added" || operation === "priority-restored") return [...prefix, "auth", "priority", "openai-codex", operation === "priority-added" ? label : "2", "0"];
  return [...prefix, "chat", "--provider", operation === "siwc-unbound" ? "siwc_responses" : "openai-codex", "--model", "gpt-6.1-sol", "--toolsets", "none", "-q", "Return the fixed fixture marker."];
};

type ConcurrentChildResult = {
  pid: number | null;
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: Buffer;
  spawnError: boolean;
  timedOut: boolean;
  oversized: boolean;
};

type ConcurrentChildHandle = { pid: number | null; kill: () => boolean; isRunning: () => boolean; result: Promise<ConcurrentChildResult> };

const runConcurrentChild = (file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): ConcurrentChildHandle => {
  const child = spawn(file, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  const stdoutParts: Buffer[] = [];
  const stderrParts: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let spawnError = false;
  let timedOut = false;
  let oversized = false;
  let closed = false;
  const collect = (parts: Buffer[], chunk: Buffer, currentBytes: number): number => {
    if (currentBytes + chunk.byteLength > maxChildBytes) {
      oversized = true;
      child.kill("SIGKILL");
      return currentBytes;
    }
    parts.push(chunk);
    return currentBytes + chunk.byteLength;
  };
  child.stdout?.on("data", (chunk: Buffer) => { stdoutBytes = collect(stdoutParts, chunk, stdoutBytes); });
  child.stderr?.on("data", (chunk: Buffer) => { stderrBytes = collect(stderrParts, chunk, stderrBytes); });
  child.on("error", () => { spawnError = true; });
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
  const result = new Promise<ConcurrentChildResult>((resolve) => {
    child.on("close", (status, signal) => {
      closed = true;
      clearTimeout(timer);
      resolve({
        pid: child.pid ?? null,
        status,
        signal,
        stdout: Buffer.concat(stdoutParts),
        stderr: Buffer.concat(stderrParts),
        spawnError,
        timedOut,
        oversized
      });
    });
  });
  return { pid: child.pid ?? null, kill: () => child.kill("SIGKILL"), isRunning: () => !closed, result };
};

const waitForFixtureMarker = async (path: string, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  return existsSync(path);
};

const waitForFixtureMarkerOrCompletion = async (path: string, child: ConcurrentChildHandle, timeoutMs: number): Promise<"reached" | "completed" | "pending"> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return "reached";
    if (!child.isRunning()) return "completed";
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  if (existsSync(path)) return "reached";
  return child.isRunning() ? "pending" : "completed";
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

export const runHermesAuthFixture = async (interpreter: string, home: string, hermesHome: string, timeoutMs: number, firstOperation: FixtureOperation = "add", mode: AuthFixtureMode = "standard"): Promise<CheckViewV1[]> => {
  const started = process.hrtime.bigint();
  const remainingMs = (): number => timeoutMs - Number((process.hrtime.bigint() - started) / 1000000n);
  const evidence: Record<string, unknown> = { wholeATComplete: false, fixtureSubsetComplete: false };
  let artifacts: string[] = [];
  const operationChecks: CheckViewV1[] = [];
  const concurrencyChecks: CheckViewV1[] = [];
  const concurrentChildren: ConcurrentChildHandle[] = [];
  const fail = (state: CheckViewV1["state"], reason: string, extra: Record<string, unknown> = {}): CheckViewV1[] => [...operationChecks, ...concurrencyChecks, check(state, reason, { ...evidence, ...extra, wholeATComplete: false }, artifacts)];

  try {
    if (!["add", "add-enospc", "add-replace-fault", "siwc-unbound", "concurrent-refresh-add"].includes(firstOperation)) return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_OPERATION_INVALID");
    const siwcUnbound = firstOperation === "siwc-unbound";
    const concurrentRun = firstOperation === "concurrent-refresh-add";
    const saveFault = firstOperation === "add-enospc" || firstOperation === "add-replace-fault";
    const deniedGrant = saveFault || siwcUnbound;
    const borrowedRoot = mode === "borrowed-root";
    const profileSiblings = mode === "profile-siblings";
    if (borrowedRoot && firstOperation !== "add") return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_OPERATION_INVALID");
    if (profileSiblings && firstOperation !== "add") return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_OPERATION_INVALID");
    const operations: readonly FixtureOperation[] = borrowedRoot ? ["add", "list", "chat", "chat-expired", "chat-reloaded", "chat-reloaded"] : profileSiblings ? profileSiblingSteps.map(step => step.operation) : siwcUnbound ? [firstOperation] : saveFault ? [firstOperation, "list-after-fault", "chat-after-fault"] : concurrentRun ? ["add", "list"] : ["add", "list", "chat", "chat-expired", "chat-reloaded"];
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_TIMEOUT_INVALID");
    const homeRoot = realpathSync(home);
    const hermesRoot = realpathSync(hermesHome);
    if (!isWithin(homeRoot, hermesRoot) || !statSync(homeRoot).isDirectory() || !statSync(hermesRoot).isDirectory()) return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_PRIVATE_HOME_INVALID");
    const checkout = trustedCheckoutRoot();
    const profilePatch = join(checkout, siwcUnbound ? "patches/hermes-siwc.patch" : "patches/hermes-profile-auth.patch");
    const fixturePatch = join(checkout, "patches/hermes-auth-fixture.patch");
    const profilePatchDigest = digest(readFileSync(profilePatch));
    const fixturePatchDigest = digest(readFileSync(fixturePatch));
    const fixturePatchLines = readFileSync(fixturePatch, "utf8").split("\n");
    const fixtureAddedLines = fixturePatchLines.slice(3);
    if (fixtureAddedLines.at(-1) === "") fixtureAddedLines.pop();
    if (fixturePatchLines[0] !== "--- /dev/null" || fixturePatchLines[1] !== "+++ b/tests/fixtures/toy_auth_httpx_fixture.py" || fixturePatchLines[2] !== `@@ -0,0 +1,${fixtureAddedLines.length} @@` || fixtureAddedLines.some(line => !line.startsWith("+"))) return fail("FAIL", "NATIVE_AUTH_FIXTURE_PATCH_CONTENT_INVALID");
    const expectedFixtureDigest = digest(fixtureAddedLines.map(line => line.slice(1)).join("\n") + "\n");
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
    const bounded = (file: string, args: string[], maxBuffer: number, capMs: number, input?: Buffer, cwd = homeRoot, childEnvironment: NodeJS.ProcessEnv = environment) => {
      const budget = remainingMs();
      if (budget <= 0) return { timedOut: true as const, result: null };
      const result = spawnSync(file, args, {
        cwd,
        env: childEnvironment,
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
    const fixtureSourcePath = join(candidateRoot, "tests", "fixtures", "toy_auth_httpx_fixture.py");
    const fixtureSource = lstatSync(fixtureSourcePath);
    if (!fixtureSource.isFile() || fixtureSource.isSymbolicLink() || digest(readFileSync(fixtureSourcePath)) !== expectedFixtureDigest) return fail("FAIL", "NATIVE_AUTH_FIXTURE_PATCH_CONTENT_MISMATCH", { installedCommit, archiveDigest });
    artifacts.push(expectedFixtureDigest);
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
    if (borrowedRoot) profileConfigCommands.push(["config", "set", "auxiliary.title_generation.enabled", "false"]);
    if (borrowedRoot || profileSiblings) profileConfigCommands.push(["--profile", "toy", "config", "set", "model.provider", "openai-codex"]);
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
    let previousRootAuth = storesBefore.rootAuth;
    let profileSiblingRootBaseline: { rootAuth: FixtureStoreDigest; rootEnv: FixtureStoreDigest } | null = null;
    const childPids = new Set<number>();
    for (const [operationIndex, operation] of operations.entries()) {
      const siblingStep = profileSiblings ? profileSiblingSteps[operationIndex] : undefined;
      if (profileSiblings && !siblingStep) return fail("FAIL", "NATIVE_AUTH_FIXTURE_SIBLING_STEP_MISSING", { operationIndex });
      const rootScope = siblingStep ? siblingStep.scope === "root" : borrowedRoot && (operationIndex === 0 || operationIndex === 5);
      const borrowedCase = ["root-add", "borrowed-list", "borrowed-use", "borrowed-refresh", "profile-reload", "root-reload"][operationIndex];
      const storesBeforeOperation = privateStoreDigests(hermesRoot);
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
      const scopedEnvironment = {
        ...environment,
        TOY_AUTH_STORE_SCOPE: rootScope ? "root" : "profile",
        ...(siblingStep ? { TOY_AUTH_CONCURRENCY_ACTOR: siblingStep.actor } : {})
      };
      const child = bounded(interpreter, ["-B", ...publicCommand.slice(1)], maxChildBytes, 30000, undefined, homeRoot, borrowedRoot || profileSiblings ? scopedEnvironment : environment);
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
      const expectedArgv = publicArgv(operation, undefined, false, rootScope, siblingStep?.label);
      const addOperation = operation.startsWith("add");
      const listOperation = operation.startsWith("list");
      const priorityOperation = operation === "priority-added" || operation === "priority-restored";
      const resultMarker = siwcUnbound ? "SIWC_AUTHORIZATION_REQUIRED" : addOperation ? saveFault ? "AUTH_SAVE_DENIED" : "AUTH_ADD_OK" : listOperation ? saveFault ? "AUTH_LIST_EMPTY" : "AUTH_LIST_READBACK_OK" : priorityOperation ? "AUTH_PRIORITY_OK" : saveFault ? "CHAT_GRANT_UNUSABLE" : "CHAT_RESPONSE_OK";
      const chatOperation = operation.startsWith("chat") || siwcUnbound;
      const expectedLedger = addOperation
        ? { device_code_requests: 1, device_code_polls: 1, token_exchanges: 1, token_refreshes: 0, model_catalog_requests: 0, model_requests: 0, denied_http_requests: 0, blocked_socket_events: 0 }
        : listOperation || priorityOperation || deniedGrant
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
      const countMatches = !listOperation || result.observations.credential_count === (siblingStep?.expectedCount ?? (saveFault ? 0 : 1));
      const ledgerMatches = result.http_ledger.model_catalog_requests <= 1 && JSON.stringify(result.http_ledger) === JSON.stringify(expectedLedger);
      const storesAfterOperation = privateStoreDigests(hermesRoot);
      const rootStoreUnchanged = JSON.stringify(storesBefore.rootAuth) === JSON.stringify(storesAfterOperation.rootAuth)
        && JSON.stringify(storesBefore.rootEnv) === JSON.stringify(storesAfterOperation.rootEnv);
      const siblingRootStoreUnchanged = profileSiblingRootBaseline !== null
        && JSON.stringify(profileSiblingRootBaseline.rootAuth) === JSON.stringify(storesAfterOperation.rootAuth)
        && JSON.stringify(profileSiblingRootBaseline.rootEnv) === JSON.stringify(storesAfterOperation.rootEnv);
      const siblingRootAddPersisted = siblingStep?.scope === "root" && addOperation
        && storesAfterOperation.rootAuth.exists
        && storesAfterOperation.rootAuth.digest !== storesBeforeOperation.rootAuth.digest
        && JSON.stringify(storesAfterOperation.rootEnv) === JSON.stringify(storesBeforeOperation.rootEnv);
      const siblingProfileStoreUnchanged = JSON.stringify(storesBeforeOperation.profileAuth) === JSON.stringify(storesAfterOperation.profileAuth);
      const siblingProfileAddPersisted = siblingStep?.scope === "profile" && addOperation
        && storesAfterOperation.profileAuth.exists
        && storesAfterOperation.profileAuth.digest !== storesBeforeOperation.profileAuth.digest;
      const profileStoreVerified = siblingStep
        ? siblingStep.scope === "root" ? siblingProfileStoreUnchanged : storesAfterOperation.profileAuth.exists
        : borrowedRoot ? !profileAuthAfterCreate.exists && !storesAfterOperation.profileAuth.exists : deniedGrant ? !storesAfterOperation.profileAuth.exists : storesAfterOperation.profileAuth.exists
          && (operation !== "add" || storesAfterOperation.profileAuth.digest !== profileAuthAfterCreate.digest)
          && (operation !== "chat-expired" || storesAfterOperation.profileAuth.digest !== profileAuthAfterAdd?.digest);
      const borrowedRootStoreVerified = storesAfterOperation.rootAuth.exists
        && JSON.stringify(storesBefore.rootEnv) === JSON.stringify(storesAfterOperation.rootEnv)
        && (operation === "add" || operation === "chat-expired"
          ? storesAfterOperation.rootAuth.digest !== previousRootAuth.digest
          : storesAfterOperation.rootAuth.digest === previousRootAuth.digest);
      const expectedGeneration = deniedGrant ? null : chatOperation ? siblingStep?.expectedGeneration ?? (operation === "chat" ? "initial" : "rotated") : null;
      const exitMatches = result.exit_code === child.result.status && (deniedGrant && (addOperation || chatOperation) ? result.exit_code !== 0 : result.exit_code === 0);
      const operationPassed = result.operation === (chatOperation ? "chat" : addOperation ? "add" : priorityOperation ? "priority" : "list")
        && result.observations.phase === operation
        && result.observations.provider === (siwcUnbound ? "openai-chatgpt" : "openai-codex")
        && result.observations.access_generation === expectedGeneration
        && (!siblingStep || result.observations.catalog_access_generation === (chatOperation ? siblingStep.expectedGeneration : null))
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
        && (!siblingStep || priorityOperation || !listOperation || result.observations.target_label_present === siblingStep.expectedLabelPresent)
        && result.network_audit === "socket-audit-hook-installed"
        && ledgerMatches
        && profileStoreVerified
        && (borrowedRoot ? borrowedRootStoreVerified : profileSiblings ? true : rootStoreUnchanged)
        && (!siblingStep || (rootScope ? siblingRootAddPersisted || siblingRootStoreUnchanged : siblingRootStoreUnchanged))
        && (!siblingStep || (rootScope ? siblingProfileStoreUnchanged : !addOperation || siblingProfileAddPersisted))
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
          ...(operation === firstOperation && !profileSiblings ? { profileCreate: {
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
          ...(!profileSiblings ? storeEvidence : {}),
          ...(borrowedRoot ? { caseId: borrowedCase, storeScope: rootScope ? "root" : "profile", borrowedRootStoreVerified, profileCopyAbsent: profileStoreVerified } : {}),
          ...(siblingStep ? { caseId: siblingStep.caseId, storeScope: siblingStep.scope, label: siblingStep.label, expectedCount: siblingStep.expectedCount ?? null, expectedGeneration: siblingStep.expectedGeneration ?? null, rootAuth: storesAfterOperation.rootAuth, rootEnv: storesAfterOperation.rootEnv, profileAuth: storesAfterOperation.profileAuth, rootStoreUnchanged: siblingRootStoreUnchanged, rootAddPersisted: siblingRootAddPersisted, profileStoreUnchanged: siblingProfileStoreUnchanged, profileAddPersisted: siblingProfileAddPersisted } : {}),
          wholeATComplete: false
        },
        [...artifacts, archiveDigest, profileCreateDigest, commandDigest]
      );
      operationChecks.push(operationCheck);
      if (!operationPassed) return operationChecks;
      previousRootAuth = storesAfterOperation.rootAuth;
      if (siblingStep?.scope === "root" && addOperation && operationIndex === 1) profileSiblingRootBaseline = { rootAuth: storesAfterOperation.rootAuth, rootEnv: storesAfterOperation.rootEnv };
    }
    if (concurrentRun) {
      const launchFixture = (operation: FixtureOperation, order: HermesAuthConcurrencyObservationV1["order"], actor: HermesAuthConcurrencyObservationV1["actor"], barrierDirectory: string, crashCut: HermesAuthConcurrencyObservationV1["crashCut"], holdAfterResult: boolean, storage?: { cut?: "before-replace" | "after-replace" }): ConcurrentChildHandle | null => {
        const commandRequest = bounded(interpreter, ["-B", "-I", candidateStore, "--print-runtime-command", "--module", fixtureModule, "--", operation], maxChildBytes, 5000);
        if (commandRequest.timedOut || !commandRequest.result || commandRequest.result.error || commandRequest.result.status !== 0) return null;
        const rawCommand: unknown = JSON.parse(commandRequest.result.stdout.toString("utf8"));
        const publicCommand = hermesPublicRuntimeCommandSchema.parse(rawCommand);
        const bootstrap = publicCommand[3];
        const interpreterValue = publicCommand[0];
        if (publicCommand.length !== 5 || interpreterValue === undefined || realpathSync(interpreterValue) !== realpathSync(interpreter) || publicCommand[1] !== "-I" || publicCommand[2] !== "-c" || bootstrap === undefined || !bootstrap.includes(fixtureModule) || !bootstrap.includes(candidateRoot) || publicCommand[4] !== operation) return null;
        const childEnvironment: NodeJS.ProcessEnv = { ...environment };
        childEnvironment.TOY_AUTH_CONCURRENCY_ORDER = order;
        childEnvironment.TOY_AUTH_CONCURRENCY_ACTOR = actor;
        childEnvironment.TOY_AUTH_CONCURRENCY_BARRIER_DIR = barrierDirectory;
        childEnvironment.TOY_AUTH_CONCURRENCY_CRASH_CUT = crashCut;
        childEnvironment.TOY_AUTH_CONCURRENCY_HOLD_AFTER_RESULT = holdAfterResult ? "1" : "0";
        if (storage) {
          childEnvironment.TOY_AUTH_STORAGE_CONTEXT = "1";
          if (storage.cut) childEnvironment.TOY_AUTH_STORAGE_CUT = storage.cut;
        }
        const child = runConcurrentChild(interpreter, ["-B", ...publicCommand.slice(1)], homeRoot, childEnvironment, Math.max(1, Math.min(remainingMs(), 30000)));
        concurrentChildren.push(child);
        return child;
      };
      const parseConcurrentChild = (operation: FixtureOperation, order: HermesAuthConcurrencyObservationV1["order"], actor: HermesAuthConcurrencyObservationV1["actor"], outcome: ConcurrentChildResult, expectedCrashCut: HermesAuthConcurrencyObservationV1["crashCut"], expectedCount?: number, targetLabelPresent?: boolean): { result: HermesAuthFixtureResultV1 | null; passed: boolean } => {
        let rawResult: unknown;
        try {
          rawResult = JSON.parse(outcome.stdout.toString("utf8").trim());
        } catch {
          return { result: null, passed: false };
        }
        const parsed = hermesAuthFixtureResultSchema.safeParse(rawResult);
        if (!parsed.success) return { result: null, passed: false };
        const result = parsed.data;
        const concurrency = result.concurrency;
        const identity = result.processIdentity;
        const addOperation = operation === "add";
        const listOperation = operation === "list";
        const priorityOperation = operation === "priority-added" || operation === "priority-restored";
        const expectedArgv = publicArgv(operation, order, targetLabelPresent !== undefined);
        const identityMatches = outcome.pid !== null && identity.pid === outcome.pid && identity.parentPid === process.pid && typeof process.getuid === "function" && identity.uid === process.getuid() && typeof process.getgid === "function" && identity.gid === process.getgid();
        const commandSucceeded = result.exit_code === 0 && (outcome.status === 0 || outcome.signal === "SIGKILL");
        const markerMatches = listOperation
          ? result.markers.length === 1 && result.markers[0] === "AUTH_LIST_READBACK_OK"
          : priorityOperation
            ? result.markers.length === 1 && result.markers[0] === "AUTH_PRIORITY_OK"
            : addOperation
              ? result.markers.length === 1 && result.markers[0] === "AUTH_ADD_OK"
              : result.markers.length === 1 && result.markers[0] === "CHAT_RESPONSE_OK";
        const noUnexpectedDenials = result.observations.network_denials.length === 0;
        const expectedRefreshEffects: HermesAuthRefreshEffectV1[] = actor === "expired-chat"
          ? order === "add-first"
            ? [{ from: "initial", to: "rotated", barrier: "primary-released" }, { from: "added", to: "added-rotated", barrier: "not-used" }]
            : [{ from: "rotated", to: "stale", barrier: "primary-released" }]
          : actor === "fresh-add-reload" && operation === "chat-reloaded" && order === "refresh-first"
            ? [{ from: "added", to: "added-rotated", barrier: "not-used" }]
            : [];
        const refreshEffectsMatch = concurrency !== undefined && JSON.stringify(concurrency.refreshEffects) === JSON.stringify(expectedRefreshEffects);
        const expectedLedger = addOperation
          ? result.http_ledger.device_code_requests === 1 && result.http_ledger.device_code_polls === 1 && result.http_ledger.token_exchanges === 1 && result.http_ledger.token_refreshes === 0 && result.http_ledger.model_catalog_requests === 0 && result.http_ledger.model_requests === 0 && result.http_ledger.denied_http_requests === 0 && result.http_ledger.blocked_socket_events === 0
          : listOperation || priorityOperation
            ? result.http_ledger.device_code_requests === 0 && result.http_ledger.device_code_polls === 0 && result.http_ledger.token_exchanges === 0 && result.http_ledger.token_refreshes === 0 && result.http_ledger.model_catalog_requests === 0 && result.http_ledger.model_requests === 0 && result.http_ledger.denied_http_requests === 0 && result.http_ledger.blocked_socket_events === 0
            : result.http_ledger.device_code_requests === 0 && result.http_ledger.device_code_polls === 0 && result.http_ledger.token_exchanges === 0 && result.http_ledger.token_refreshes === expectedRefreshEffects.length && result.http_ledger.model_catalog_requests === 1 && result.http_ledger.model_requests === 1 && result.http_ledger.denied_http_requests === 0 && result.http_ledger.blocked_socket_events === 0;
        const expectedGeneration = priorityOperation ? result.observations.access_generation === null : actor === "expired-chat"
          ? result.observations.access_generation === (order === "add-first" ? "rotated" : "stale")
          : actor === "fresh-add-reload"
            ? result.observations.access_generation === "added-rotated"
            : actor === "fresh-refresh-reload"
              ? result.observations.access_generation === (order === "add-first" ? "rotated" : "stale")
              : result.observations.access_generation === null;
        const catalogGenerationMatches = addOperation || listOperation || priorityOperation
          ? result.observations.catalog_access_generation === null
          : result.observations.catalog_access_generation === result.observations.access_generation;
        const concurrencyMatches = concurrency !== undefined
          && concurrency.order === order
          && concurrency.actor === actor
          && concurrency.crashCut === expectedCrashCut
          && concurrency.barrier === (actor === "auth-add" || actor === "expired-chat" ? "released" : "not-used")
          && (priorityOperation ? concurrency.freshProcessUse === "not-checked" : (actor !== "fresh-add-reload" && actor !== "fresh-refresh-reload") || concurrency.freshProcessUse === "usable")
          && concurrency.staleRefreshTokenRejected === "not-exercised"
          && concurrency.staleRefreshResponse === "not-exercised";
        const countMatches = expectedCount === undefined || result.observations.credential_count === expectedCount;
        const labelMatches = !listOperation || targetLabelPresent === undefined || result.observations.target_label_present === targetLabelPresent;
        const crashMatches = expectedCrashCut === "none" ? outcome.status === 0 && outcome.signal === null : outcome.status === null && outcome.signal === "SIGKILL";
        const passed = result.operation === (listOperation ? "list" : addOperation ? "add" : priorityOperation ? "priority" : "chat")
          && result.observations.phase === operation
          && result.observations.provider === "openai-codex"
          && result.observations.token_hygiene
          && !result.observations.fallback_attempted
          && result.observations.socket_origin === null
          && noUnexpectedDenials
          && result.public_argv.length === expectedArgv.length
          && result.public_argv.every((argument, index) => argument === expectedArgv[index])
          && identityMatches
          && !outcome.spawnError
          && !outcome.timedOut
          && !outcome.oversized
          && commandSucceeded
          && markerMatches
          && refreshEffectsMatch
          && expectedLedger
          && expectedGeneration
          && catalogGenerationMatches
          && concurrencyMatches
          && countMatches
          && labelMatches
          && crashMatches
          && result.network_audit === "socket-audit-hook-installed"
          && JSON.stringify(privateStoreDigests(hermesRoot).rootAuth) === JSON.stringify(storesBefore.rootAuth)
          && JSON.stringify(privateStoreDigests(hermesRoot).rootEnv) === JSON.stringify(storesBefore.rootEnv);
        return { result, passed };
      };
      const readModelMarkers = (barrierDirectory: string) => ({
        modelRequestGenerations: hermesAuthFixtureResultSchema.shape.observations.shape.catalog_access_generation.unwrap().options.filter(generation => existsSync(join(barrierDirectory, `model-request-${generation}`))),
        modelUnknownGeneration: existsSync(join(barrierDirectory, "model-request-unknown")),
        modelAuthorizationDenied: existsSync(join(barrierDirectory, "model-request-authorization-denied")),
        modelPayloadDenied: existsSync(join(barrierDirectory, "model-request-model-denied"))
      });
      const release = (barrierDirectory: string, marker: string): void => writeFileSync(join(barrierDirectory, marker), "release", { flag: "wx", mode: 0o600 });
      const createBarrierDirectory = (label: string): string => {
        const path = join(scratch, `concurrent-${label}-${process.hrtime.bigint()}`);
        mkdirSync(path, { mode: 0o700 });
        return path;
      };
      for (const order of ["add-first", "refresh-first"] as const) {
        const barrierDirectory = createBarrierDirectory(order);
        const beforePair = privateStoreDigests(hermesRoot);
        const primaryCrashCut = order === "add-first" ? "after-add-public-command-before-wrapper-exit" : "after-refresh-public-command-before-wrapper-exit";
        let addChild: ConcurrentChildHandle;
        let chatChild: ConcurrentChildHandle;
        let addOutcome: ConcurrentChildResult | null = null;
        let chatOutcome: ConcurrentChildResult | null = null;
        let addObserved: { result: HermesAuthFixtureResultV1 | null; passed: boolean } | null = null;
        let bothPrePersistenceBarriersReached = false;
        const shortOverlapWait = Math.max(1, Math.min(remainingMs(), 2000));
        if (order === "add-first") {
          const launchedAdd = launchFixture("add", order, "auth-add", barrierDirectory, primaryCrashCut, true);
          if (!launchedAdd || !await waitForFixtureMarker(join(barrierDirectory, "add-response-pending"), Math.max(1, Math.min(remainingMs(), 45000)))) return fail("FAIL", "NATIVE_AUTH_CONCURRENCY_ADD_RESPONSE_BARRIER_FAILED", { order, wholeATComplete: false });
          addChild = launchedAdd;
          const launchedChat = launchFixture("chat-expired", order, "expired-chat", barrierDirectory, "none", false);
          if (!launchedChat) return fail("BLOCKED", "NATIVE_AUTH_CONCURRENCY_REFRESH_COMMAND_UNAVAILABLE", { order, wholeATComplete: false });
          chatChild = launchedChat;
          const refreshPending = await waitForFixtureMarkerOrCompletion(join(barrierDirectory, "refresh-lock-pending"), chatChild, Math.max(1, Math.min(remainingMs(), 15000)));
          if (refreshPending === "completed") return fail("FAIL", "NATIVE_AUTH_CONCURRENCY_REFRESH_CHILD_EXITED_EARLY", { order, wholeATComplete: false });
          if (refreshPending !== "reached") return fail("FAIL", "NATIVE_AUTH_CONCURRENCY_REFRESH_LOCK_BARRIER_FAILED", { order, wholeATComplete: false });
          bothPrePersistenceBarriersReached = refreshPending === "reached";
          release(barrierDirectory, "release-add-token");
          if (!await waitForFixtureMarker(join(barrierDirectory, "add-command-returned"), Math.max(1, Math.min(remainingMs(), 45000)))) return fail("FAIL", "NATIVE_AUTH_CONCURRENCY_ADD_RESULT_UNOBSERVED", { order, bothPrePersistenceBarriersReached, wholeATComplete: false });
          release(barrierDirectory, "release-add-result");
          if (!await waitForFixtureMarker(join(barrierDirectory, "result-emitted"), Math.max(1, Math.min(remainingMs(), 45000)))) return fail("FAIL", "NATIVE_AUTH_CONCURRENCY_ADD_RESULT_BARRIER_FAILED", { order, wholeATComplete: false });
          addChild.kill();
          release(barrierDirectory, "release-refresh-lock");
          if (!await waitForFixtureMarker(join(barrierDirectory, "refresh-response-pending"), Math.max(1, Math.min(remainingMs(), 45000)))) return fail("FAIL", "NATIVE_AUTH_CONCURRENCY_REFRESH_RESPONSE_BARRIER_FAILED", { order, wholeATComplete: false });
          release(barrierDirectory, "release-refresh-token");
          const catalogObservation = await waitForFixtureMarkerOrCompletion(join(barrierDirectory, "refresh-catalog-observed"), chatChild, Math.max(1, Math.min(remainingMs(), 45000)));
          if (catalogObservation !== "reached") {
            if (chatChild.isRunning()) chatChild.kill();
            const failedChat = await chatChild.result;
            const failedObservation = parseConcurrentChild("chat-expired", order, "expired-chat", failedChat, "none");
            return fail("FAIL", "NATIVE_AUTH_CONCURRENCY_REFRESH_OBSERVATION_UNOBSERVED", { order, catalogObservation, result: failedObservation.result, childExitCode: failedChat.status, childSignal: failedChat.signal, timedOut: failedChat.timedOut, oversized: failedChat.oversized, spawnError: failedChat.spawnError });
          }
          release(barrierDirectory, "release-refresh-model");
          addOutcome = await addChild.result;
          chatOutcome = await chatChild.result;
        } else {
          const launchedChat = launchFixture("chat-expired", order, "expired-chat", barrierDirectory, primaryCrashCut, true);
          if (!launchedChat || !await waitForFixtureMarker(join(barrierDirectory, "refresh-response-pending"), Math.max(1, Math.min(remainingMs(), 45000)))) return fail("FAIL", "NATIVE_AUTH_CONCURRENCY_REFRESH_RESPONSE_BARRIER_FAILED", { order, wholeATComplete: false });
          chatChild = launchedChat;
          const launchedAdd = launchFixture("add", order, "auth-add", barrierDirectory, "none", false);
          if (!launchedAdd) return fail("BLOCKED", "NATIVE_AUTH_CONCURRENCY_ADD_COMMAND_UNAVAILABLE", { order, wholeATComplete: false });
          addChild = launchedAdd;
          const addPending = await waitForFixtureMarkerOrCompletion(join(barrierDirectory, "add-response-pending"), addChild, shortOverlapWait);
          if (addPending === "completed") return fail("FAIL", "NATIVE_AUTH_CONCURRENCY_ADD_CHILD_EXITED_EARLY", { order, wholeATComplete: false });
          bothPrePersistenceBarriersReached = addPending === "reached";
          release(barrierDirectory, "release-refresh-token");
          const catalogObservation = await waitForFixtureMarkerOrCompletion(join(barrierDirectory, "refresh-catalog-observed"), chatChild, Math.max(1, Math.min(remainingMs(), 45000)));
          if (catalogObservation !== "reached") {
            if (chatChild.isRunning()) chatChild.kill();
            const failedChat = await chatChild.result;
            const failedObservation = parseConcurrentChild("chat-expired", order, "expired-chat", failedChat, primaryCrashCut);
            return fail("FAIL", "NATIVE_AUTH_CONCURRENCY_REFRESH_OBSERVATION_UNOBSERVED", { order, bothPrePersistenceBarriersReached, catalogObservation, result: failedObservation.result, childExitCode: failedChat.status, childSignal: failedChat.signal, timedOut: failedChat.timedOut, oversized: failedChat.oversized, spawnError: failedChat.spawnError });
          }
          if (!bothPrePersistenceBarriersReached && !await waitForFixtureMarker(join(barrierDirectory, "add-response-pending"), Math.max(1, Math.min(remainingMs(), 45000)))) return fail("FAIL", "NATIVE_AUTH_CONCURRENCY_ADD_RESPONSE_BARRIER_FAILED", { order, wholeATComplete: false });
          release(barrierDirectory, "release-add-token");
          if (!await waitForFixtureMarker(join(barrierDirectory, "add-command-returned"), Math.max(1, Math.min(remainingMs(), 45000)))) return fail("FAIL", "NATIVE_AUTH_CONCURRENCY_ADD_RESULT_UNOBSERVED", { order, wholeATComplete: false });
          release(barrierDirectory, "release-add-result");
          addOutcome = await addChild.result;
          addObserved = parseConcurrentChild("add", order, "auth-add", addOutcome, "none");
          concurrencyChecks.push(check(addObserved.passed ? "PASS" : "FAIL", addObserved.passed ? "NATIVE_AUTH_CONCURRENCY_ADD_OBSERVED" : "NATIVE_AUTH_CONCURRENCY_ADD_FAILED", { order, result: addObserved.result, primaryChildCount: 2, childProcessesStartedBeforeFirstRelease: true, bothPrePersistenceBarriersReached, refreshBarrierKind: "provider-response", commandOrderObserved: addObserved.passed, wholeATComplete: false }, [...artifacts, ...(addObserved.result ? [digest(JSON.stringify(addObserved.result))] : [])]));
          release(barrierDirectory, "release-refresh-model");
          if (!await waitForFixtureMarker(join(barrierDirectory, "result-emitted"), Math.max(1, Math.min(remainingMs(), 45000)))) {
            if (chatChild.isRunning()) chatChild.kill();
            const failedChat = await chatChild.result;
            const failedObservation = parseConcurrentChild("chat-expired", order, "expired-chat", failedChat, primaryCrashCut);
            return fail("FAIL", "NATIVE_AUTH_CONCURRENCY_REFRESH_RESULT_BARRIER_FAILED", { order, result: failedObservation.result, ...readModelMarkers(barrierDirectory), childExitCode: failedChat.status, childSignal: failedChat.signal, timedOut: failedChat.timedOut, oversized: failedChat.oversized, spawnError: failedChat.spawnError });
          }
          chatChild.kill();
          chatOutcome = await chatChild.result;
        }
        if (addOutcome === null || chatOutcome === null) return fail("FAIL", "NATIVE_AUTH_CONCURRENCY_CHILD_OUTCOME_MISSING", { order, wholeATComplete: false });
        const chatObserved = parseConcurrentChild("chat-expired", order, "expired-chat", chatOutcome, order === "refresh-first" ? primaryCrashCut : "none");
        if (order === "add-first") {
          addObserved = parseConcurrentChild("add", order, "auth-add", addOutcome, primaryCrashCut);
          concurrencyChecks.push(check(addObserved.passed ? "PASS" : "FAIL", addObserved.passed ? "NATIVE_AUTH_CONCURRENCY_ADD_CRASH_CUT_OBSERVED" : "NATIVE_AUTH_CONCURRENCY_ADD_CRASH_CUT_FAILED", { order, result: addObserved.result, childSignal: addOutcome.signal, primaryChildCount: 2, childProcessesStartedBeforeFirstRelease: true, bothPrePersistenceBarriersReached, refreshBarrierKind: "os-lock-acquisition", commandOrderObserved: addObserved.passed && chatObserved.passed, crashCut: primaryCrashCut, wholeATComplete: false }, [...artifacts, ...(addObserved.result ? [digest(JSON.stringify(addObserved.result))] : [])]));
        }
        concurrencyChecks.push(check(chatObserved.passed ? "PASS" : "FAIL", chatObserved.passed ? "NATIVE_AUTH_CONCURRENCY_CHAT_CRASH_CUT_OBSERVED" : "NATIVE_AUTH_CONCURRENCY_CHAT_CRASH_CUT_FAILED", { order, result: chatObserved.result, childSignal: chatOutcome.signal, primaryChildCount: 2, childProcessesStartedBeforeFirstRelease: true, bothPrePersistenceBarriersReached, refreshBarrierKind: order === "add-first" ? "os-lock-acquisition" : "provider-response", commandOrderObserved: addObserved?.passed === true && chatObserved.passed, crashCut: primaryCrashCut, wholeATComplete: false }, [...artifacts, ...(chatObserved.result ? [digest(JSON.stringify(chatObserved.result))] : [])]));
        if (!chatObserved.passed || (addObserved !== null && !addObserved.passed)) return [...operationChecks, ...concurrencyChecks];
        const afterPair = privateStoreDigests(hermesRoot);
        const rootStoreUnchanged = JSON.stringify(beforePair.rootAuth) === JSON.stringify(afterPair.rootAuth) && JSON.stringify(beforePair.rootEnv) === JSON.stringify(afterPair.rootEnv);
        const reloadDirectory = createBarrierDirectory(`${order}-reload`);
        const listChild = launchFixture("list", order, "fresh-list-reload", reloadDirectory, "none", false);
        if (!listChild) return fail("BLOCKED", "NATIVE_AUTH_CONCURRENCY_LIST_COMMAND_UNAVAILABLE", { order, wholeATComplete: false });
        const listOutcome = await listChild.result;
        const expectedCount = order === "add-first" ? 2 : 3;
        const listObserved = parseConcurrentChild("list", order, "fresh-list-reload", listOutcome, "none", expectedCount);
        concurrencyChecks.push(check(listObserved.passed && rootStoreUnchanged ? "PASS" : "FAIL", listObserved.passed && rootStoreUnchanged ? "NATIVE_AUTH_CONCURRENCY_FRESH_LIST_OBSERVED" : "NATIVE_AUTH_CONCURRENCY_FRESH_LIST_FAILED", { order, result: listObserved.result, credentialCountExpected: expectedCount, rootStoreUnchanged, profileStoreExists: afterPair.profileAuth.exists, primaryChildCount: 2, freshReloadVerified: false, wholeATComplete: false }, [...artifacts, ...(listObserved.result ? [digest(JSON.stringify(listObserved.result))] : [])]));
        const freshRefreshChild = launchFixture("chat-reloaded", order, "fresh-refresh-reload", reloadDirectory, "none", false);
        if (!freshRefreshChild) return fail("BLOCKED", "NATIVE_AUTH_CONCURRENCY_REFRESH_RELOAD_COMMAND_UNAVAILABLE", { order, wholeATComplete: false });
        const freshRefreshOutcome = await freshRefreshChild.result;
        const freshRefreshObserved = parseConcurrentChild("chat-reloaded", order, "fresh-refresh-reload", freshRefreshOutcome, "none");
        const freshRefreshGeneration = freshRefreshObserved.result?.observations.access_generation === (order === "add-first" ? "rotated" : "stale");
        const freshRefreshResult = freshRefreshObserved.passed && freshRefreshGeneration && rootStoreUnchanged;
        concurrencyChecks.push(check(freshRefreshResult ? "PASS" : "FAIL", freshRefreshResult ? "NATIVE_AUTH_CONCURRENCY_FRESH_REFRESH_RELOAD_OBSERVED" : "NATIVE_AUTH_CONCURRENCY_FRESH_REFRESH_RELOAD_FAILED", { order, result: freshRefreshObserved.result, newestAcceptedRefreshGeneration: freshRefreshObserved.result?.observations.access_generation ?? null, refreshGrantUsable: freshRefreshGeneration, rootStoreUnchanged, wholeATComplete: false }, [...artifacts, ...(freshRefreshObserved.result ? [digest(JSON.stringify(freshRefreshObserved.result))] : [])]));
        if (!freshRefreshResult) return [...operationChecks, ...concurrencyChecks];
        const priorityChild = launchFixture("priority-added", order, "fresh-add-reload", reloadDirectory, "none", false);
        if (!priorityChild) return fail("BLOCKED", "NATIVE_AUTH_CONCURRENCY_PRIORITY_COMMAND_UNAVAILABLE", { order, wholeATComplete: false });
        const priorityOutcome = await priorityChild.result;
        const priorityObserved = parseConcurrentChild("priority-added", order, "fresh-add-reload", priorityOutcome, "none");
        concurrencyChecks.push(check(priorityObserved.passed ? "PASS" : "FAIL", priorityObserved.passed ? "NATIVE_AUTH_CONCURRENCY_ADDED_PRIORITY_OBSERVED" : "NATIVE_AUTH_CONCURRENCY_ADDED_PRIORITY_FAILED", { order, result: priorityObserved.result, childExitCode: priorityOutcome.status, childSignal: priorityOutcome.signal, timedOut: priorityOutcome.timedOut, oversized: priorityOutcome.oversized, spawnError: priorityOutcome.spawnError, rootStoreUnchanged, wholeATComplete: false }, artifacts));
        if (!priorityObserved.passed) return [...operationChecks, ...concurrencyChecks];
        const freshAddDirectory = createBarrierDirectory(`${order}-fresh-add-reload`);
        const freshAddChild = launchFixture("chat-reloaded", order, "fresh-add-reload", freshAddDirectory, "none", false);
        if (!freshAddChild) return fail("BLOCKED", "NATIVE_AUTH_CONCURRENCY_FRESH_ADD_RELOAD_COMMAND_UNAVAILABLE", { order, wholeATComplete: false });
        const freshAddOutcome = await freshAddChild.result;
        const freshAddObserved = parseConcurrentChild("chat-reloaded", order, "fresh-add-reload", freshAddOutcome, "none");
        const freshGeneration = freshAddObserved.result?.observations.access_generation === "added-rotated";
        const freshResult = freshAddObserved.passed && freshGeneration && rootStoreUnchanged;
        concurrencyChecks.push(check(freshResult ? "PASS" : "FAIL", freshResult ? "NATIVE_AUTH_CONCURRENCY_FRESH_GRANT_RELOAD_OBSERVED" : "NATIVE_AUTH_CONCURRENCY_FRESH_GRANT_RELOAD_FAILED", { order, result: freshAddObserved.result, ...readModelMarkers(freshAddDirectory), childExitCode: freshAddOutcome.status, childSignal: freshAddOutcome.signal, timedOut: freshAddOutcome.timedOut, oversized: freshAddOutcome.oversized, spawnError: freshAddOutcome.spawnError, staleRefreshTokenRejected: freshAddObserved.result?.concurrency?.staleRefreshTokenRejected ?? "not-exercised", staleRefreshResponse: freshAddObserved.result?.concurrency?.staleRefreshResponse ?? "not-exercised", addedGrantUsable: freshGeneration, lostUpdateAbsent: listObserved.result?.observations.credential_count === expectedCount && freshRefreshGeneration && freshGeneration && chatObserved.passed, rootStoreUnchanged, wholeATComplete: false }, [...artifacts, ...(freshAddObserved.result ? [digest(JSON.stringify(freshAddObserved.result))] : [])]));
        if (!freshResult) return [...operationChecks, ...concurrencyChecks];
        const restoreChild = launchFixture("priority-restored", order, "fresh-refresh-reload", reloadDirectory, "none", false);
        if (!restoreChild) return fail("BLOCKED", "NATIVE_AUTH_CONCURRENCY_RESTORE_COMMAND_UNAVAILABLE", { order, wholeATComplete: false });
        const restoreOutcome = await restoreChild.result;
        const restoreObserved = parseConcurrentChild("priority-restored", order, "fresh-refresh-reload", restoreOutcome, "none");
        concurrencyChecks.push(check(restoreObserved.passed ? "PASS" : "FAIL", restoreObserved.passed ? "NATIVE_AUTH_CONCURRENCY_PRIMARY_PRIORITY_RESTORED" : "NATIVE_AUTH_CONCURRENCY_PRIMARY_PRIORITY_RESTORE_FAILED", { order, result: restoreObserved.result, childExitCode: restoreOutcome.status, childSignal: restoreOutcome.signal, timedOut: restoreOutcome.timedOut, wholeATComplete: false }, artifacts));
        if (!restoreObserved.passed) return [...operationChecks, ...concurrencyChecks];
        const finalListChild = launchFixture("list", order, "fresh-list-reload", reloadDirectory, "none", false);
        if (!finalListChild) return fail("BLOCKED", "NATIVE_AUTH_CONCURRENCY_FINAL_LIST_COMMAND_UNAVAILABLE", { order, wholeATComplete: false });
        const finalListObserved = parseConcurrentChild("list", order, "fresh-list-reload", await finalListChild.result, "none", expectedCount);
        concurrencyChecks.push(check(finalListObserved.passed ? "PASS" : "FAIL", finalListObserved.passed ? "NATIVE_AUTH_CONCURRENCY_FINAL_LIST_OBSERVED" : "NATIVE_AUTH_CONCURRENCY_FINAL_LIST_FAILED", { order, result: finalListObserved.result, credentialCountExpected: expectedCount, wholeATComplete: false }, artifacts));
        if (!finalListObserved.passed) return [...operationChecks, ...concurrencyChecks];
      }
      for (const cut of ["before-replace", "after-replace"] as const) {
        const order = "refresh-first";
        const barrierDirectory = createBarrierDirectory(`storage-${cut}`);
        const beforeCut = privateStoreDigests(hermesRoot);
        const addChild = launchFixture("add", order, "auth-add", barrierDirectory, "none", false, { cut });
        if (!addChild || !await waitForFixtureMarker(join(barrierDirectory, "add-response-pending"), Math.max(1, Math.min(remainingMs(), 15000)))) return fail("FAIL", "NATIVE_AUTH_STORAGE_ADD_BARRIER_FAILED", { cut });
        release(barrierDirectory, "release-add-token");
        const boundary = await waitForFixtureMarkerOrCompletion(join(barrierDirectory, `storage-${cut}`), addChild, Math.max(1, Math.min(remainingMs(), 15000)));
        if (boundary !== "reached") return fail("FAIL", "NATIVE_AUTH_STORAGE_BOUNDARY_UNOBSERVED", { cut, boundary });
        const identityFile = join(barrierDirectory, "storage-child-identity");
        const identityStat = lstatSync(identityFile);
        if (!identityStat.isFile() || identityStat.isSymbolicLink() || identityStat.size > 2048) return fail("FAIL", "NATIVE_AUTH_STORAGE_IDENTITY_INVALID", { cut });
        const identityInput: unknown = JSON.parse(readFileSync(identityFile, "utf8"));
        const identity = hermesAuthFixtureResultSchema.shape.processIdentity.parse(identityInput);
        addChild.kill();
        const outcome = await addChild.result;
        const afterCut = privateStoreDigests(hermesRoot);
        const rootStoreUnchanged = JSON.stringify(afterCut.rootAuth) === JSON.stringify(beforeCut.rootAuth) && JSON.stringify(afterCut.rootEnv) === JSON.stringify(beforeCut.rootEnv);
        const profileCommitMatches = afterCut.profileAuth.exists && (cut === "before-replace" ? JSON.stringify(afterCut.profileAuth) === JSON.stringify(beforeCut.profileAuth) : afterCut.profileAuth.digest !== beforeCut.profileAuth.digest);
        const killedAtBoundary = outcome.status === null && outcome.signal === "SIGKILL" && !outcome.spawnError && !outcome.timedOut && !outcome.oversized && outcome.stdout.byteLength === 0 && outcome.stderr.byteLength === 0 && identity.pid === outcome.pid && identity.parentPid === process.pid && identity.uid === process.getuid?.() && identity.gid === process.getgid?.();
        const cutPassed = killedAtBoundary && rootStoreUnchanged && profileCommitMatches;
        concurrencyChecks.push(check(cutPassed ? "PASS" : "FAIL", cutPassed ? "NATIVE_AUTH_STORAGE_CRASH_CUT_OBSERVED" : "NATIVE_AUTH_STORAGE_CRASH_CUT_FAILED", { cut, boundary, processIdentity: identity, childSignal: outcome.signal, killedAtBoundary, profileCommitMatches, rootStoreUnchanged, powerLossDurabilityVerified: false, wholeATComplete: false }, artifacts));
        if (!cutPassed) return [...operationChecks, ...concurrencyChecks];
        const targetLabelPresent = cut === "after-replace";
        const expectedCount = targetLabelPresent ? 4 : 3;
        const reloadDirectory = createBarrierDirectory(`storage-${cut}-reload`);
        const listChild = launchFixture("list", order, "fresh-list-reload", reloadDirectory, "none", false, {});
        if (!listChild) return fail("BLOCKED", "NATIVE_AUTH_STORAGE_LIST_UNAVAILABLE", { cut });
        const listObserved = parseConcurrentChild("list", order, "fresh-list-reload", await listChild.result, "none", expectedCount, targetLabelPresent);
        concurrencyChecks.push(check(listObserved.passed ? "PASS" : "FAIL", listObserved.passed ? "NATIVE_AUTH_STORAGE_FRESH_LIST_OBSERVED" : "NATIVE_AUTH_STORAGE_FRESH_LIST_FAILED", { cut, result: listObserved.result, credentialCountExpected: expectedCount, targetLabelPresentExpected: targetLabelPresent, wholeATComplete: false }, artifacts));
        if (!listObserved.passed) return [...operationChecks, ...concurrencyChecks];
        if (targetLabelPresent) {
          const priorityChild = launchFixture("priority-added", order, "fresh-add-reload", reloadDirectory, "none", false, {});
          if (!priorityChild) return fail("BLOCKED", "NATIVE_AUTH_STORAGE_PRIORITY_UNAVAILABLE", { cut });
          const priorityObserved = parseConcurrentChild("priority-added", order, "fresh-add-reload", await priorityChild.result, "none", undefined, true);
          concurrencyChecks.push(check(priorityObserved.passed ? "PASS" : "FAIL", priorityObserved.passed ? "NATIVE_AUTH_STORAGE_EXACT_PRIORITY_OBSERVED" : "NATIVE_AUTH_STORAGE_EXACT_PRIORITY_FAILED", { cut, result: priorityObserved.result, wholeATComplete: false }, artifacts));
          if (!priorityObserved.passed) return [...operationChecks, ...concurrencyChecks];
        }
        const actor = targetLabelPresent ? "fresh-add-reload" : "fresh-refresh-reload";
        const chatDirectory = createBarrierDirectory(`storage-${cut}-chat`);
        const chatChild = launchFixture("chat-reloaded", order, actor, chatDirectory, "none", false, {});
        if (!chatChild) return fail("BLOCKED", "NATIVE_AUTH_STORAGE_CHAT_UNAVAILABLE", { cut });
        const chatOutcome = await chatChild.result;
        const chatObserved = parseConcurrentChild("chat-reloaded", order, actor, chatOutcome, "none", undefined, targetLabelPresent);
        concurrencyChecks.push(check(chatObserved.passed ? "PASS" : "FAIL", chatObserved.passed ? "NATIVE_AUTH_STORAGE_FRESH_USE_OBSERVED" : "NATIVE_AUTH_STORAGE_FRESH_USE_FAILED", { cut, result: chatObserved.result, ...readModelMarkers(chatDirectory), childExitCode: chatOutcome.status, childSignal: chatOutcome.signal, timedOut: chatOutcome.timedOut, wholeATComplete: false }, artifacts));
        if (!chatObserved.passed) return [...operationChecks, ...concurrencyChecks];
      }
      return [...operationChecks, ...concurrencyChecks];
    }
    return operationChecks;
  } catch {
    return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_SETUP_UNAVAILABLE");
  } finally {
    for (const child of concurrentChildren) if (child.isRunning()) child.kill();
    await Promise.all(concurrentChildren.map((child) => child.result));
  }
};
