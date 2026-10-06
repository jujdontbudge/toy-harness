import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, chownSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  digestSchema, roleBootstrapReportSchema, roleBootstrapRoot, siwcControlRuntimeBackupSchema,
  siwcControlRuntimeReceiptSchema, siwcControlRuntimeReportSchema, siwcControlStageReportSchema, uuidSchema
} from "@toy/contracts";
import type { SiwcControlRuntimeBackupV1, SiwcControlRuntimeReceiptV1, SiwcControlRuntimeReportV1 } from "@toy/contracts";

const root = resolve(import.meta.dirname, "..");
const environment = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" };
const [requestId, artifactDigest, expectedChildDigest] = process.argv.slice(2);
const restoreOnly = process.argv[5] === "restore";
if (requestId === undefined || !uuidSchema.safeParse(requestId).success || artifactDigest === undefined || !digestSchema.safeParse(artifactDigest).success
  || expectedChildDigest === undefined || !digestSchema.safeParse(expectedChildDigest).success || process.argv.length !== (restoreOnly ? 6 : 5) || !process.getuid || !process.geteuid) process.exit(2);
const sha = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
const control = roleBootstrapRoot + "/control";
const releaseParent = control + "/releases";
const release = join(releaseParent, artifactDigest);
const payload = join(release, "payload");
const requestDirectory = join(releaseParent, "runtime-probe-" + requestId);
const original = control + "/bootstrap-identities.json";
let controlUid: number | null = null;
let controlGid: number | null = null;
let childDigest: string | null = null;
let backupDigest: string | null = null;
let bootstrapReceiptDigest: string | null = null;
let artifactVerified = false;
let backupWritten = false;
let parentModesRestored = false;
let bootstrapReceiptUnchanged = false;
let child: SiwcControlRuntimeReceiptV1 | null = null;
let backup: SiwcControlRuntimeBackupV1 | null = null;
let reason: SiwcControlRuntimeReportV1["reason"] = "CONTROL_RUNTIME_UNAVAILABLE";
const output = (): void => {
  const state = reason === "CONTROL_RUNTIME_READ_VERIFIED" ? "verified" : reason === "PARENTS_RESTORED" ? "restored" : "blocked";
  const report = siwcControlRuntimeReportSchema.parse({ schemaVersion: "toy.siwc-control-runtime-report.v1", requestId, observedAt: new Date().toISOString(),
    artifactDigest, state, reason, callerUid: process.getuid?.(), controlUid, controlGid, childDigest, backupDigest, bootstrapReceiptDigest,
    artifactVerified, backupWritten, parentModesRestored, bootstrapReceiptUnchanged, child,
    keychainCalled: child !== null && child.keychainState !== "not_called", credentialBytesCaptured: false, credentialWritten: false,
    currentPointerChanged: false, servicesActivated: false, liveProviderSends: 0, acceptanceComplete: false });
  if (backupWritten && !restoreOnly) writeFileSync(join(requestDirectory, "result.json"), JSON.stringify(report) + "\n", { flag: "wx", mode: 0o600 });
  process.stdout.write(JSON.stringify(report) + "\n");
  process.exitCode = state === "blocked" ? 5 : 0;
};
export const SiwcControlRuntimeProbe = {
  async run(): Promise<void> {
    if (process.getuid?.() !== 0 || process.geteuid?.() !== 0) { reason = "ROOT_CALLER_REQUIRED"; output(); return; }
    let interrupted = false;
    let activeChild: ChildProcess | null = null;
    const signals = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT", "SIGTSTP"] as const;
    const interrupt = (): void => { interrupted = true; activeChild?.kill("SIGKILL"); };
    for (const signal of signals) process.on(signal, interrupt);
    try {
      if (process.platform !== "darwin" || process.version !== "v24.21.0") throw new Error("PLATFORM_INVALID");
      process.umask(0o077);
      if (restoreOnly) {
        for (const path of [control, releaseParent, requestDirectory]) {
          const stat = lstatSync(path);
          if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) !== 0) throw new Error("BACKUP_PARENT_INVALID");
        }
        const backupPath = join(requestDirectory, "before.json");
        const stat = lstatSync(backupPath);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o7777) !== 0o600 || stat.size > 16384) throw new Error("BACKUP_UNVERIFIED");
        const bytes = readFileSync(backupPath);
        const saved = siwcControlRuntimeBackupSchema.parse(JSON.parse(bytes.toString("utf8")));
        if (saved.requestId !== requestId || saved.artifactDigest !== artifactDigest || saved.childDigest !== expectedChildDigest
          || saved.bootstrapReceiptDigest !== "980a7bbd94f61e8a5e4d0bec1860555091e7aa303b7981df4392a6f5ee49fe65") throw new Error("BACKUP_UNVERIFIED");
        backup = saved; backupDigest = sha(bytes); childDigest = saved.childDigest; bootstrapReceiptDigest = saved.bootstrapReceiptDigest; backupWritten = true;
        reason = "PARENTS_RESTORED";
      } else {
      const verified = spawnSync(process.execPath, [join(root, "scripts/stage-siwc-control-runtime.mts"), "verify", requestId, artifactDigest], {
        env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000, maxBuffer: 16384
      });
      if (verified.error || verified.status !== 0) throw new Error("STAGED_ARTIFACT_UNVERIFIED");
      const stage = siwcControlStageReportSchema.parse(JSON.parse(verified.stdout));
      if (stage.state !== "verified" || stage.artifactDigest !== artifactDigest || !stage.ownershipVerified || !stage.relocationVerified
        || stage.controlUid === null || stage.controlGid === null || stage.bootstrapReceiptDigest !== "980a7bbd94f61e8a5e4d0bec1860555091e7aa303b7981df4392a6f5ee49fe65") throw new Error("STAGED_ARTIFACT_UNVERIFIED");
      artifactVerified = true; controlUid = stage.controlUid; controlGid = stage.controlGid; bootstrapReceiptDigest = stage.bootstrapReceiptDigest;
      const identity = roleBootstrapReportSchema.parse(JSON.parse(readFileSync(original, "utf8"))).roles.find(role => role.observation.role === "_toy_control")?.observation;
      if (identity?.uid !== controlUid || identity.gid !== controlGid || identity.adminGroupObserved !== false) throw new Error("CONTROL_IDENTITY_CHANGED");
      for (const [flag, expected] of [["-u", controlUid], ["-g", controlGid]] as const) {
        const observed = spawnSync("/usr/bin/id", [flag, "_toy_control"], { env: environment, encoding: "utf8", timeout: 2000, maxBuffer: 1024 });
        if (observed.error || observed.status !== 0 || observed.stdout.trim() !== String(expected)) throw new Error("CONTROL_IDENTITY_CHANGED");
      }
      const membership = spawnSync("/usr/bin/id", ["-Gn", "_toy_control"], { env: environment, encoding: "utf8", timeout: 2000, maxBuffer: 4096 });
      if (membership.error || membership.status !== 0 || membership.stdout.trim().split(/\s+/).some(group => group === "admin" || group === "wheel")) throw new Error("CONTROL_IDENTITY_PRIVILEGED");
      for (const path of ["/", "/Library", "/Library/Application Support", roleBootstrapRoot, release, payload]) {
        const stat = lstatSync(path);
        const execute = stat.uid === controlUid ? 0o100 : stat.gid === controlGid ? 0o010 : 0o001;
        if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) !== 0 || (stat.mode & execute) === 0) throw new Error("CONTROL_ANCESTOR_INACCESSIBLE");
      }
      const source = readFileSync(join(root, "control/dist/bootstrap/siwc-runtime-probe.js"));
      childDigest = sha(source);
      if (childDigest !== expectedChildDigest) throw new Error("PROBE_SOURCE_CHANGED");
      const parents = [control, releaseParent].map(path => {
        const stat = lstatSync(path);
        if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o7777) !== 0o700) throw new Error("PARENT_INVALID");
        return { path, uid: stat.uid, gid: stat.gid, mode: "0700", device: String(stat.dev), inode: String(stat.ino) };
      });
      if (existsSync(requestDirectory)) throw new Error("REQUEST_EXISTS");
      backup = siwcControlRuntimeBackupSchema.parse({ schemaVersion: "toy.siwc-control-runtime-backup.v1", requestId, observedAt: new Date().toISOString(), artifactDigest, childDigest, bootstrapReceiptDigest, parents });
      const backupBytes = JSON.stringify(backup) + "\n";
      backupDigest = sha(backupBytes);
      mkdirSync(requestDirectory, { mode: 0o700 });
      const backupPath = join(requestDirectory, "before.json");
      writeFileSync(backupPath, backupBytes, { flag: "wx", mode: 0o600 }); chownSync(backupPath, 0, 0); chmodSync(backupPath, 0o600);
      const backupStat = lstatSync(backupPath);
      if (!backupStat.isFile() || backupStat.isSymbolicLink() || backupStat.nlink !== 1 || backupStat.uid !== 0 || backupStat.gid !== 0
        || (backupStat.mode & 0o7777) !== 0o600 || sha(readFileSync(backupPath)) !== backupDigest) throw new Error("BACKUP_UNVERIFIED");
      backupWritten = true;
      const entry = join(requestDirectory, "probe.js");
      writeFileSync(entry, source, { flag: "wx", mode: 0o440 }); chownSync(entry, 0, controlGid); chmodSync(entry, 0o440);
      chownSync(requestDirectory, 0, controlGid); chmodSync(requestDirectory, 0o550);
      const sealed = lstatSync(entry);
      if (!sealed.isFile() || sealed.isSymbolicLink() || sealed.nlink !== 1 || sealed.uid !== 0 || sealed.gid !== controlGid || (sealed.mode & 0o7777) !== 0o440 || sha(readFileSync(entry)) !== childDigest) throw new Error("PROBE_UNSEALED");
      await new Promise<void>(resolveImmediate => setImmediate(resolveImmediate));
      if (interrupted) throw new Error("PROBE_INTERRUPTED");
      for (const parent of backup.parents) chmodSync(parent.path, 0o711);
      const measured = await new Promise<string>((resolveChild, rejectChild) => {
        const measuredChild = spawn(join(payload, "runtime/node"), [entry, payload, String(controlUid), String(controlGid), requestId], {
          cwd: payload, env: { ...environment, HOME: roleBootstrapRoot + "/state/homes/_toy_control" }, stdio: ["ignore", "pipe", "ignore"]
        });
        activeChild = measuredChild;
        const chunks: Buffer[] = [];
        let bytes = 0;
        let failed = false;
        const timeout = setTimeout(() => { failed = true; measuredChild.kill("SIGKILL"); }, 15000);
        measuredChild.stdout?.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 4096) { failed = true; measuredChild.kill("SIGKILL"); }
          else chunks.push(chunk);
        });
        measuredChild.on("error", () => { failed = true; });
        measuredChild.on("close", (code, signal) => {
          clearTimeout(timeout); activeChild = null;
          if (failed || interrupted || signal !== null || code !== 0 && code !== 5) rejectChild(new Error("PROBE_CHILD_UNAVAILABLE"));
          else resolveChild(Buffer.concat(chunks).toString("utf8"));
        });
      });
      child = siwcControlRuntimeReceiptSchema.parse(JSON.parse(measured));
      if (child.requestId !== requestId || child.uid !== controlUid || child.euid !== controlUid || child.gid !== controlGid || child.egid !== controlGid || child.groups.length !== 1 || child.groups[0] !== controlGid) throw new Error("PROBE_CHILD_IDENTITY_CHANGED");
      reason = child.moduleImported && (child.keychainState === "absent" || child.keychainState === "present") ? "CONTROL_RUNTIME_READ_VERIFIED"
        : child.moduleImported && child.keychainState === "unavailable" ? "CONTROL_KEYCHAIN_READ_UNAVAILABLE" : "CONTROL_RUNTIME_UNAVAILABLE";
      }
    } catch { reason = "CONTROL_RUNTIME_UNAVAILABLE"; }
    finally {
      if (backup !== null) {
        parentModesRestored = true;
        for (const parent of [...backup.parents].reverse()) {
          try {
            const before = lstatSync(parent.path);
            if (!before.isDirectory() || before.isSymbolicLink() || String(before.dev) !== parent.device || String(before.ino) !== parent.inode || before.uid !== parent.uid || before.gid !== parent.gid) throw new Error("PARENT_IDENTITY_CHANGED");
            if ((before.mode & 0o7777) !== 0o700) chmodSync(parent.path, 0o700);
            const after = lstatSync(parent.path);
            if ((after.mode & 0o7777) !== 0o700 || after.uid !== parent.uid || after.gid !== parent.gid || String(after.dev) !== parent.device || String(after.ino) !== parent.inode) throw new Error("PARENT_RESTORE_UNCONFIRMED");
          } catch { parentModesRestored = false; }
        }
        if (!parentModesRestored) reason = "PARENT_RESTORE_FAILED";
      }
      try { bootstrapReceiptUnchanged = bootstrapReceiptDigest !== null && sha(readFileSync(original)) === bootstrapReceiptDigest; }
      catch { bootstrapReceiptUnchanged = false; }
      if (reason === "CONTROL_RUNTIME_READ_VERIFIED" && (!parentModesRestored || !bootstrapReceiptUnchanged || !backupWritten)) reason = "CONTROL_RUNTIME_UNAVAILABLE";
      if (reason === "PARENTS_RESTORED" && (!parentModesRestored || !bootstrapReceiptUnchanged || !backupWritten)) reason = "PARENT_RESTORE_FAILED";
      for (const signal of signals) process.off(signal, interrupt);
    }
    output();
  }
};
await SiwcControlRuntimeProbe.run();
