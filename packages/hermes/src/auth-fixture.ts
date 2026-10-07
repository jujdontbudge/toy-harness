import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { checkViewSchema, hermesAuthFixtureResultSchema, hermesPublicRuntimeCommandSchema } from "@toy/contracts";
import type { CheckViewV1, HermesAuthConcurrencyObservationV1, HermesAuthFixtureResultV1, HermesAuthRefreshEffectV1, HermesFirstAddCellV1, HermesFirstAddSourceV1 } from "@toy/contracts";
import { trustedCheckoutRoot, trustedToolEnvironment } from "@toy/ops/public";

const installedRoot = "/Users/johansardar/.hermes/hermes-agent";
const installedCommit = "8d5e3e412138342e8bf30443e72bd4e6a9abd057";
const maxArchiveBytes = 268435456;
const maxChildBytes = 65536;
const fixtureModule = "tests.fixtures.toy_auth_httpx_fixture";
type FixtureOperation = HermesAuthFixtureResultV1["observations"]["phase"];
type AuthFixtureMode = "standard" | "borrowed-root" | "profile-siblings" | "mixed-lineage" | "lifecycle" | "single-grant-concurrency" | "dashboard-scope" | "first-add";
type FixtureStoreDigest = { exists: boolean; digest: string | null };
type DashboardHttpLedger = HermesAuthFixtureResultV1["http_ledger"];
type DashboardFlowResult = { portObserved: boolean; boundPort: number | null; startStatus: number | null; startSessionPresent: boolean; pollStatus: number | null; pollState: string | null; sanitizedFailure: boolean; responseHygiene: boolean; server: ConcurrentChildResult | null; result: HermesAuthFixtureResultV1 | null; commandDigest: string | null; receiptObservation: ReturnType<typeof observeDashboardReceipts> };
type AuthFixtureStep = {
  caseId: string;
  operation: FixtureOperation;
  scope: "root" | "profile";
  actor: string;
  label: string;
  expectedCount?: number;
  expectedLabelPresent?: boolean;
  expectedGeneration?: Exclude<HermesAuthFixtureResultV1["observations"]["access_generation"], null>;
};

