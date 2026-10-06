import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, chownSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkViewSchema, opsControlContextSchema, opsErrorMessages, registeredCliProbeInventory, registeredProbeInputSchema, roleBootstrapRoot, roleControlDenialOperationSchema, roleControlDenialReceiptSchema } from "@toy/contracts";
import type { CheckViewV1, OpsControlContextV1, RegisteredProbeInputV1, RegisteredProbeOperationV1, Result } from "@toy/contracts";
import { trustedCheckoutRoot } from "./checkout-root.js";
import { FixtureProbe, fixtureStackInspect } from "./fixture-stack.js";

const sha = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const environment = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" };
const directory = (path: string): void => {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o7777) !== 0o700) throw new Error("PROTECTED_CASE_PARENT_INVALID");
};
const fixedId = (flag: "-u" | "-g"): number => {
  const child = spawnSync("/usr/bin/id", [flag, "_toy_agent"], { env: environment, encoding: "utf8", timeout: 1000, maxBuffer: 1024 });
  if (child.error || child.status !== 0 || !/^[0-9]{3}\s*$/.test(child.stdout)) throw new Error("AGENT_IDENTITY_UNAVAILABLE");
  return Number(child.stdout.trim());
};
const immutableFile = (path: string, bytes: Buffer | string, mode = 0o444): void => {
  writeFileSync(path, bytes, { flag: "wx", mode });
  chownSync(path, 0, 0); chmodSync(path, mode);
};
const originalControl = (): string => {
  for (const path of [roleBootstrapRoot, roleBootstrapRoot + "/control"]) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o022) !== 0) throw new Error("CONTROL_PARENT_INVALID");
  }
  return sha(readFileSync(roleBootstrapRoot + "/control/bootstrap-identities.json"));
};
const observe = (input: RegisteredProbeInputV1, context: OpsControlContextV1): CheckViewV1 => {
  const artifacts: string[] = [];
  const base = { id: "bootstrap.role-control-denials", owner: "ops", nextCommandId: "probe.show", links: { recordRefs: [], observations: [], artifactDigests: artifacts } } as const;
  let scratch: string | null = null;
  let cleanupComplete = false;
  let stage = "runtime-readback";
  try {
    const compiled = readFileSync(join(trustedCheckoutRoot(), "control/dist/bootstrap/denial-probe.js"));
    const nodeBytes = readFileSync(process.execPath);
    artifacts.push(sha(compiled), sha(nodeBytes), sha(readFileSync(import.meta.filename)));
    if (process.version !== "v24.21.0" || process.platform !== "darwin" || compiled.byteLength > 32768 || nodeBytes.byteLength > 268435456 || context.environment.stackId === null) throw new Error("DECLARED_RUNTIME_INVALID");
    stage = "control-readback";
    const controlDigest = originalControl();
    const uid = fixedId("-u"); const gid = fixedId("-g");
    if (uid < 300 || uid > 499 || uid !== gid) throw new Error("AGENT_IDENTITY_INVALID");
    const home = roleBootstrapRoot + "/state/homes/_toy_agent";
    const homeStat = lstatSync(home);
    if (!homeStat.isDirectory() || homeStat.isSymbolicLink() || homeStat.uid !== uid || homeStat.gid !== gid || (homeStat.mode & 0o7777) !== 0o700) throw new Error("AGENT_HOME_INVALID");
    const root = roleBootstrapRoot + "/control/protected-tests";
    directory(root); directory(join(root, "role-denials")); directory(join(root, "role-denials", context.environment.stackId));
    const target = join(root, "role-denials", context.environment.stackId, input.requestId);
    const cached = join(target, "receipt.json");
    if (existsSync(cached)) {
      directory(target);
      const stat = lstatSync(cached);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o7777) !== 0o444) throw new Error("PROTECTED_RECEIPT_INVALID");
      const previous = checkViewSchema.parse(JSON.parse(readFileSync(cached, "utf8")));
      if (previous.id !== base.id || previous.owner !== base.owner || !artifacts.every(digest => previous.links.artifactDigests.includes(digest))) throw new Error("PROTECTED_RECEIPT_STALE");
      return previous;
    }
    stage = "case-staging";
    directory(target);
    immutableFile(join(target, "entry.js"), compiled);
    immutableFile(join(target, "package.json"), '{"type":"module"}\n');
    const node = join(target, "node");
    copyFileSync(process.execPath, node, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
    chownSync(node, 0, 0); chmodSync(node, 0o555);
    const nodeStat = lstatSync(node);
    if (!nodeStat.isFile() || nodeStat.isSymbolicLink() || nodeStat.nlink !== 1 || nodeStat.uid !== 0 || nodeStat.gid !== 0 || (nodeStat.mode & 0o7777) !== 0o555 || sha(readFileSync(node)) !== artifacts[1]) throw new Error("SEALED_NODE_INVALID");
    const source = registeredCliProbeInventory.find(entry => entry.id === input.probeId);
    if (!source) throw new Error("SOURCE_ASSERTION_UNREGISTERED");
    const manifest = JSON.stringify({ probe: source, requestId: input.requestId, stackId: context.environment.stackId, controllerUid: process.getuid?.(), uid, gid, artifacts });
    immutableFile(join(target, "case-manifest.json"), manifest);
    const targetBefore = lstatSync(target);
    const canaries = roleControlDenialOperationSchema.options.filter(operation => operation !== "parent-replacement").map(operation => {
      const path = join(target, operation); const bytes = "nonsecret-control-canary:" + operation + ":" + input.requestId;
      immutableFile(path, bytes); const stat = lstatSync(path);
      return { path, bytes, inode: stat.ino, device: stat.dev };
    });
    mkdirSync(join(target, "parent-replacement"), { mode: 0o700 });
    const parentBefore = lstatSync(join(target, "parent-replacement"));
    scratch = join(home, "r0-denial-" + input.requestId);
    mkdirSync(scratch, { mode: 0o700 }); chownSync(scratch, uid, gid); chmodSync(scratch, 0o700);
    const scratchBefore = lstatSync(scratch);
    stage = "agent-execution";
    const child = spawnSync(node, [join(target, "entry.js"), target, scratch, String(uid), String(gid), input.requestId], {
      cwd: target, env: { ...environment, HOME: home }, encoding: "utf8", timeout: Math.min(context.timeoutMs, 10000),
      maxBuffer: 32768, killSignal: "SIGKILL", stdio: ["ignore", "pipe", "pipe"]
    });
    stage = "independent-readback";
    let parsed: unknown = null;
    try { parsed = JSON.parse(child.stdout); } catch { parsed = null; }
    const receipt = child.status === 0 && !child.error && child.stderr === "" ? roleControlDenialReceiptSchema.safeParse(parsed) : null;
    const canariesUnchanged = canaries.every(canary => {
      const stat = lstatSync(canary.path);
      return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.uid === 0 && stat.gid === 0 && (stat.mode & 0o7777) === 0o444 && stat.ino === canary.inode && stat.dev === canary.device && readFileSync(canary.path, "utf8") === canary.bytes;
    });
    const parentAfter = lstatSync(join(target, "parent-replacement")); const targetAfter = lstatSync(target);
    const protectedParentsUnchanged = parentAfter.isDirectory() && !parentAfter.isSymbolicLink() && parentAfter.uid === 0 && parentAfter.gid === 0 && parentAfter.ino === parentBefore.ino && parentAfter.dev === parentBefore.dev && (parentAfter.mode & 0o7777) === 0o700 && targetAfter.ino === targetBefore.ino && targetAfter.dev === targetBefore.dev;
    const observed = receipt?.success ? receipt.data : null;
    const identityVerified = observed !== null && observed.requestId === input.requestId && observed.uid === uid && observed.euid === uid && observed.gid === gid && observed.egid === gid && observed.groups.length === 1 && observed.groups[0] === gid;
    stage = "scratch-cleanup";
    let permittedScratchReadback = false;
    const scratchAfter = lstatSync(scratch);
    if (scratchAfter.isDirectory() && !scratchAfter.isSymbolicLink() && scratchAfter.uid === uid && scratchAfter.gid === gid && scratchAfter.ino === scratchBefore.ino && scratchAfter.dev === scratchBefore.dev) {
      const positive = join(scratch, "positive"); const link = join(scratch, "replacement-link"); const replacement = join(scratch, "replacement-directory");
      if (existsSync(positive)) {
        const stat = lstatSync(positive);
        permittedScratchReadback = stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.uid === uid && stat.gid === gid && (stat.mode & 0o7777) === 0o600 && readFileSync(positive, "utf8") === "permitted-agent-scratch";
        if (permittedScratchReadback) unlinkSync(positive);
      }
      try { if (lstatSync(link).isSymbolicLink() && readlinkSync(link) === "safe-nonsecret-target") unlinkSync(link); } catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error; }
      if (existsSync(replacement) && lstatSync(replacement).isDirectory() && !lstatSync(replacement).isSymbolicLink()) rmdirSync(replacement);
      rmdirSync(scratch); scratch = null; cleanupComplete = true;
    }
    stage = "receipt-retention";
    const pass = identityVerified && observed?.permittedScratchWrite === true && permittedScratchReadback && observed.attempts.every(attempt => attempt.denied) && canariesUnchanged && protectedParentsUnchanged && cleanupComplete && originalControl() === controlDigest;
    const result = checkViewSchema.parse({ ...base, checkedAt: new Date().toISOString(), state: pass ? "PASS" : "FAIL", reasonCode: pass ? "ACTUAL_AGENT_OS_CONTROL_DENIALS_VERIFIED" : "ACTUAL_AGENT_OS_CONTROL_DENIALS_FAILED", prerequisite: JSON.stringify({ controllerUid: process.getuid?.(), receipt: observed, permittedScratchReadback, canariesUnchanged, protectedParentsUnchanged, originalControlReceiptUnchanged: originalControl() === controlDigest, cleanupComplete, childExitCode: child.status, childErrorCode: child.error && "code" in child.error ? child.error.code : null, childStderrBytes: Buffer.byteLength(child.stderr ?? ""), sourceAssertionHash: source.sourceAssertionHash }), links: { ...base.links, artifactDigests: [...artifacts, sha(manifest), controlDigest] } });
    immutableFile(cached, JSON.stringify(result));
    return result;
  } catch {
    return checkViewSchema.parse({ ...base, checkedAt: new Date().toISOString(), state: "BLOCKED", reasonCode: "ACTUAL_AGENT_CONTROL_PROBE_UNAVAILABLE", prerequisite: JSON.stringify({ stage, cleanupComplete, scratchRetained: scratch !== null, wholeATComplete: false }), links: base.links });
  }
};

export const RoleControlProbe = {
  run(input: RegisteredProbeInputV1, context: OpsControlContextV1): Result<RegisteredProbeOperationV1> {
    const invalid = (code: "INVALID_INPUT" | "UNAUTHORIZED"): Result<RegisteredProbeOperationV1> => ({ ok: false, error: { module: "ops", code, retryable: false, message: opsErrorMessages[code] } });
    if (!opsControlContextSchema.safeParse(context).success || !registeredProbeInputSchema.safeParse(input).success || input.probeId !== "AT-authority-35" || input.caseId !== "control-filesystem-denial") return invalid("INVALID_INPUT");
    if (context.environment.kind !== "test" || context.environment.stackId === null || process.getuid?.() !== 0 || process.geteuid?.() !== 0) return invalid("UNAUTHORIZED");
    const owned = fixtureStackInspect(context);
    if (!owned.ok) return owned;
    if (!owned.data.result?.ready) return invalid("UNAUTHORIZED");
    return FixtureProbe.run(input, context, [observe(input, context)]);
  }
};