const profileSiblingSteps: readonly AuthFixtureStep[] = [
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

const mixedLineageSteps: readonly AuthFixtureStep[] = [
  { caseId: "root-add", operation: "add", scope: "root", actor: "mixed-root-add", label: "toy-fixture-mixed-root" },
  { caseId: "copied-lineage-heal", operation: "list", scope: "profile", actor: "mixed-root-readback", label: "toy-fixture-mixed-root", expectedCount: 1, expectedLabelPresent: true },
  { caseId: "copied-lineage-use", operation: "chat", scope: "profile", actor: "mixed-root-use", label: "toy-fixture-mixed-root", expectedGeneration: "initial" },
  { caseId: "copied-lineage-refresh", operation: "chat-expired", scope: "profile", actor: "mixed-root-refresh", label: "toy-fixture-mixed-root", expectedGeneration: "rotated" },
  { caseId: "copied-lineage-reload", operation: "chat-reloaded", scope: "profile", actor: "mixed-root-reload", label: "toy-fixture-mixed-root", expectedGeneration: "rotated" },
  { caseId: "independent-manual-add", operation: "add", scope: "profile", actor: "mixed-profile-add", label: "toy-fixture-mixed-independent" },
  { caseId: "independent-profile-readback", operation: "list", scope: "profile", actor: "mixed-profile-readback", label: "toy-fixture-mixed-independent", expectedCount: 1, expectedLabelPresent: true },
  { caseId: "independent-profile-use", operation: "chat", scope: "profile", actor: "mixed-profile-use", label: "toy-fixture-mixed-independent", expectedGeneration: "added" },
  { caseId: "independent-profile-refresh", operation: "chat-expired", scope: "profile", actor: "mixed-profile-refresh", label: "toy-fixture-mixed-independent", expectedGeneration: "added-rotated" },
  { caseId: "independent-profile-reload", operation: "chat-reloaded", scope: "profile", actor: "mixed-profile-reload", label: "toy-fixture-mixed-independent", expectedGeneration: "added-rotated" }
];

const lifecycleSteps: readonly AuthFixtureStep[] = [
  { caseId: "root-add", operation: "add", scope: "root", actor: "lifecycle-root", label: "toy-fixture-lifecycle-root" },
  { caseId: "profile-add-target", operation: "add", scope: "profile", actor: "lifecycle-target", label: "toy-fixture-lifecycle-target" },
  { caseId: "profile-add-sibling", operation: "add", scope: "profile", actor: "lifecycle-sibling", label: "toy-fixture-lifecycle-sibling" },
  { caseId: "profile-initial-readback", operation: "list", scope: "profile", actor: "lifecycle-target", label: "toy-fixture-lifecycle-target", expectedCount: 2, expectedLabelPresent: true },
  { caseId: "priority-reorder-target", operation: "priority-added", scope: "profile", actor: "lifecycle-target", label: "toy-fixture-lifecycle-target" },
  { caseId: "priority-target-rate-limit", operation: "chat", scope: "profile", actor: "lifecycle-target-rate-limit", label: "toy-fixture-lifecycle-target", expectedGeneration: "added" },
  { caseId: "reset-exhausted-readback", operation: "list", scope: "profile", actor: "lifecycle-target", label: "toy-fixture-lifecycle-target", expectedCount: 2, expectedLabelPresent: true },
  { caseId: "reset-target", operation: "reset", scope: "profile", actor: "lifecycle-target", label: "toy-fixture-lifecycle-target" },
  { caseId: "reset-target-readback", operation: "list", scope: "profile", actor: "lifecycle-target", label: "toy-fixture-lifecycle-target", expectedCount: 2, expectedLabelPresent: true },
  { caseId: "reset-target-refresh", operation: "chat-expired", scope: "profile", actor: "lifecycle-target-expired", label: "toy-fixture-lifecycle-target", expectedGeneration: "added-rotated" },
  { caseId: "reset-target-reload", operation: "chat-reloaded", scope: "profile", actor: "lifecycle-target-reload", label: "toy-fixture-lifecycle-target", expectedGeneration: "added-rotated" },
  { caseId: "remove-target", operation: "remove", scope: "profile", actor: "lifecycle-target", label: "toy-fixture-lifecycle-target" },
  { caseId: "remove-fresh-readback", operation: "list", scope: "profile", actor: "lifecycle-target", label: "toy-fixture-lifecycle-target", expectedCount: 1, expectedLabelPresent: false },
  { caseId: "remove-sibling-fresh-use", operation: "chat", scope: "profile", actor: "lifecycle-sibling", label: "toy-fixture-lifecycle-sibling", expectedGeneration: "stale" },
  { caseId: "root-final-readback", operation: "list", scope: "root", actor: "lifecycle-root", label: "toy-fixture-lifecycle-root", expectedCount: 1, expectedLabelPresent: true },
  { caseId: "root-fresh-use", operation: "chat", scope: "root", actor: "lifecycle-root", label: "toy-fixture-lifecycle-root", expectedGeneration: "initial" }
];

const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isWithin = (base: string, target: string): boolean => {
  const path = relative(base, target);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
};

const firstAddPublicInputs: Record<HermesFirstAddSourceV1, { provider: string; addArgs: string[]; model: string }> = {
  "anthropic-pkce": { provider: "anthropic", addArgs: ["auth", "add", "anthropic", "--type", "oauth", "--no-browser"], model: "claude-sonnet-4-5" },
  "codex-device": { provider: "openai-codex", addArgs: ["auth", "add", "openai-codex", "--type", "oauth", "--no-browser"], model: "gpt-6.1-sol" },
  "codex-loopback-pkce": { provider: "openai-codex", addArgs: ["auth", "add", "openai-codex", "--type", "oauth", "--browser", "--no-browser", "--timeout", "10"], model: "gpt-6.1-sol" },
  "xai-device": { provider: "xai-oauth", addArgs: ["auth", "add", "xai-oauth", "--type", "oauth", "--no-browser"], model: "grok-3-mini" },
  "nous-device": { provider: "nous", addArgs: ["auth", "add", "nous", "--type", "oauth", "--no-browser"], model: "hermes-3-llama-3.1-405b" }
};

const publicArgv = (operation: FixtureOperation, order?: HermesAuthConcurrencyObservationV1["order"], storageContext = false, rootScope = false, labelOverride?: string, streamJson = false, firstAddCell?: HermesFirstAddCellV1): string[] => {
  const prefix = rootScope ? ["hermes"] : ["hermes", "--profile", "toy"];
  const label = labelOverride ?? (storageContext ? "toy-fixture-storage-cut" : `toy-fixture-added-${order}`);
  if (operation.startsWith("add")) return [...prefix, ...(firstAddCell ? firstAddPublicInputs[firstAddCell.source].addArgs : ["auth", "add", "openai-codex", "--type", "oauth", "--no-browser"]), ...(order === undefined && labelOverride === undefined ? [] : ["--label", label])];
  if (operation.startsWith("list")) return [...prefix, "auth", "list", "openai-codex"];
  if (operation === "remove" || operation === "reset") return [...prefix, "auth", operation, "openai-codex", label];
  if (operation === "priority-added" || operation === "priority-restored") return [...prefix, "auth", "priority", "openai-codex", operation === "priority-added" ? label : "2", "0"];
  const firstAddInput = firstAddCell ? firstAddPublicInputs[firstAddCell.source] : null;
  return [...prefix, "chat", "--provider", operation === "siwc-unbound" ? "siwc_responses" : firstAddInput?.provider ?? "openai-codex", "--model", firstAddInput?.model ?? "gpt-6.1-sol", "--toolsets", "none", "-q", "Return the fixed fixture marker.", ...(streamJson ? ["--format", "stream-json"] : [])];
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

const observeDashboardReceipts = (child: ConcurrentChildResult | null, phase: string, ownedPid: number | null) => {
  const schemaPaths = new Set([
    "schema", "operation", "public_argv", "exit_code", "markers", "processIdentity", "pid", "parentPid", "uid", "gid",
    "observations", "provider", "phase", "credential_count", "target_label_present", "access_generation", "catalog_access_generation",
    "storage_fault_triggered", "token_hygiene", "success_claim_absent", "fallback_attempted", "network_denials", "socket_origin",
    "concurrency", "caseId", "order", "actor", "barrierState", "cutPoint", "killed", "refreshGeneration", "refreshEffects",
    "from", "to", "barrier", "refreshDispositions", "expiredBeforeLock", "pairChangedAfterLock", "disposition",
    "http_ledger", "device_code_requests", "device_code_polls", "token_exchanges", "token_refreshes", "model_catalog_requests",
    "model_requests", "denied_http_requests", "blocked_socket_events", "network_audit"
  ]);
  const inspect = (bytes: Buffer | undefined) => {
    let schemaCandidates = 0;
    let schemaRejected = 0;
    let expectedReceipts = 0;
    let phaseOrOperationMismatches = 0;
    let ownedIdentityMatches = false;
    const schemaIssues: Array<{ code: string; path: string }> = [];
    for (const line of bytes?.toString("utf8").split("\n") ?? []) {
      let value: unknown;
      try { value = JSON.parse(line); } catch { continue; }
      if (!isRecord(value) || value.schema !== "toy.hermes-httpx-auth-fixture.v1") continue;
      schemaCandidates = Math.min(2, schemaCandidates + 1);
      const parsed = hermesAuthFixtureResultSchema.safeParse(value);
      if (!parsed.success) {
        schemaRejected = Math.min(2, schemaRejected + 1);
        for (const issue of parsed.error.issues) {
          if (schemaIssues.length >= 4) break;
          const canonical = issue.path.length <= 8 && issue.path.every(segment => typeof segment === "number" || (typeof segment === "string" && schemaPaths.has(segment)));
          const canonicalPath = canonical ? issue.path.map(segment => typeof segment === "number" ? "[]" : typeof segment === "string" ? segment : "OTHER").join(".") || "ROOT" : "OTHER";
          const path = canonicalPath.length <= 96 ? canonicalPath : "OTHER";
          schemaIssues.push({ code: issue.code.length <= 32 ? issue.code : "OTHER", path });
        }
        continue;
      }
      if (parsed.data.operation !== "dashboard" || parsed.data.observations.phase !== phase) {
        phaseOrOperationMismatches = Math.min(2, phaseOrOperationMismatches + 1);
        continue;
      }
      expectedReceipts = Math.min(2, expectedReceipts + 1);
      ownedIdentityMatches = ownedPid !== null && parsed.data.processIdentity.pid === ownedPid && parsed.data.processIdentity.parentPid === process.pid && parsed.data.processIdentity.uid === process.getuid?.() && parsed.data.processIdentity.gid === process.getgid?.();
    }
    return { schemaCandidates, schemaRejected, expectedReceipts, phaseOrOperationMismatches, ownedIdentityMatches, schemaIssues };
  };
  const stdout = inspect(child?.stdout);
  const stderr = inspect(child?.stderr);
  const expectedReceipts = stdout.expectedReceipts + stderr.expectedReceipts;
  const classification = expectedReceipts > 1 ? "AMBIGUOUS" : stdout.expectedReceipts === 1 ? "MATCHED_STDOUT" : stderr.expectedReceipts === 1 ? "MATCHED_STDERR" : stdout.schemaRejected + stderr.schemaRejected > 0 ? "SCHEMA_REJECTED" : stdout.phaseOrOperationMismatches + stderr.phaseOrOperationMismatches > 0 ? "PHASE_OR_OPERATION_MISMATCH" : "MISSING";
  return { classification, stdout, stderr };
};

type ConcurrentChildHandle = { pid: number | null; kill: (signal?: NodeJS.Signals) => boolean; isRunning: () => boolean; waitForDashboardPort: (timeoutMs: number) => Promise<number | null>; result: Promise<ConcurrentChildResult> };

const runConcurrentChild = (file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number, observeDashboardPort = false): ConcurrentChildHandle => {
  const child = spawn(file, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  const stdoutParts: Buffer[] = [];
  const stderrParts: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let spawnError = false;
  let timedOut = false;
  let oversized = false;
  let closed = false;
  let dashboardPort: number | null = null;
  let dashboardPortResolve: ((port: number | null) => void) | null = null;
  const dashboardPortPromise = new Promise<number | null>((resolve) => { dashboardPortResolve = resolve; });
  const scanDashboardPort = (): void => {
    if (!observeDashboardPort || dashboardPort !== null) return;
    const text = Buffer.concat(stdoutParts).toString("utf8");
    const match = /HERMES_DASHBOARD_READY port=(\d+)/.exec(text);
    if (match?.[1]) {
      const port = Number(match[1]);
      if (Number.isInteger(port) && port > 0 && port <= 65535) {
        dashboardPort = port;
        dashboardPortResolve?.(port);
      }
    }
  };
  const collect = (parts: Buffer[], chunk: Buffer, currentBytes: number): number => {
    if (currentBytes + chunk.byteLength > maxChildBytes) {
      oversized = true;
      child.kill("SIGKILL");
      return currentBytes;
    }
    parts.push(chunk);
    if (parts === stdoutParts) scanDashboardPort();
    return currentBytes + chunk.byteLength;
  };
  child.stdout?.on("data", (chunk: Buffer) => { stdoutBytes = collect(stdoutParts, chunk, stdoutBytes); });
  child.stderr?.on("data", (chunk: Buffer) => { stderrBytes = collect(stderrParts, chunk, stderrBytes); });
  child.on("error", () => { spawnError = true; dashboardPortResolve?.(null); });
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
  const result = new Promise<ConcurrentChildResult>((resolve) => {
    child.on("close", (status, signal) => {
      closed = true;
      clearTimeout(timer);
      dashboardPortResolve?.(null);
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
  return {
    pid: child.pid ?? null,
    kill: (signal = "SIGKILL") => child.kill(signal),
    isRunning: () => !closed,
    waitForDashboardPort: async (waitMs) => {
      if (!observeDashboardPort) return null;
      if (dashboardPort !== null) return dashboardPort;
      let timeout: NodeJS.Timeout | undefined;
      const wait = new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), waitMs); });
      const port = await Promise.race([dashboardPortPromise, wait]);
      if (timeout) clearTimeout(timeout);
      return port;
    },
    result
  };
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

const profileAuthDigest = (hermesHome: string, profile: string): FixtureStoreDigest => {
  const privateRoot = realpathSync(hermesHome);
  return storeDigest(join(hermesHome, "profiles", profile, "auth.json"), privateRoot);
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

export const runHermesAuthFixture = async (interpreter: string, home: string, hermesHome: string, timeoutMs: number, firstOperation: FixtureOperation = "add", mode: AuthFixtureMode = "standard", firstAddCell?: HermesFirstAddCellV1): Promise<CheckViewV1[]> => {
  const started = process.hrtime.bigint();
  const remainingMs = (): number => timeoutMs - Number((process.hrtime.bigint() - started) / 1000000n);
  const evidence: Record<string, unknown> = { wholeATComplete: false, fixtureSubsetComplete: false };
  let artifacts: string[] = [];
  const operationChecks: CheckViewV1[] = [];
  const concurrencyChecks: CheckViewV1[] = [];
  const firstAddPhaseEvidence: unknown[] = [];
  const concurrentChildren: ConcurrentChildHandle[] = [];
  let stage: "setup" | "original-concurrency" | "single-grant-seed" | "single-grant-before-acquire" | "single-grant-response" | "single-grant-child-results" | "single-grant-owner-receipts" | "single-grant-fresh-readback" = "setup";
  const fail = (state: CheckViewV1["state"], reason: string, extra: Record<string, unknown> = {}): CheckViewV1[] => {
    if (firstAddCell) return [check(state, reason, { ...extra, caseId: `${firstAddCell.rootShape}-${firstAddCell.source}`, source: firstAddCell.source, rootShape: firstAddCell.rootShape, phases: firstAddPhaseEvidence, wholeATComplete: false }, artifacts)];
    return [...operationChecks, ...concurrencyChecks, check(state, reason, { ...evidence, ...extra, wholeATComplete: false }, artifacts)];
  };

  try {
    if (!["add", "add-enospc", "add-replace-fault", "siwc-unbound", "concurrent-refresh-add"].includes(firstOperation)) return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_OPERATION_INVALID");
    const siwcUnbound = firstOperation === "siwc-unbound";
    const concurrentRun = firstOperation === "concurrent-refresh-add";
    const singleGrantConcurrency = mode === "single-grant-concurrency";
    const saveFault = firstOperation === "add-enospc" || firstOperation === "add-replace-fault";
    const deniedGrant = saveFault || siwcUnbound;
    const borrowedRoot = mode === "borrowed-root";
    const profileSiblings = mode === "profile-siblings";
    const mixedLineage = mode === "mixed-lineage";
    const lifecycle = mode === "lifecycle";
    const dashboardScope = mode === "dashboard-scope";
    const firstAddMatrix = mode === "first-add";
    if (firstAddMatrix && (firstOperation !== "add" || firstAddCell === undefined)) return fail("BLOCKED", "NATIVE_AUTH_FIRST_ADD_CELL_INVALID");
    if (borrowedRoot && firstOperation !== "add") return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_OPERATION_INVALID");
    if (profileSiblings && firstOperation !== "add") return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_OPERATION_INVALID");
    if (mixedLineage && firstOperation !== "add") return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_OPERATION_INVALID");
    if (lifecycle && firstOperation !== "add") return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_OPERATION_INVALID");
    if (dashboardScope && firstOperation !== "add") return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_OPERATION_INVALID");
    if (singleGrantConcurrency && !concurrentRun) return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_OPERATION_INVALID");
    const operations: readonly FixtureOperation[] = dashboardScope ? [] : borrowedRoot ? ["add", "list", "chat", "chat-expired", "chat-reloaded", "chat-reloaded"] : profileSiblings ? profileSiblingSteps.map(step => step.operation) : mixedLineage ? mixedLineageSteps.map(step => step.operation) : lifecycle ? lifecycleSteps.map(step => step.operation) : firstAddMatrix ? ["add", "chat"] : siwcUnbound ? [firstOperation] : saveFault ? [firstOperation, "list-after-fault", "chat-after-fault"] : concurrentRun ? ["add", "list"] : ["add", "list", "chat", "chat-expired", "chat-reloaded"];
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_TIMEOUT_INVALID");
    const homeRoot = realpathSync(home);
    const hermesRoot = realpathSync(hermesHome);
    if (!isWithin(homeRoot, hermesRoot) || !statSync(homeRoot).isDirectory() || !statSync(hermesRoot).isDirectory()) return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_PRIVATE_HOME_INVALID");
    const checkout = trustedCheckoutRoot();
    const profilePatch = join(checkout, siwcUnbound ? "patches/hermes-siwc.patch" : "patches/hermes-profile-auth.patch");
    const fixturePatch = join(checkout, "patches/hermes-auth-fixture.patch");
    const dashboardPatch = join(checkout, "patches/hermes-auth-dashboard.patch");
    const profilePatchDigest = digest(readFileSync(profilePatch));
    const fixturePatchDigest = digest(readFileSync(fixturePatch));
    const dashboardPatchDigest = dashboardScope ? digest(readFileSync(dashboardPatch)) : null;
    const fixturePatchLines = readFileSync(fixturePatch, "utf8").split("\n");
    const fixtureAddedLines = fixturePatchLines.slice(3);
    if (fixtureAddedLines.at(-1) === "") fixtureAddedLines.pop();
    if (fixturePatchLines[0] !== "--- /dev/null" || fixturePatchLines[1] !== "+++ b/tests/fixtures/toy_auth_httpx_fixture.py" || fixturePatchLines[2] !== `@@ -0,0 +1,${fixtureAddedLines.length} @@` || fixtureAddedLines.some(line => !line.startsWith("+"))) return fail("FAIL", "NATIVE_AUTH_FIXTURE_PATCH_CONTENT_INVALID");
    const expectedFixtureDigest = digest(fixtureAddedLines.map(line => line.slice(1)).join("\n") + "\n");
    artifacts = [profilePatchDigest, fixturePatchDigest, ...(dashboardPatchDigest ? [dashboardPatchDigest] : []), digest(readFileSync(new URL("./auth-fixture.js", import.meta.url)))];
    const scratch = join(homeRoot, "scratch");
    mkdirSync(scratch, { recursive: true, mode: 0o700 });
    const environment = {
      ...trustedToolEnvironment(),
      HOME: homeRoot,
      HERMES_HOME: hermesRoot,
      TMPDIR: scratch,
      TIRITH_ENABLED: "false",
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONNOUSERSITE: "1",
      ...(firstAddMatrix && firstAddCell ? { TOY_AUTH_FIRST_ADD_SOURCE: firstAddCell.source, TOY_AUTH_FIRST_ADD_ROOT_SHAPE: firstAddCell.rootShape } : {}),
      ...(singleGrantConcurrency ? { TOY_AUTH_SINGLE_GRANT_CONTENTION: "1" } : {})
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
    for (const patchPath of [profilePatch, ...(dashboardScope ? [dashboardPatch] : []), fixturePatch]) {
      const applied = bounded("/usr/bin/patch", ["-p1", "--forward", "--input", patchPath], maxChildBytes, 10000, undefined, candidateRoot);
      if (applied.timedOut || !applied.result || applied.result.error || applied.result.status !== 0) return fail("FAIL", "NATIVE_AUTH_FIXTURE_PATCH_REJECTED", { installedCommit, archiveDigest });
    }
    const fixtureSourcePath = join(candidateRoot, "tests", "fixtures", "toy_auth_httpx_fixture.py");
    const fixtureSource = lstatSync(fixtureSourcePath);
    if (!fixtureSource.isFile() || fixtureSource.isSymbolicLink() || digest(readFileSync(fixtureSourcePath)) !== expectedFixtureDigest) return fail("FAIL", "NATIVE_AUTH_FIXTURE_PATCH_CONTENT_MISMATCH", { installedCommit, archiveDigest });
    artifacts.push(expectedFixtureDigest);
    if (dashboardScope) artifacts.push(digest(readFileSync(join(candidateRoot, "hermes_cli", "web_routers", "oauth.py"))));
    const candidateStore = join(candidateRoot, "hermes_cli", "_launchers.py");
    if (!statSync(candidateStore).isFile()) return fail("FAIL", "NATIVE_AUTH_FIXTURE_PUBLIC_LAUNCHER_MISSING", { installedCommit, archiveDigest });
    if (firstAddMatrix && firstAddCell) {
      const provider = firstAddPublicInputs[firstAddCell.source].provider;
      const rootAuthPath = join(hermesRoot, "auth.json");
      const rootSeed = firstAddCell.rootShape === "missing" ? null
        : firstAddCell.rootShape === "no-pool" ? { active_provider: provider }
          : firstAddCell.rootShape === "empty-pool" ? { credential_pool: {} }
            : { credential_pool: { [provider]: [] } };
      if (rootSeed !== null) writeFileSync(rootAuthPath, JSON.stringify(rootSeed), { flag: "wx", mode: 0o600 });
    }
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
    if (firstAddMatrix && firstAddCell) {
      const rootAfterCreate = privateStoreDigests(hermesRoot).rootAuth;
      const rootShapeObserved = firstAddCell.rootShape === "missing" ? !rootAfterCreate.exists
        : rootAfterCreate.exists && rootAfterCreate.digest === storesBefore.rootAuth.digest;
      if (!rootShapeObserved) return fail("FAIL", "NATIVE_AUTH_FIRST_ADD_ROOT_SHAPE_CHANGED_DURING_PROFILE_CREATE", { caseId: `${firstAddCell.rootShape}-${firstAddCell.source}`, rootShape: firstAddCell.rootShape, rootAuthBeforeCreate: storesBefore.rootAuth, rootAuthAfterCreate: rootAfterCreate });
    }
    if (dashboardScope) {
      const successProfileCreateArgs = ["profile", "create", "success", "--no-skills"];
      const createRequest = bounded(interpreter, ["-B", "-I", candidateStore, "--print-runtime-command", "--module", "hermes_cli.main", "--", ...successProfileCreateArgs], maxChildBytes, 5000);
      if (createRequest.timedOut || !createRequest.result || createRequest.result.error || createRequest.result.status !== 0) return fail("BLOCKED", "NATIVE_AUTH_FIXTURE_DASHBOARD_PROFILE_CREATE_COMMAND_UNAVAILABLE", { installedCommit, archiveDigest });
      const successProfileCommand = hermesPublicRuntimeCommandSchema.parse(JSON.parse(createRequest.result.stdout.toString("utf8")));
      if (successProfileCommand.length !== 4 + successProfileCreateArgs.length || successProfileCommand[0] === undefined || realpathSync(successProfileCommand[0]) !== realpathSync(interpreter) || successProfileCommand[1] !== "-I" || successProfileCommand[2] !== "-c" || !successProfileCommand[3]?.includes("hermes_cli.main") || !successProfileCommand[3]?.includes(candidateRoot) || successProfileCreateArgs.some((argument, index) => successProfileCommand[index + 4] !== argument)) return fail("FAIL", "NATIVE_AUTH_FIXTURE_DASHBOARD_PROFILE_CREATE_COMMAND_INVALID", { installedCommit, archiveDigest });
      const successProfileCreateDigest = digest(JSON.stringify(successProfileCommand));
      const successProfileCreate = bounded(interpreter, ["-B", ...successProfileCommand.slice(1)], maxChildBytes, 30000);
      if (successProfileCreate.timedOut || !successProfileCreate.result || successProfileCreate.result.error || successProfileCreate.result.status !== 0) return fail("FAIL", "NATIVE_AUTH_FIXTURE_DASHBOARD_PROFILE_CREATE_FAILED", { installedCommit, archiveDigest, successProfileCreateDigest });
      const successProfilePath = join(hermesRoot, "profiles", "success");
      const successProfileStat = lstatSync(successProfilePath);
      if (!successProfileStat.isDirectory() || successProfileStat.isSymbolicLink() || !isWithin(hermesRoot, realpathSync(successProfilePath))) return fail("FAIL", "NATIVE_AUTH_FIXTURE_DASHBOARD_PROFILE_CREATE_UNVERIFIED", { installedCommit, archiveDigest, successProfileCreateDigest });
      artifacts.push(successProfileCreateDigest);
    }
    const fallback = [{ provider: "openai", model: "gpt-6.1-sol" }];
    const profileConfigCommands = [["--profile", "toy", "config", "set", "auxiliary.title_generation.enabled", "false"]];
    if (borrowedRoot || lifecycle) profileConfigCommands.push(["config", "set", "auxiliary.title_generation.enabled", "false"]);
    if (borrowedRoot || profileSiblings || mixedLineage || lifecycle || dashboardScope) profileConfigCommands.push(["--profile", "toy", "config", "set", "model.provider", "openai-codex"]);
    if (dashboardScope) profileConfigCommands.push(["--profile", "success", "config", "set", "auxiliary.title_generation.enabled", "false"], ["--profile", "success", "config", "set", "model.provider", "openai-codex"]);
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
    if (dashboardScope) {
      const dashboardChecks: CheckViewV1[] = [];
      const dashboardWebRoot = join(scratch, "dashboard-web-dist");
      const dashboardIndex = "<!doctype html><html><head><title>Toy dashboard fixture</title></head><body></body></html>";
      if (!isWithin(homeRoot, realpathSync(scratch)) || lstatSync(scratch).isSymbolicLink()) return fail("FAIL", "NATIVE_AUTH_FIXTURE_DASHBOARD_WEB_ROOT_UNSAFE");
      mkdirSync(dashboardWebRoot, { mode: 0o700 });
      writeFileSync(join(dashboardWebRoot, "index.html"), dashboardIndex, { flag: "wx", mode: 0o600 });
      artifacts.push(digest(readFileSync(join(dashboardWebRoot, "index.html"))));
      const snapshotStores = () => ({
        rootAuth: storeDigest(join(hermesRoot, "auth.json"), realpathSync(hermesRoot)),
        rootEnv: storeDigest(join(hermesRoot, ".env"), realpathSync(hermesRoot)),
        toyAuth: profileAuthDigest(hermesRoot, "toy"),
        successAuth: profileAuthDigest(hermesRoot, "success")
      });
      const parseDashboardResult = (stdout: Buffer, phase: string): HermesAuthFixtureResultV1 | null => {
        for (const line of stdout.toString("utf8").split("\n").reverse()) {
          let value: unknown;
          try { value = JSON.parse(line); } catch { continue; }
          const parsed = hermesAuthFixtureResultSchema.safeParse(value);
          if (parsed.success && parsed.data.operation === "dashboard" && parsed.data.observations.phase === phase) return parsed.data;
        }
        return null;
      };
      const dashboardIdentity = (flow: DashboardFlowResult): { matches: boolean; pidMatches: boolean; parentPidMatches: boolean; uidMatches: boolean; gidMatches: boolean } => {
        const result = flow.result;
        const serverPid = flow.server?.pid;
        const uid = typeof process.getuid === "function" ? process.getuid() : null;
        const gid = typeof process.getgid === "function" ? process.getgid() : null;
        const pidMatches = result !== null && serverPid !== null && serverPid === result.processIdentity.pid;
        const parentPidMatches = result !== null && result.processIdentity.parentPid === process.pid;
        const uidMatches = result !== null && uid !== null && result.processIdentity.uid === uid;
        const gidMatches = result !== null && gid !== null && result.processIdentity.gid === gid;
        return { matches: pidMatches && parentPidMatches && uidMatches && gidMatches, pidMatches, parentPidMatches, uidMatches, gidMatches };
      };
      const driveDashboard = async (phase: string, profile: "success" | "toy"): Promise<DashboardFlowResult> => {
        const commandRequest = bounded(interpreter, ["-B", "-I", candidateStore, "--print-runtime-command", "--module", fixtureModule, "--", "dashboard-server"], maxChildBytes, 5000);
        if (commandRequest.timedOut || !commandRequest.result || commandRequest.result.error || commandRequest.result.status !== 0) return { portObserved: false, boundPort: null, startStatus: null, startSessionPresent: false, pollStatus: null, pollState: null, sanitizedFailure: false, responseHygiene: false, server: null, result: null, commandDigest: null, receiptObservation: observeDashboardReceipts(null, phase, null) };
        const publicCommand = hermesPublicRuntimeCommandSchema.parse(JSON.parse(commandRequest.result.stdout.toString("utf8")));
        const bootstrap = publicCommand[3];
        if (publicCommand.length !== 5 || publicCommand[0] === undefined || realpathSync(publicCommand[0]) !== realpathSync(interpreter) || publicCommand[1] !== "-I" || publicCommand[2] !== "-c" || bootstrap === undefined || !bootstrap.includes(fixtureModule) || !bootstrap.includes(candidateRoot) || publicCommand[4] !== "dashboard-server") return { portObserved: false, boundPort: null, startStatus: null, startSessionPresent: false, pollStatus: null, pollState: null, sanitizedFailure: false, responseHygiene: false, server: null, result: null, commandDigest: digest(JSON.stringify(publicCommand)), receiptObservation: observeDashboardReceipts(null, phase, null) };
        const commandDigest = digest(JSON.stringify(publicCommand));
        const sessionToken = randomBytes(32).toString("hex");
        const childEnvironment: NodeJS.ProcessEnv = { ...environment, TOY_AUTH_DASHBOARD_PHASE: phase, TOY_AUTH_DASHBOARD_PROFILE: profile, HERMES_DASHBOARD_SESSION_TOKEN: sessionToken, HERMES_WEB_DIST: dashboardWebRoot };
        const serverChild = runConcurrentChild(interpreter, ["-B", ...publicCommand.slice(1)], homeRoot, childEnvironment, Math.max(1, Math.min(remainingMs(), 60000)), true);
        let port: number | null = null;
        let startStatus: number | null = null;
        let startSessionPresent = false;
        let pollStatus: number | null = null;
        let pollState: string | null = null;
        let sanitizedFailure = false;
        let responseHygiene = false;
        let server: ConcurrentChildResult | null = null;
        try {
          port = await serverChild.waitForDashboardPort(Math.max(1, Math.min(remainingMs(), 12000)));
          if (port !== null) {
            const baseUrl = `http://127.0.0.1:${port}`;
            const headers = { "X-Hermes-Session-Token": sessionToken };
            const startResponse = await fetch(`${baseUrl}/api/providers/oauth/openai-codex/start?profile=${profile}`, { method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(Math.max(1, Math.min(remainingMs(), 8000))) });
            startStatus = startResponse.status;
            const startText = await startResponse.text();
            let startPayload: Record<string, unknown> | null = null;
            try {
              const parsed: unknown = JSON.parse(startText);
              if (isRecord(parsed)) startPayload = parsed;
            } catch {}
            const sessionId = typeof startPayload?.session_id === "string" ? startPayload.session_id : null;
            startSessionPresent = sessionId !== null;
            let responseText = startText;
            const observedResponseTexts = [startText];
            const responseFieldsAllowed = [startPayload !== null && Object.keys(startPayload).every(key => ["session_id", "flow", "user_code", "verification_url", "expires_in", "poll_interval"].includes(key))];
            if (sessionId !== null) {
              for (let attempt = 0; attempt < 100 && remainingMs() > 0; attempt += 1) {
                const pollResponse = await fetch(`${baseUrl}/api/providers/oauth/openai-codex/poll/${encodeURIComponent(sessionId)}?profile=${profile}`, { headers, redirect: "error", signal: AbortSignal.timeout(Math.max(1, Math.min(remainingMs(), 5000))) });
                pollStatus = pollResponse.status;
                responseText = await pollResponse.text();
                observedResponseTexts.push(responseText);
                let pollPayload: Record<string, unknown> | null = null;
                try {
                  const parsed: unknown = JSON.parse(responseText);
                  if (isRecord(parsed)) pollPayload = parsed;
                } catch {}
                responseFieldsAllowed.push(pollPayload !== null && Object.keys(pollPayload).every(key => pollStatus === 400 ? key === "detail" : ["session_id", "status", "error_message", "expires_at", "reason", "account_email", "model", "retryable", "retry_after"].includes(key)));
                pollState = typeof pollPayload?.status === "string" ? pollPayload.status : null;
                if (pollResponse.status === 400 || (pollResponse.status === 200 && pollState === "approved")) break;
                await new Promise<void>(resolve => setTimeout(resolve, 100));
              }
            }
            const tokenMaterialPattern = /(?:[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_.-]{4,}|toy-fixture-(?:access|refresh|authorization-code|code-verifier)-[A-Za-z0-9-]+)/i;
            const allResponseText = observedResponseTexts.join("");
            responseHygiene = responseFieldsAllowed.length > 1 && responseFieldsAllowed.every(Boolean) && !/(?:access_token|refresh_token|id_token|session_token|fixture storage fault|PermissionError|OSError)/i.test(allResponseText) && !tokenMaterialPattern.test(allResponseText);
            const failureText = "Sign-in failed. Check this profile's credentials before starting another login.";
            let failurePayload: Record<string, unknown> | null = null;
            try {
              const parsed: unknown = JSON.parse(responseText);
              if (isRecord(parsed)) failurePayload = parsed;
            } catch {}
            sanitizedFailure = pollStatus === 400 && failurePayload?.detail === failureText && responseHygiene && !/(?:approved|logged\s+in|authentication successful|login successful)/i.test(startText + responseText);
          }
        } catch {
          responseHygiene = false;
        } finally {
          if (serverChild.isRunning()) serverChild.kill("SIGINT");
          const stopped = await Promise.race([serverChild.result, new Promise<null>(resolve => setTimeout(() => resolve(null), 3000))]);
          if (stopped === null && serverChild.isRunning()) serverChild.kill("SIGKILL");
          server = stopped ?? await serverChild.result;
        }
        const result = server ? parseDashboardResult(server.stdout, phase) : null;
        return { portObserved: port !== null, boundPort: port, startStatus, startSessionPresent, pollStatus, pollState, sanitizedFailure, responseHygiene, server, result, commandDigest, receiptObservation: observeDashboardReceipts(server, phase, serverChild.pid) };
      };
      const launchFreshFixture = (operation: FixtureOperation, profile: "success" | "toy"): { result: HermesAuthFixtureResultV1; pidMatches: boolean; stdoutDigest: string; stderrDigest: string } | null => {
        const request = bounded(interpreter, ["-B", "-I", candidateStore, "--print-runtime-command", "--module", fixtureModule, "--", operation], maxChildBytes, 5000);
        if (request.timedOut || !request.result || request.result.error || request.result.status !== 0) return null;
        const publicCommand = hermesPublicRuntimeCommandSchema.parse(JSON.parse(request.result.stdout.toString("utf8")));
        const bootstrap = publicCommand[3];
        if (publicCommand.length !== 5 || publicCommand[0] === undefined || realpathSync(publicCommand[0]) !== realpathSync(interpreter) || publicCommand[1] !== "-I" || publicCommand[2] !== "-c" || bootstrap === undefined || !bootstrap.includes(fixtureModule) || !bootstrap.includes(candidateRoot) || publicCommand[4] !== operation) return null;
        const childEnvironment: NodeJS.ProcessEnv = { ...environment, TOY_AUTH_PROFILE: profile };
        const child = bounded(interpreter, ["-B", ...publicCommand.slice(1)], maxChildBytes, 30000, undefined, homeRoot, childEnvironment);
        if (child.timedOut || !child.result || child.result.error || child.result.status === null) return null;
        let rawResult: unknown;
        try { rawResult = JSON.parse(child.result.stdout.toString("utf8").trim()); } catch { return null; }
        const parsed = hermesAuthFixtureResultSchema.safeParse(rawResult);
        if (!parsed.success) return null;
        return { result: parsed.data, pidMatches: child.result.pid !== undefined && parsed.data.processIdentity.pid === child.result.pid && parsed.data.processIdentity.parentPid === process.pid, stdoutDigest: digest(child.result.stdout), stderrDigest: digest(child.result.stderr) };
      };
      const zeroLedger = (ledger: DashboardHttpLedger): boolean => Object.values(ledger).every(count => count === 0);
      const expectedDashboardLedger: DashboardHttpLedger = { device_code_requests: 1, device_code_polls: 1, token_exchanges: 1, token_refreshes: 0, model_catalog_requests: 0, model_requests: 0, denied_http_requests: 0, blocked_socket_events: 0 };
      const rootStable = (before: ReturnType<typeof snapshotStores>, after: ReturnType<typeof snapshotStores>): boolean => JSON.stringify(before.rootAuth) === JSON.stringify(after.rootAuth) && JSON.stringify(before.rootEnv) === JSON.stringify(after.rootEnv);
      const recordDashboardCase = (caseId: string, passed: boolean, facts: unknown, storeDigests: unknown): void => {
        const details = isRecord(facts) ? facts : {};
        dashboardChecks.push(check(passed ? "PASS" : "FAIL", passed ? `NATIVE_AUTH_FIXTURE_${caseId.toUpperCase().replaceAll("-", "_")}_OBSERVED` : `NATIVE_AUTH_FIXTURE_${caseId.toUpperCase().replaceAll("-", "_")}_FAILED`, { caseId, ...details, storeDigests, wholeATComplete: false }, artifacts));
      };
      const recordDashboardObservation = (caseId: string, passed: boolean, flow: DashboardFlowResult): void => {
        dashboardChecks.push(check(passed ? "PASS" : "FAIL", `NATIVE_AUTH_FIXTURE_${caseId.toUpperCase().replaceAll("-", "_")}_DIAGNOSTIC`, {
          caseId,
          observationsOnly: true,
          receiptObservation: flow.receiptObservation,
          ownedProcess: {
            pid: flow.server?.pid ?? null,
            exitCode: flow.server?.status ?? null,
            signal: flow.server?.signal ?? null,
            timedOut: flow.server?.timedOut ?? null,
            oversized: flow.server?.oversized ?? null,
            spawnError: flow.server?.spawnError ?? null
          },
          stdoutReceiptExitCode: flow.result?.exit_code ?? null,
          wholeATComplete: false
        }, artifacts));
      };
      const successBefore = snapshotStores();
      const successFlow = await driveDashboard("dashboard-profile-success", "success");
      const successAfter = snapshotStores();
      const successIdentity = dashboardIdentity(successFlow);
      const successLedgerMatches = successFlow.result !== null && JSON.stringify(successFlow.result.http_ledger) === JSON.stringify(expectedDashboardLedger);
      const successPassed = successFlow.portObserved && successFlow.startStatus === 200 && successFlow.startSessionPresent && successFlow.pollStatus === 200 && successFlow.pollState === "approved" && successFlow.responseHygiene && successIdentity.matches && successFlow.result !== null && successFlow.result.observations.phase === "dashboard-profile-success" && successFlow.result.exit_code === 0 && successFlow.server?.status === 0 && successFlow.result.observations.network_denials.length === 0 && successFlow.result.observations.socket_origin === null && !successFlow.result.observations.storage_fault_triggered && successLedgerMatches && rootStable(successBefore, successAfter) && JSON.stringify(successBefore.toyAuth) === JSON.stringify(successAfter.toyAuth) && successAfter.successAuth.exists && successAfter.successAuth.digest !== successBefore.successAuth.digest;
      recordDashboardCase("dashboard-profile-success", successPassed, { dashboardCommand: "hermes dashboard --host 127.0.0.1 --port 0 --no-open --isolated --skip-build", loopbackHost: "127.0.0.1", loopbackBoundPort: successFlow.boundPort, routes: "POST start?profile=success; GET poll/<session_id>?profile=success", portObserved: successFlow.portObserved, startStatus: successFlow.startStatus, startSessionPresent: successFlow.startSessionPresent, pollStatus: successFlow.pollStatus, pollState: successFlow.pollState, responseHygiene: successFlow.responseHygiene, serverPid: successFlow.result?.processIdentity.pid ?? null, serverPidMatches: successIdentity.pidMatches, serverParentPidMatches: successIdentity.parentPidMatches, serverUid: successFlow.result?.processIdentity.uid ?? null, serverUidMatches: successIdentity.uidMatches, serverGid: successFlow.result?.processIdentity.gid ?? null, serverGidMatches: successIdentity.gidMatches, httpLedger: successFlow.result?.http_ledger ?? null, denials: successFlow.result?.observations.network_denials.length ?? null, networkDenials: successFlow.result?.observations.network_denials ?? null, socketOrigin: successFlow.result?.observations.socket_origin ?? null, childMarkers: successFlow.result?.markers ?? null, storageFaultTriggered: successFlow.result?.observations.storage_fault_triggered ?? null, serverExitCode: successFlow.server?.status ?? null, serverSignal: successFlow.server?.signal ?? null, stdoutDigest: successFlow.server ? digest(successFlow.server.stdout) : null, stderrDigest: successFlow.server ? digest(successFlow.server.stderr) : null, commandDigest: successFlow.commandDigest }, { rootAuth: [successBefore.rootAuth.digest, successAfter.rootAuth.digest], rootEnvUnchanged: JSON.stringify(successBefore.rootEnv) === JSON.stringify(successAfter.rootEnv), toyAuth: [successBefore.toyAuth.digest, successAfter.toyAuth.digest], successAuth: [successBefore.successAuth.digest, successAfter.successAuth.digest] });
      recordDashboardObservation("dashboard-profile-success", successPassed, successFlow);
      if (!successPassed) return dashboardChecks;
      const listUse = launchFreshFixture("list", "success");
      const chatUse = launchFreshFixture("chat", "success");
      const successAfterUse = snapshotStores();
      const listPassed = listUse !== null && listUse.pidMatches && listUse.result.operation === "list" && listUse.result.exit_code === 0 && listUse.result.markers.includes("AUTH_LIST_READBACK_OK") && typeof listUse.result.observations.credential_count === "number" && listUse.result.observations.credential_count > 0 && listUse.result.observations.token_hygiene && listUse.result.observations.network_denials.length === 0 && listUse.result.http_ledger.denied_http_requests === 0;
      const chatPassed = chatUse !== null && chatUse.pidMatches && chatUse.result.operation === "chat" && chatUse.result.exit_code === 0 && chatUse.result.markers.includes("CHAT_RESPONSE_OK") && chatUse.result.observations.access_generation === "initial" && chatUse.result.observations.catalog_access_generation === "initial" && chatUse.result.observations.token_hygiene && !chatUse.result.observations.fallback_attempted && chatUse.result.observations.network_denials.length === 0 && chatUse.result.http_ledger.device_code_requests === 0 && chatUse.result.http_ledger.device_code_polls === 0 && chatUse.result.http_ledger.token_exchanges === 0 && chatUse.result.http_ledger.token_refreshes === 0 && chatUse.result.http_ledger.model_catalog_requests === 1 && chatUse.result.http_ledger.model_requests === 1 && chatUse.result.http_ledger.denied_http_requests === 0 && chatUse.result.http_ledger.blocked_socket_events === 0;
      const useStoresStable = rootStable(successAfter, successAfterUse) && JSON.stringify(successAfter.toyAuth) === JSON.stringify(successAfterUse.toyAuth);
      recordDashboardCase("dashboard-fresh-profile-use", listPassed && chatPassed && useStoresStable, { authListExit: listUse?.result.exit_code ?? null, authListCount: listUse?.result.observations.credential_count ?? null, authListPidMatches: listUse?.pidMatches ?? false, authListStdoutDigest: listUse?.stdoutDigest ?? null, chatExit: chatUse?.result.exit_code ?? null, chatGeneration: chatUse?.result.observations.access_generation ?? null, catalogGeneration: chatUse?.result.observations.catalog_access_generation ?? null, chatHttpLedger: chatUse?.result.http_ledger ?? null, chatPidMatches: chatUse?.pidMatches ?? false, chatStdoutDigest: chatUse?.stdoutDigest ?? null, rootStable: rootStable(successAfter, successAfterUse), toyAuthStable: JSON.stringify(successAfter.toyAuth) === JSON.stringify(successAfterUse.toyAuth) }, { rootAuth: [successAfter.rootAuth.digest, successAfterUse.rootAuth.digest], rootEnvUnchanged: JSON.stringify(successAfter.rootEnv) === JSON.stringify(successAfterUse.rootEnv), toyAuth: [successAfter.toyAuth.digest, successAfterUse.toyAuth.digest], successAuthAfter: successAfterUse.successAuth.digest });
      if (!(listPassed && chatPassed && useStoresStable)) return dashboardChecks;
      const failureBefore = snapshotStores();
      const failureFlow = await driveDashboard("dashboard-save-failure-400", "toy");
      const failureLedgerMatches = failureFlow.result !== null && JSON.stringify(failureFlow.result.http_ledger) === JSON.stringify(expectedDashboardLedger);
      const listAfterFault = launchFreshFixture("list-after-fault", "toy");
      const chatAfterFault = launchFreshFixture("chat-after-fault", "toy");
      const failureAfterUse = snapshotStores();
      const failureListPassed = listAfterFault !== null && listAfterFault.pidMatches && listAfterFault.result.operation === "list" && listAfterFault.result.exit_code === 0 && listAfterFault.result.markers.includes("AUTH_LIST_EMPTY") && listAfterFault.result.observations.credential_count === 0 && listAfterFault.result.observations.token_hygiene;
      const failureChatPassed = chatAfterFault !== null && chatAfterFault.pidMatches && chatAfterFault.result.operation === "chat" && chatAfterFault.result.exit_code !== 0 && chatAfterFault.result.markers.includes("CHAT_GRANT_UNUSABLE") && chatAfterFault.result.observations.success_claim_absent && chatAfterFault.result.observations.token_hygiene && chatAfterFault.result.observations.network_denials.length === 0 && zeroLedger(chatAfterFault.result.http_ledger);
      const failureStoresStable = rootStable(failureBefore, failureAfterUse) && JSON.stringify(failureBefore.successAuth) === JSON.stringify(failureAfterUse.successAuth) && JSON.stringify(failureBefore.toyAuth) === JSON.stringify(failureAfterUse.toyAuth);
      const failureIdentity = dashboardIdentity(failureFlow);
      const failurePassed = failureFlow.portObserved && failureFlow.startStatus === 200 && failureFlow.startSessionPresent && failureFlow.sanitizedFailure && failureIdentity.matches && failureFlow.result !== null && failureFlow.result.observations.phase === "dashboard-save-failure-400" && failureFlow.result.exit_code === 0 && failureFlow.server?.status === 0 && failureFlow.result.observations.network_denials.length === 0 && failureFlow.result.observations.socket_origin === null && failureFlow.result.observations.storage_fault_triggered && failureLedgerMatches && failureListPassed && failureChatPassed && failureStoresStable;
      recordDashboardCase("dashboard-save-failure-400", failurePassed, { dashboardCommand: "hermes dashboard --host 127.0.0.1 --port 0 --no-open --isolated --skip-build", loopbackHost: "127.0.0.1", loopbackBoundPort: failureFlow.boundPort, routes: "POST start?profile=toy; GET poll/<session_id>?profile=toy", portObserved: failureFlow.portObserved, startStatus: failureFlow.startStatus, startSessionPresent: failureFlow.startSessionPresent, pollStatus: failureFlow.pollStatus, sanitizedFailure: failureFlow.sanitizedFailure, responseHygiene: failureFlow.responseHygiene, serverPid: failureFlow.result?.processIdentity.pid ?? null, serverPidMatches: failureIdentity.pidMatches, serverParentPidMatches: failureIdentity.parentPidMatches, serverUid: failureFlow.result?.processIdentity.uid ?? null, serverUidMatches: failureIdentity.uidMatches, serverGid: failureFlow.result?.processIdentity.gid ?? null, serverGidMatches: failureIdentity.gidMatches, osFaultId: "profile-auth-atomic-replace-eio", faultPhase: "dashboard-save-failure-400", storageFaultTriggered: failureFlow.result?.observations.storage_fault_triggered ?? null, httpLedger: failureFlow.result?.http_ledger ?? null, denials: failureFlow.result?.observations.network_denials.length ?? null, networkDenials: failureFlow.result?.observations.network_denials ?? null, socketOrigin: failureFlow.result?.observations.socket_origin ?? null, childMarkers: failureFlow.result?.markers ?? null, serverExitCode: failureFlow.server?.status ?? null, serverSignal: failureFlow.server?.signal ?? null, stdoutDigest: failureFlow.server ? digest(failureFlow.server.stdout) : null, stderrDigest: failureFlow.server ? digest(failureFlow.server.stderr) : null, authListEmpty: failureListPassed, negativeChatNoAcceptedEffects: failureChatPassed, authListDigest: listAfterFault?.stdoutDigest ?? null, negativeChatDigest: chatAfterFault?.stdoutDigest ?? null, commandDigest: failureFlow.commandDigest }, { rootAuth: [failureBefore.rootAuth.digest, failureAfterUse.rootAuth.digest], rootEnvUnchanged: JSON.stringify(failureBefore.rootEnv) === JSON.stringify(failureAfterUse.rootEnv), successAuth: [failureBefore.successAuth.digest, failureAfterUse.successAuth.digest], toyAuth: [failureBefore.toyAuth.digest, failureAfterUse.toyAuth.digest] });
      recordDashboardObservation("dashboard-save-failure-400", failurePassed, failureFlow);
      return dashboardChecks;
    }
    let profileAuthAfterAdd: { exists: boolean; digest: string | null } | null = null;
    let previousRootAuth = storesBefore.rootAuth;
    let profileSiblingRootBaseline: { rootAuth: FixtureStoreDigest; rootEnv: FixtureStoreDigest } | null = null;
    let mixedCopySeed: { rootAuth: FixtureStoreDigest; profileAuth: FixtureStoreDigest; equal: boolean } | null = null;
    let mixedHealedProfileAuth: FixtureStoreDigest | null = null;
    let lifecycleRootBaseline: { rootAuth: FixtureStoreDigest; rootEnv: FixtureStoreDigest } | null = null;
    const childPids = new Set<number>();
    for (const [operationIndex, operation] of operations.entries()) {
      const siblingStep = profileSiblings ? profileSiblingSteps[operationIndex] : undefined;
      const mixedStep = mixedLineage ? mixedLineageSteps[operationIndex] : undefined;
      const lifecycleStep = lifecycle ? lifecycleSteps[operationIndex] : undefined;
      if (profileSiblings && !siblingStep) return fail("FAIL", "NATIVE_AUTH_FIXTURE_SIBLING_STEP_MISSING", { operationIndex });
      if (mixedLineage && !mixedStep) return fail("FAIL", "NATIVE_AUTH_FIXTURE_MIXED_LINEAGE_STEP_MISSING", { operationIndex });
      if (lifecycle && !lifecycleStep) return fail("FAIL", "NATIVE_AUTH_FIXTURE_LIFECYCLE_STEP_MISSING", { operationIndex });
      const fixtureStep = siblingStep ?? mixedStep ?? lifecycleStep;
      if (mixedStep?.caseId === "copied-lineage-heal") {
        const storesBeforeCopy = privateStoreDigests(hermesRoot);
        const rootAuthPath = join(hermesRoot, "auth.json");
        const profilePath = join(hermesRoot, "profiles", "toy");
        const profileAuthPath = join(profilePath, "auth.json");
        const profileDirectory = lstatSync(profilePath);
        if (!storesBeforeCopy.rootAuth.exists
          || storesBeforeCopy.rootAuth.digest === null
          || storesBeforeCopy.profileAuth.exists
          || !profileDirectory.isDirectory()
          || profileDirectory.isSymbolicLink()
          || !isWithin(hermesRoot, realpathSync(profilePath))) return fail("FAIL", "NATIVE_AUTH_FIXTURE_MIXED_LINEAGE_COPY_PRECONDITION_FAILED");
        const rootStat = lstatSync(rootAuthPath);
        if (!rootStat.isFile() || rootStat.isSymbolicLink() || !isWithin(hermesRoot, realpathSync(rootAuthPath))) return fail("FAIL", "NATIVE_AUTH_FIXTURE_MIXED_LINEAGE_ROOT_STORE_INVALID");
        const rootAuthBytes = readFileSync(rootAuthPath);
        const rootAuthDigest = digest(rootAuthBytes);
        if (rootAuthDigest !== storesBeforeCopy.rootAuth.digest) return fail("FAIL", "NATIVE_AUTH_FIXTURE_MIXED_LINEAGE_ROOT_DIGEST_CHANGED");
        writeFileSync(profileAuthPath, rootAuthBytes, { flag: "wx", mode: 0o600 });
        const storesAfterCopy = privateStoreDigests(hermesRoot);
        if (!storesAfterCopy.profileAuth.exists || storesAfterCopy.profileAuth.digest !== rootAuthDigest || storesAfterCopy.rootAuth.digest !== rootAuthDigest) return fail("FAIL", "NATIVE_AUTH_FIXTURE_MIXED_LINEAGE_COPY_NOT_EXACT");
        mixedCopySeed = { rootAuth: storesAfterCopy.rootAuth, profileAuth: storesAfterCopy.profileAuth, equal: true };
      }
      const rootScope = fixtureStep ? fixtureStep.scope === "root" : borrowedRoot && (operationIndex === 0 || operationIndex === 5);
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
        ...(fixtureStep ? { TOY_AUTH_CONCURRENCY_ACTOR: fixtureStep.actor, ...(lifecycle ? { TOY_AUTH_CASE_ID: fixtureStep.caseId } : {}) } : {})
      };
      const child = bounded(interpreter, ["-B", ...publicCommand.slice(1)], maxChildBytes, 30000, undefined, homeRoot, borrowedRoot || profileSiblings || mixedLineage || lifecycle ? scopedEnvironment : environment);
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
      const expectedArgv = publicArgv(operation, undefined, false, rootScope, fixtureStep?.label, false, firstAddCell);
      const addOperation = operation.startsWith("add");
      const listOperation = operation.startsWith("list");
      const priorityOperation = operation === "priority-added" || operation === "priority-restored";
      const removeOperation = operation === "remove";
      const resetOperation = operation === "reset";
      const rateLimitStep = lifecycleStep?.caseId === "priority-target-rate-limit";
      const resultMarker = siwcUnbound ? "SIWC_AUTHORIZATION_REQUIRED" : addOperation ? saveFault ? "AUTH_SAVE_DENIED" : "AUTH_ADD_OK" : listOperation ? saveFault ? "AUTH_LIST_EMPTY" : "AUTH_LIST_READBACK_OK" : priorityOperation ? "AUTH_PRIORITY_OK" : removeOperation ? "AUTH_REMOVE_OK" : resetOperation ? "AUTH_RESET_OK" : saveFault ? "CHAT_GRANT_UNUSABLE" : "CHAT_RESPONSE_OK";
      const chatOperation = operation.startsWith("chat") || siwcUnbound;
      const expectedLedger = addOperation
        ? firstAddCell
          ? { device_code_requests: firstAddCell.source === "codex-device" || firstAddCell.source === "xai-device" || firstAddCell.source === "nous-device" ? 1 : 0, device_code_polls: firstAddCell.source === "codex-device" || firstAddCell.source === "xai-device" || firstAddCell.source === "nous-device" ? 1 : 0, token_exchanges: 1, token_refreshes: 0, model_catalog_requests: 0, model_requests: 0, denied_http_requests: 0, blocked_socket_events: 0 }
          : { device_code_requests: 1, device_code_polls: 1, token_exchanges: 1, token_refreshes: 0, model_catalog_requests: 0, model_requests: 0, denied_http_requests: 0, blocked_socket_events: 0 }
        : listOperation || priorityOperation || removeOperation || resetOperation || deniedGrant
          ? { device_code_requests: 0, device_code_polls: 0, token_exchanges: 0, token_refreshes: 0, model_catalog_requests: 0, model_requests: 0, denied_http_requests: 0, blocked_socket_events: 0 }
          : { device_code_requests: 0, device_code_polls: 0, token_exchanges: 0, token_refreshes: operation === "chat-expired" ? 1 : 0, model_catalog_requests: result.http_ledger.model_catalog_requests, model_requests: rateLimitStep ? result.observations.fallback_attempted ? 3 : 2 : 1, denied_http_requests: 0, blocked_socket_events: 0 };
      const identity = result.processIdentity;
      const freshChildPid = !childPids.has(identity.pid);
      childPids.add(identity.pid);
      const identityMatches = freshChildPid
        && identity.pid === child.result.pid
        && identity.parentPid === process.pid
        && typeof process.getuid === "function" && identity.uid === process.getuid()
        && typeof process.getgid === "function" && identity.gid === process.getgid();
      const markerMatches = deniedGrant ? result.markers.includes(resultMarker) && !result.markers.includes("AUTH_ADD_OK") && !result.markers.includes("CHAT_RESPONSE_OK")
        : rateLimitStep
          ? result.markers.includes("AUTH_PROVIDER_RATE_LIMIT_OBSERVED") && result.markers.includes(result.observations.fallback_attempted ? "CHAT_RESPONSE_OK" : "CHAT_RESPONSE_NOT_CONFIRMED")
          : lifecycleStep?.caseId === "reset-exhausted-readback"
            ? result.markers.includes("AUTH_LIST_READBACK_OK") && result.markers.includes("AUTH_LIST_TARGET_RATE_LIMITED")
            : result.markers.length === 1 && result.markers[0] === resultMarker;
      const countMatches = !listOperation || result.observations.credential_count === (fixtureStep?.expectedCount ?? (saveFault ? 0 : 1));
      const maxCatalogRequests = rateLimitStep && result.observations.fallback_attempted ? 2 : 1;
      const firstAddLedgerMatches = firstAddCell !== undefined && (addOperation
        ? result.http_ledger.device_code_requests === expectedLedger.device_code_requests && result.http_ledger.device_code_polls === expectedLedger.device_code_polls && result.http_ledger.token_exchanges >= 1 && result.http_ledger.token_refreshes === 0 && result.http_ledger.model_requests === 0
        : result.http_ledger.model_requests === 1 && result.http_ledger.denied_http_requests === 0 && result.http_ledger.blocked_socket_events === 0 && result.http_ledger.device_code_requests === 0 && result.http_ledger.device_code_polls === 0 && result.http_ledger.token_exchanges === 0 && result.http_ledger.token_refreshes === 0);
      const ledgerMatches = firstAddCell !== undefined ? firstAddLedgerMatches : result.http_ledger.model_catalog_requests <= maxCatalogRequests && JSON.stringify(result.http_ledger) === JSON.stringify(expectedLedger);
      const storesAfterOperation = privateStoreDigests(hermesRoot);
      const rootStoreUnchanged = JSON.stringify(storesBefore.rootAuth) === JSON.stringify(storesAfterOperation.rootAuth)
        && JSON.stringify(storesBefore.rootEnv) === JSON.stringify(storesAfterOperation.rootEnv);
      const mixedRootEnvUnchanged = JSON.stringify(storesBeforeOperation.rootEnv) === JSON.stringify(storesAfterOperation.rootEnv);
      const lifecycleRootStoreVerified = lifecycleStep !== undefined && (lifecycleStep.caseId === "root-add"
        ? storesAfterOperation.rootAuth.exists
          && storesAfterOperation.rootAuth.digest !== storesBeforeOperation.rootAuth.digest
          && JSON.stringify(storesBeforeOperation.rootEnv) === JSON.stringify(storesAfterOperation.rootEnv)
          && JSON.stringify(storesBeforeOperation.profileAuth) === JSON.stringify(storesAfterOperation.profileAuth)
        : lifecycleRootBaseline !== null
          && JSON.stringify(lifecycleRootBaseline.rootAuth) === JSON.stringify(storesAfterOperation.rootAuth)
          && JSON.stringify(lifecycleRootBaseline.rootEnv) === JSON.stringify(storesAfterOperation.rootEnv));
      const lifecycleProfileStoreVerified = lifecycleStep !== undefined && (lifecycleStep.scope === "root"
        ? JSON.stringify(storesBeforeOperation.profileAuth) === JSON.stringify(storesAfterOperation.profileAuth)
        : addOperation
          ? storesAfterOperation.profileAuth.exists
            && storesAfterOperation.profileAuth.digest !== storesBeforeOperation.profileAuth.digest
          : storesAfterOperation.profileAuth.exists);
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
      const mixedLineageProfileStoreVerified = mixedStep
        ? mixedStep.caseId === "root-add"
          ? JSON.stringify(storesBeforeOperation.profileAuth) === JSON.stringify(storesAfterOperation.profileAuth)
          : mixedStep.caseId === "copied-lineage-heal"
            ? mixedCopySeed !== null
              && JSON.stringify(storesBeforeOperation.profileAuth) === JSON.stringify(mixedCopySeed.profileAuth)
              && storesAfterOperation.profileAuth.digest !== mixedCopySeed.profileAuth.digest
            : mixedStep.caseId === "copied-lineage-use" || mixedStep.caseId === "copied-lineage-refresh" || mixedStep.caseId === "copied-lineage-reload"
              ? mixedHealedProfileAuth !== null && JSON.stringify(storesAfterOperation.profileAuth) === JSON.stringify(mixedHealedProfileAuth)
              : mixedStep.caseId === "independent-manual-add"
                ? mixedHealedProfileAuth !== null
                  && JSON.stringify(storesBeforeOperation.profileAuth) === JSON.stringify(mixedHealedProfileAuth)
                  && storesAfterOperation.profileAuth.exists
                  && storesAfterOperation.profileAuth.digest !== storesBeforeOperation.profileAuth.digest
                : mixedStep.caseId === "independent-profile-readback" || mixedStep.caseId === "independent-profile-use" || mixedStep.caseId === "independent-profile-reload"
                  ? storesAfterOperation.profileAuth.exists
                  : mixedStep.caseId === "independent-profile-refresh"
                    ? storesBeforeOperation.profileAuth.exists
                      && storesAfterOperation.profileAuth.exists
                      && storesAfterOperation.profileAuth.digest !== storesBeforeOperation.profileAuth.digest
                      : false
        : false;
      const mixedLineageRootStoreVerified = mixedStep !== undefined
        && storesAfterOperation.rootAuth.exists
        && mixedRootEnvUnchanged
        && (mixedStep.caseId === "root-add"
          ? storesBeforeOperation.rootAuth.digest !== storesAfterOperation.rootAuth.digest
          : mixedStep.caseId === "copied-lineage-refresh"
            ? previousRootAuth.digest !== storesAfterOperation.rootAuth.digest
            : mixedStep.caseId === "copied-lineage-use" || mixedStep.caseId === "copied-lineage-reload"
              ? true
              : JSON.stringify(storesBeforeOperation.rootAuth) === JSON.stringify(storesAfterOperation.rootAuth));
      const profileStoreVerified = lifecycle
        ? lifecycleProfileStoreVerified
        : mixedLineage
        ? mixedLineageProfileStoreVerified
        : siblingStep
        ? siblingStep.scope === "root" ? siblingProfileStoreUnchanged : storesAfterOperation.profileAuth.exists
        : borrowedRoot ? !profileAuthAfterCreate.exists && !storesAfterOperation.profileAuth.exists : deniedGrant ? !storesAfterOperation.profileAuth.exists : storesAfterOperation.profileAuth.exists
          && (operation !== "add" || storesAfterOperation.profileAuth.digest !== profileAuthAfterCreate.digest)
          && (operation !== "chat-expired" || storesAfterOperation.profileAuth.digest !== profileAuthAfterAdd?.digest);
      const borrowedRootStoreVerified = storesAfterOperation.rootAuth.exists
        && JSON.stringify(storesBefore.rootEnv) === JSON.stringify(storesAfterOperation.rootEnv)
        && (operation === "add" || operation === "chat-expired"
          ? storesAfterOperation.rootAuth.digest !== previousRootAuth.digest
          : storesAfterOperation.rootAuth.digest === previousRootAuth.digest);
      const expectedGeneration = deniedGrant ? null : rateLimitStep ? result.observations.fallback_attempted ? "stale" : null : firstAddCell ? chatOperation && (firstAddCell.source === "codex-device" || firstAddCell.source === "codex-loopback-pkce") ? "added" : null : chatOperation ? fixtureStep?.expectedGeneration ?? (operation === "chat" ? "initial" : "rotated") : null;
      const exitMatches = result.exit_code === child.result.status
        && (deniedGrant && (addOperation || chatOperation)
          ? result.exit_code !== 0
          : rateLimitStep
            ? result.exit_code === (result.observations.fallback_attempted ? 0 : 1)
            : result.exit_code === 0);
      const operationPassed = result.operation === (chatOperation ? "chat" : addOperation ? "add" : priorityOperation ? "priority" : removeOperation ? "remove" : resetOperation ? "reset" : "list")
        && result.observations.phase === operation
        && result.observations.provider === (siwcUnbound ? "openai-chatgpt" : firstAddCell ? firstAddPublicInputs[firstAddCell.source].provider : "openai-codex")
        && result.observations.access_generation === expectedGeneration
        && (!fixtureStep || (rateLimitStep
          ? result.observations.catalog_access_generation === "added" || result.observations.fallback_attempted && result.observations.catalog_access_generation === "stale"
          : result.observations.catalog_access_generation === (chatOperation ? fixtureStep.expectedGeneration : null)))
        && result.observations.network_denials.length === 0
        && result.observations.socket_origin === null
        && result.observations.token_hygiene
        && (rateLimitStep || !result.observations.fallback_attempted)
        && result.observations.storage_fault_triggered === (saveFault && addOperation)
        && (!deniedGrant || result.observations.success_claim_absent)
        && result.public_argv.length === expectedArgv.length
        && result.public_argv.every((argument, index) => argument === expectedArgv[index])
        && exitMatches
        && markerMatches
        && countMatches
        && (!fixtureStep || priorityOperation || !listOperation || result.observations.target_label_present === fixtureStep.expectedLabelPresent)
        && (lifecycleStep?.caseId !== "reset-target-readback" || !result.markers.includes("AUTH_LIST_TARGET_RATE_LIMITED"))
        && result.network_audit === "socket-audit-hook-installed"
        && ledgerMatches
        && profileStoreVerified
        && (lifecycle ? lifecycleRootStoreVerified : borrowedRoot ? borrowedRootStoreVerified : mixedLineage ? mixedLineageRootStoreVerified : profileSiblings ? true : rootStoreUnchanged)
        && (!siblingStep || (rootScope ? siblingRootAddPersisted || siblingRootStoreUnchanged : siblingRootStoreUnchanged))
        && (!siblingStep || (rootScope ? siblingProfileStoreUnchanged : !addOperation || siblingProfileAddPersisted))
        && identityMatches;
      if (addOperation) profileAuthAfterAdd = storesAfterOperation.profileAuth;
      if (firstAddCell) {
        const phaseEvidence = { operation, publicArgv: result.public_argv, processIdentity: identity, childExitCode: child.result.status, markers: result.markers, provider: result.observations.provider, accessGeneration: result.observations.access_generation, tokenHygiene: result.observations.token_hygiene, httpLedger: result.http_ledger, rootStoreUnchanged, profileStoreVerified };
        firstAddPhaseEvidence.push(phaseEvidence);
        artifacts.push(archiveDigest, profileCreateDigest, commandDigest, digest(child.result.stdout), stderrDigest);
        operationChecks.push(check(operationPassed ? "PASS" : "FAIL", operationPassed ? "NATIVE_AUTH_FIRST_ADD_PHASE_OBSERVED" : "NATIVE_AUTH_FIRST_ADD_PHASE_FAILED", phaseEvidence, artifacts));
        if (!operationPassed) return fail("FAIL", "NATIVE_AUTH_FIRST_ADD_PHASE_FAILED", { failedOperation: operation, networkDenials: result.observations.network_denials, socketOrigin: result.observations.socket_origin });
        continue;
      }
      const storeEvidence = addOperation
        ? { rootAuthBefore: storesBefore.rootAuth, rootEnvBefore: storesBefore.rootEnv, rootStoreUnchanged, profileAuthBefore: storesBefore.profileAuth, profileAuthAfterCreate, profileAuthAfterAdd }
        : chatOperation
          ? { rootAuthBefore: storesBefore.rootAuth, rootAuthAfter: storesAfterOperation.rootAuth, rootEnvBefore: storesBefore.rootEnv, rootEnvAfter: storesAfterOperation.rootEnv, rootStoreUnchanged, profileAuthCurrent: storesAfterOperation.profileAuth }
          : { rootStoreUnchanged };
      const operationCheck = check(
        operationPassed ? "PASS" : "FAIL",
        operationPassed ? `NATIVE_AUTH_FIXTURE_${operation.toUpperCase().replaceAll("-", "_")}_OBSERVED` : "NATIVE_AUTH_FIXTURE_OPERATION_FAILED",
        {
          ...(operation === firstOperation && !profileSiblings && !mixedLineage && (!lifecycle || operationIndex === 0) ? { profileCreate: {
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
          ...(!profileSiblings && !mixedLineage && !lifecycle ? storeEvidence : {}),
          ...(borrowedRoot ? { caseId: borrowedCase, storeScope: rootScope ? "root" : "profile", borrowedRootStoreVerified, profileCopyAbsent: profileStoreVerified } : {}),
          ...(siblingStep ? { caseId: siblingStep.caseId, storeScope: siblingStep.scope, label: siblingStep.label, expectedCount: siblingStep.expectedCount ?? null, expectedGeneration: siblingStep.expectedGeneration ?? null, rootAuth: storesAfterOperation.rootAuth, rootEnv: storesAfterOperation.rootEnv, profileAuth: storesAfterOperation.profileAuth, rootStoreUnchanged: siblingRootStoreUnchanged, rootAddPersisted: siblingRootAddPersisted, profileStoreUnchanged: siblingProfileStoreUnchanged, profileAddPersisted: siblingProfileAddPersisted } : {}),
          ...(mixedStep ? { caseId: mixedStep.caseId, storeScope: mixedStep.scope, label: mixedStep.label, expectedCount: mixedStep.expectedCount ?? null, expectedGeneration: mixedStep.expectedGeneration ?? null, rootAuthBefore: storesBeforeOperation.rootAuth.digest, rootAuthAfter: storesAfterOperation.rootAuth.digest, rootEnvAfter: storesAfterOperation.rootEnv.digest, rootEnvUnchanged: mixedRootEnvUnchanged, profileAuthBefore: storesBeforeOperation.profileAuth.digest, profileAuthAfter: storesAfterOperation.profileAuth.digest, rootStoreVerified: mixedLineageRootStoreVerified, profileStoreVerified: mixedLineageProfileStoreVerified, ...(mixedStep.caseId === "copied-lineage-heal" ? { copyDigestsEqual: mixedCopySeed?.equal ?? false } : {}) } : {}),
          ...(lifecycleStep ? { caseId: lifecycleStep.caseId, storeScope: lifecycleStep.scope, label: lifecycleStep.label, expectedCount: lifecycleStep.expectedCount ?? null, expectedLabelPresent: lifecycleStep.expectedLabelPresent ?? null, expectedGeneration: lifecycleStep.expectedGeneration ?? null, rootAuthBefore: storesBeforeOperation.rootAuth, rootAuthAfter: storesAfterOperation.rootAuth, rootEnvBefore: storesBeforeOperation.rootEnv, rootEnvAfter: storesAfterOperation.rootEnv, profileAuthBefore: storesBeforeOperation.profileAuth, profileAuthAfter: storesAfterOperation.profileAuth, rootStoreVerified: lifecycleRootStoreVerified, profileStoreVerified: lifecycleProfileStoreVerified } : {}),
          wholeATComplete: false
        },
        [...artifacts, archiveDigest, profileCreateDigest, commandDigest]
      );
      operationChecks.push(operationCheck);
      if (!operationPassed) return operationChecks;
      if (mixedStep?.caseId === "copied-lineage-heal") mixedHealedProfileAuth = storesAfterOperation.profileAuth;
      previousRootAuth = storesAfterOperation.rootAuth;
      if (lifecycleStep?.caseId === "root-add") lifecycleRootBaseline = { rootAuth: storesAfterOperation.rootAuth, rootEnv: storesAfterOperation.rootEnv };
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
        const expectedArgv = publicArgv(operation, order, targetLabelPresent !== undefined, false, undefined, singleGrantConcurrency);
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
      if (singleGrantConcurrency) {
        stage = "single-grant-seed";
        const order = "refresh-first";
        const seedDirectory = createBarrierDirectory("single-grant-seed");
        const seedChild = launchFixture("list", order, "fresh-list-reload", seedDirectory, "none", false);
        if (!seedChild) return fail("BLOCKED", "NATIVE_AUTH_SINGLE_GRANT_LIST_UNAVAILABLE", { caseId: order, wholeATComplete: false });
        const seedOutcome = await seedChild.result;
        const seedObserved = parseConcurrentChild("list", order, "fresh-list-reload", seedOutcome, "none", 1);
        concurrencyChecks.push(check(seedObserved.passed ? "PASS" : "FAIL", seedObserved.passed ? "NATIVE_AUTH_SINGLE_GRANT_SEED_OBSERVED" : "NATIVE_AUTH_SINGLE_GRANT_SEED_FAILED", { caseId: order, result: seedObserved.result, wholeATComplete: false }, artifacts));
        if (!seedObserved.passed) return [...operationChecks, ...concurrencyChecks];
        stage = "single-grant-before-acquire";
        const winnerDirectory = createBarrierDirectory("single-grant-winner");
        const contenderDirectory = createBarrierDirectory("single-grant-contender");
        const winnerChild = launchFixture("chat-expired", order, "expired-chat", winnerDirectory, "none", false);
        const contenderChild = launchFixture("chat-expired", order, "fresh-refresh-reload", contenderDirectory, "none", false);
        if (!winnerChild || !contenderChild) return fail("BLOCKED", "NATIVE_AUTH_SINGLE_GRANT_CHAT_UNAVAILABLE", { caseId: order, wholeATComplete: false });
        const [winnerPending, contenderPending] = await Promise.all([
          waitForFixtureMarkerOrCompletion(join(winnerDirectory, "refresh-lock-pending"), winnerChild, Math.max(1, Math.min(remainingMs(), 15000))),
          waitForFixtureMarkerOrCompletion(join(contenderDirectory, "refresh-lock-pending"), contenderChild, Math.max(1, Math.min(remainingMs(), 15000)))
        ]);
        const bothBeforeAcquire = winnerPending === "reached" && contenderPending === "reached";
        if (!bothBeforeAcquire) return fail("FAIL", "NATIVE_AUTH_SINGLE_GRANT_PRELOAD_BARRIER_FAILED", { caseId: order, winnerPending, contenderPending, expiredPathEntered: false, wholeATComplete: false });
        stage = "single-grant-response";
        release(winnerDirectory, "release-refresh-lock");
        const winnerResponsePending = await waitForFixtureMarkerOrCompletion(join(winnerDirectory, "refresh-response-pending"), winnerChild, Math.max(1, Math.min(remainingMs(), 15000)));
        if (winnerResponsePending !== "reached") return fail("FAIL", "NATIVE_AUTH_SINGLE_GRANT_RESPONSE_BARRIER_FAILED", { caseId: order, bothBeforeAcquire, winnerResponsePending, expiredPathEntered: false, wholeATComplete: false });
        release(contenderDirectory, "release-refresh-lock");
        release(winnerDirectory, "release-refresh-token");
        const winnerCatalogObserved = await waitForFixtureMarkerOrCompletion(join(winnerDirectory, "refresh-catalog-observed"), winnerChild, Math.max(1, Math.min(remainingMs(), 15000)));
        if (winnerCatalogObserved !== "reached") return fail("FAIL", "NATIVE_AUTH_SINGLE_GRANT_CATALOG_BARRIER_FAILED", { caseId: order, bothBeforeAcquire, winnerCatalogObserved, expiredPathEntered: false, wholeATComplete: false });
        stage = "single-grant-child-results";
        const contenderOutcome = await contenderChild.result;
        const contenderObserved = parseConcurrentChild("chat-expired", order, "fresh-refresh-reload", contenderOutcome, "none");
        release(winnerDirectory, "release-refresh-model");
        const winnerOutcome = await winnerChild.result;
        const winnerObserved = parseConcurrentChild("chat-expired", order, "expired-chat", winnerOutcome, "none");
        const winnerDecisions = winnerObserved.result?.concurrency?.refreshDispositions ?? [];
        const contenderDecisions = contenderObserved.result?.concurrency?.refreshDispositions ?? [];
        const expiredPathEntered = winnerDecisions.length === 1 && contenderDecisions.length === 1 && winnerDecisions[0]?.expiredBeforeLock === true && contenderDecisions[0]?.expiredBeforeLock === true;
        const winnerDecisionMatches = JSON.stringify(winnerDecisions) === JSON.stringify([{ expiredBeforeLock: true, pairChangedAfterLock: false, disposition: "refresh-invoked" }]);
        const contenderDecisionMatches = JSON.stringify(contenderDecisions) === JSON.stringify([{ expiredBeforeLock: true, pairChangedAfterLock: true, disposition: "reloaded-after-serialization" }]);
        const winnerRefreshes = winnerObserved.result?.http_ledger.token_refreshes ?? null;
        const contenderRefreshes = contenderObserved.result?.http_ledger.token_refreshes ?? null;
        const oneProviderRefresh = winnerRefreshes === 1 && contenderRefreshes === 0;
        const serializationPassed = bothBeforeAcquire && expiredPathEntered && winnerObserved.passed && contenderObserved.passed && winnerDecisionMatches && contenderDecisionMatches && oneProviderRefresh;
        stage = "single-grant-owner-receipts";
        for (const [actor, outcome, observed] of [["expired-chat", winnerOutcome, winnerObserved], ["fresh-refresh-reload", contenderOutcome, contenderObserved]] as const) {
          const result = observed.result;
          const decisions = result?.concurrency?.refreshDispositions ?? [];
          concurrencyChecks.push(check(observed.passed ? "PASS" : "FAIL", observed.passed ? "NATIVE_AUTH_SINGLE_GRANT_CHILD_OBSERVED" : "NATIVE_AUTH_SINGLE_GRANT_CHILD_FAILED", {
            caseId: order, actor, public_argv: result?.public_argv ?? [], processIdentity: result?.processIdentity ?? null,
            exitCode: result?.exit_code ?? null, markers: result?.markers ?? [], childChecksPassed: observed.passed,
            ownerRecordCount: decisions.length, refreshDispositions: decisions.slice(0, 2),
            refreshEffects: result?.concurrency?.refreshEffects.slice(0, 2) ?? [], ledger: result?.http_ledger ?? null,
            accessGeneration: result?.observations.access_generation ?? null,
            catalogGeneration: result?.observations.catalog_access_generation ?? null,
            tokenHygiene: result?.observations.token_hygiene ?? false,
            childExitCode: outcome.status, childSignal: outcome.signal, timedOut: outcome.timedOut,
            oversized: outcome.oversized, spawnError: outcome.spawnError, wholeATComplete: false
          }, [...artifacts, digest(outcome.stdout), digest(outcome.stderr)]));
        }
        concurrencyChecks.push(check(serializationPassed ? "PASS" : "FAIL", serializationPassed ? "NATIVE_AUTH_SERIALIZATION_DECISION_OBSERVED" : "NATIVE_AUTH_SERIALIZATION_DECISION_FAILED", {
          caseId: order,
          isolatedSingleGrant: true,
          bothBeforeAcquire,
          expiredPathEntered,
          winnerDecisionMatches,
          contenderDecisionMatches,
          oneProviderRefresh,
          winnerRefreshes,
          contenderRefreshes,
          winnerProcessChecksPassed: winnerObserved.passed,
          contenderProcessChecksPassed: contenderObserved.passed,
          winnerModel: readModelMarkers(winnerDirectory),
          contenderModel: readModelMarkers(contenderDirectory),
          wholeATComplete: false
        }, [...artifacts, digest(winnerOutcome.stdout), digest(contenderOutcome.stdout), digest(winnerOutcome.stderr), digest(contenderOutcome.stderr)]));
        stage = "single-grant-fresh-readback";
        const freshDirectory = createBarrierDirectory("single-grant-fresh");
        const freshChild = launchFixture("chat-reloaded", order, "fresh-refresh-reload", freshDirectory, "none", false);
        if (!freshChild) return fail("BLOCKED", "NATIVE_AUTH_SINGLE_GRANT_FRESH_CHAT_UNAVAILABLE", { caseId: order, wholeATComplete: false });
        const freshOutcome = await freshChild.result;
        const freshObserved = parseConcurrentChild("chat-reloaded", order, "fresh-refresh-reload", freshOutcome, "none");
        const freshPassed = freshObserved.passed && freshObserved.result?.concurrency?.refreshDispositions.length === 0;
        concurrencyChecks.push(check(freshPassed ? "PASS" : "FAIL", freshPassed ? "NATIVE_AUTH_SINGLE_GRANT_FRESH_USE_OBSERVED" : "NATIVE_AUTH_SINGLE_GRANT_FRESH_USE_FAILED", { caseId: order, result: freshObserved.result, ...readModelMarkers(freshDirectory), wholeATComplete: false }, artifacts));
        const listDirectory = createBarrierDirectory("single-grant-final-list");
        const listChild = launchFixture("list", order, "fresh-list-reload", listDirectory, "none", false);
        if (!listChild) return fail("BLOCKED", "NATIVE_AUTH_SINGLE_GRANT_FINAL_LIST_UNAVAILABLE", { caseId: order, wholeATComplete: false });
        const listObserved = parseConcurrentChild("list", order, "fresh-list-reload", await listChild.result, "none", 1);
        concurrencyChecks.push(check(listObserved.passed ? "PASS" : "FAIL", listObserved.passed ? "NATIVE_AUTH_SINGLE_GRANT_FINAL_LIST_OBSERVED" : "NATIVE_AUTH_SINGLE_GRANT_FINAL_LIST_FAILED", { caseId: order, result: listObserved.result, wholeATComplete: false }, artifacts));
        return [...operationChecks, ...concurrencyChecks];
      }
      stage = "original-concurrency";
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
    if (firstAddCell) {
      const cellPassed = operations.length === 2 && operationChecks.length === 2 && operationChecks.every(entry => entry.state === "PASS") && firstAddPhaseEvidence.length === 2;
      return [check(cellPassed ? "PASS" : "FAIL", cellPassed ? "NATIVE_AUTH_FIRST_ADD_CELL_DIAGNOSTIC" : "NATIVE_AUTH_FIRST_ADD_CELL_FAILED", { caseId: `${firstAddCell.rootShape}-${firstAddCell.source}`, source: firstAddCell.source, provider: firstAddPublicInputs[firstAddCell.source].provider, rootShape: firstAddCell.rootShape, rootAuthBefore: storesBefore.rootAuth, rootAuthAfter: privateStoreDigests(hermesRoot).rootAuth, phases: firstAddPhaseEvidence, rootStoreUnchangedAcrossPhases: firstAddPhaseEvidence.length === 2 && firstAddPhaseEvidence.every(value => isRecord(value) && value.rootStoreUnchanged === true), profileGrantWrittenAndUsed: firstAddPhaseEvidence.length === 2 && isRecord(firstAddPhaseEvidence[0]) && isRecord(firstAddPhaseEvidence[1]) && firstAddPhaseEvidence[0].profileStoreVerified === true && firstAddPhaseEvidence[1].profileStoreVerified === true, wholeATComplete: false }, artifacts)];
    }
    return operationChecks;
  } catch (error) {
    const errorCode = error instanceof Error && "code" in error ? error.code : null;
    const category = error instanceof Error && error.name === "ZodError" ? "canonical-check-rejected"
      : error instanceof SyntaxError ? "public-command-json-invalid"
      : errorCode === "EEXIST" ? "barrier-marker-already-exists"
      : errorCode === "ENOENT" ? "owned-path-missing"
      : errorCode === "EACCES" || errorCode === "EPERM" ? "owned-path-permission-denied"
      : errorCode === "ETIMEDOUT" ? "bounded-command-timeout"
      : "unexpected-exception";
    return fail(stage.startsWith("single-grant-") ? "FAIL" : "BLOCKED", "NATIVE_AUTH_FIXTURE_SETUP_UNAVAILABLE", { stage, category });
  } finally {
    for (const child of concurrentChildren) if (child.isRunning()) child.kill();
    await Promise.all(concurrentChildren.map((child) => child.result));
  }
};
