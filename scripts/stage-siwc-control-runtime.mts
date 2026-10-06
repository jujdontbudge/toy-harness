import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, chownSync, existsSync, lchownSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, realpathSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { digestSchema, roleBootstrapReportSchema, roleBootstrapRoot, schemaBundleDigest, siwcControlStageEntrySchema, siwcControlStageManifestSchema, siwcControlStageReportSchema, uuidSchema } from "@toy/contracts";
import type { SiwcControlStageEntryV1, SiwcControlStageManifestV1, SiwcControlStageReportV1 } from "@toy/contracts";

const root = resolve(import.meta.dirname, "..");
const candidates = join(root, "build/.siwc-control-staging");
const pythonRoot = "/Users/johansardar/.local/share/uv/python/cpython-3.14.7-macos-aarch64-none";
const sha = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");
const environment = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" };
const [operation, requestId, suppliedDigest] = process.argv.slice(2);
if (!uuidSchema.safeParse(requestId).success || requestId === undefined || !["prepare", "stage", "verify"].includes(operation ?? "") || process.argv.length !== (operation === "prepare" ? 4 : 5) || operation !== "prepare" && !digestSchema.safeParse(suppliedDigest).success || !process.getuid || !process.geteuid) process.exit(2);
let artifactDigest: string | null = suppliedDigest ?? null;
let manifest: SiwcControlStageManifestV1 | null = null;
let controlUid: number | null = null;
let controlGid: number | null = null;
let finalPath: string | null = null;
let bootstrapReceiptDigest: string | null = null;
let relocationVerified = false;
let ownershipVerified = false;
let preservedPartialStage = false;
const output = (state: SiwcControlStageReportV1["state"], reason: SiwcControlStageReportV1["reason"]): void => {
  const value = siwcControlStageReportSchema.parse({ schemaVersion: "toy.siwc-control-stage-report.v1", requestId, observedAt: new Date().toISOString(), operation, state, reason, artifactDigest, fileCount: manifest?.entries.filter(entry => entry.kind === "file").length ?? 0, bytes: String(manifest?.entries.reduce((total, entry) => total + BigInt(entry.bytes), 0n) ?? 0n), callerUid: process.getuid?.(), controlUid, controlGid, finalPath, bootstrapReceiptDigest, relocationVerified, ownershipVerified, preservedPartialStage, currentPointerChanged: false, servicesActivated: false, keychainCalled: false, liveProviderSends: 0, acceptanceComplete: false });
  process.stdout.write(JSON.stringify(value) + "\n");
  process.exitCode = state === "blocked" ? 5 : 0;
};
const inside = (base: string, path: string): boolean => { const value = relative(base, path); return value === "" || !isAbsolute(value) && value !== ".." && !value.startsWith("../"); };
const privateDirectory = (path: string, uid: number, gid: number, mode = 0o700): void => {
  if (!existsSync(path)) mkdirSync(path, { mode });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid || stat.gid !== gid || (stat.mode & 0o7777) !== mode) throw new Error("DIRECTORY_INVALID");
};
const write = (path: string, bytes: Buffer | string, uid: number, gid: number, mode: number): void => {
  writeFileSync(path, bytes, { flag: "wx", mode });
  chownSync(path, uid, gid); chmodSync(path, mode);
};
const inventory = (source: string, destination: string, entries: SiwcControlStageEntryV1[], sources: Map<string, string>): void => {
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) {
    const target = readlinkSync(source);
    if (isAbsolute(target) || !inside(pythonRoot, realpathSync(source)) || !inside("/payload", resolve("/payload", dirname(destination), target))) throw new Error("SOURCE_LINK_INVALID");
    entries.push(siwcControlStageEntrySchema.parse({ path: destination, kind: "link", mode: "0550", bytes: "0", digest: null, target })); sources.set(destination, source); return;
  }
  if (stat.isDirectory()) {
    entries.push(siwcControlStageEntrySchema.parse({ path: destination, kind: "directory", mode: "0550", bytes: "0", digest: null, target: null }));
    for (const name of readdirSync(source).sort()) {
      if (name === "__pycache__" || name.endsWith(".pyc")) continue;
      inventory(join(source, name), join(destination, name), entries, sources);
    }
    return;
  }
  if (!stat.isFile() || stat.nlink < 1 || stat.size > 268435456) throw new Error("SOURCE_FILE_INVALID");
  const bytes = readFileSync(source);
  entries.push(siwcControlStageEntrySchema.parse({ path: destination, kind: "file", mode: (stat.mode & 0o111) === 0 ? "0440" : "0550", bytes: String(bytes.byteLength), digest: sha(bytes), target: null })); sources.set(destination, source);
};
const copyEntries = (sourceRoot: string, target: string, value: SiwcControlStageManifestV1, uid: number, gid: number): void => {
  for (const entry of value.entries.filter(entry => entry.kind === "directory").sort((a, b) => a.path.length - b.path.length)) {
    mkdirSync(join(target, entry.path), { recursive: false, mode: 0o700 }); chownSync(join(target, entry.path), uid, gid);
  }
  for (const entry of value.entries.filter(entry => entry.kind !== "directory")) {
    const path = join(target, entry.path);
    if (entry.kind === "link") {
      if (entry.target === null || isAbsolute(entry.target) || !inside(target, resolve(dirname(path), entry.target))) throw new Error("ARTIFACT_LINK_INVALID");
      symlinkSync(entry.target, path); lchownSync(path, uid, gid);
    } else {
      const source = join(sourceRoot, entry.path); const stat = lstatSync(source);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== Number(entry.bytes)) throw new Error("ARTIFACT_FILE_INVALID");
      const bytes = readFileSync(source);
      if (sha(bytes) !== entry.digest) throw new Error("ARTIFACT_CHANGED");
      write(path, bytes, uid, gid, Number.parseInt(entry.mode, 8));
    }
  }
  for (const entry of value.entries.filter(entry => entry.kind === "directory").sort((a, b) => b.path.length - a.path.length)) chmodSync(join(target, entry.path), Number.parseInt(entry.mode, 8));
};
const verifyEntries = (target: string, value: SiwcControlStageManifestV1, uid: number, gid: number): void => {
  const expected = new Set(value.entries.map(entry => entry.path));
  const visit = (path: string): void => {
    for (const name of readdirSync(path).sort()) {
      const child = join(path, name); const key = relative(target, child);
      if (!expected.has(key)) throw new Error("ARTIFACT_INVENTORY_INVALID");
      if (lstatSync(child).isDirectory()) visit(child);
    }
  };
  visit(target);
  for (const entry of value.entries) {
    const path = join(target, entry.path); const stat = lstatSync(path);
    if (stat.uid !== uid || stat.gid !== gid) throw new Error("ARTIFACT_OWNER_INVALID");
    if (entry.kind === "link") {
      if (!stat.isSymbolicLink() || readlinkSync(path) !== entry.target || !inside(target, realpathSync(path))) throw new Error("ARTIFACT_LINK_INVALID");
    } else if (stat.isSymbolicLink() || (stat.mode & 0o7777) !== Number.parseInt(entry.mode, 8) || entry.kind === "directory" && !stat.isDirectory() || entry.kind === "file" && (!stat.isFile() || stat.nlink !== 1 || String(stat.size) !== entry.bytes || sha(readFileSync(path)) !== entry.digest)) throw new Error("ARTIFACT_INVALID");
  }
};
const runtimeProbe = (payload: string): void => {
  const node = spawnSync(join(payload, "runtime/node"), ["--version"], { env: environment, encoding: "utf8", timeout: 5000, maxBuffer: 1024 });
  if (node.error || node.status !== 0 || node.stdout.trim() !== "v24.21.0" || node.stderr !== "") throw new Error("NODE_RUNTIME_INVALID");
  const python = spawnSync(join(payload, "runtime/python/bin/python3"), ["-I", "-S", "-B", "-c", "import ctypes,json,pathlib,sys; ctypes.CDLL('/System/Library/Frameworks/Security.framework/Security'); print(json.dumps({'version':sys.version.split()[0],'prefix':str(pathlib.Path(sys.prefix).resolve()),'ctypes':str(pathlib.Path(ctypes.__file__).resolve())}))"], { env: environment, encoding: "utf8", timeout: 10000, maxBuffer: 4096 });
  if (python.error || python.status !== 0 || python.stderr !== "") throw new Error("PYTHON_RUNTIME_INVALID");
  const raw: unknown = JSON.parse(python.stdout);
  if (raw === null || typeof raw !== "object" || !("version" in raw) || raw.version !== "3.14.7" || !("prefix" in raw) || raw.prefix !== join(payload, "runtime/python") || !("ctypes" in raw) || typeof raw.ctypes !== "string" || !inside(join(payload, "runtime/python"), raw.ctypes)) throw new Error("PYTHON_RELOCATION_INVALID");
  relocationVerified = true;
};
export const SiwcControlStage = {
  run(): void {
    if (operation !== "prepare" && (process.getuid?.() !== 0 || process.geteuid?.() !== 0)) { output("blocked", "ROOT_CALLER_REQUIRED"); return; }
    try {
      if (process.platform !== "darwin" || process.version !== "v24.21.0") throw new Error("PLATFORM_INVALID");
      if (operation === "prepare") {
        const uid = process.getuid?.(); const gid = process.getgid?.();
        if (uid === undefined || gid === undefined || uid === 0) throw new Error("PREPARER_INVALID");
        privateDirectory(candidates, uid, gid);
        const temporary = mkdtempSync(join(candidates, "prepare-"));
        const inputs = new Map<string, string>([["runtime/node", process.execPath], ["runtime/python", pythonRoot], ["control/dist/secrets", join(root, "control/dist/secrets")], ["packages/contracts/dist", join(root, "packages/contracts/dist")], ["packages/contracts/package.json", join(root, "packages/contracts/package.json")], ["node_modules/zod", dirname(fileURLToPath(import.meta.resolve("zod/package.json")))], ["python/toy_control/siwc_keychain.py", join(root, "python/toy_control/siwc_keychain.py")]]);
        const entries: SiwcControlStageEntryV1[] = []; const sources = new Map<string, string>();
        for (const [destination, source] of inputs) inventory(source, destination, entries, sources);
        const extra = new Map<string, string>([["package.json", '{"name":"toy-siwc-control-runtime","type":"module","private":true}\n']]);
        for (const [path, text] of extra) entries.push(siwcControlStageEntrySchema.parse({ path, kind: "file", mode: "0440", bytes: String(Buffer.byteLength(text)), digest: sha(text), target: null }));
        entries.push(siwcControlStageEntrySchema.parse({ path: "node_modules/@toy/contracts", kind: "link", mode: "0550", bytes: "0", digest: null, target: "../../packages/contracts" }));
        const existing = new Set(entries.map(entry => entry.path));
        for (const entry of [...entries]) {
          let parent = dirname(entry.path);
          while (parent !== ".") {
            if (!existing.has(parent)) { entries.push(siwcControlStageEntrySchema.parse({ path: parent, kind: "directory", mode: "0550", bytes: "0", digest: null, target: null })); existing.add(parent); }
            parent = dirname(parent);
          }
        }
        manifest = siwcControlStageManifestSchema.parse({ schemaVersion: "toy.siwc-control-stage-manifest.v1", schemaDigest: schemaBundleDigest, nodeVersion: "24.21.0", pythonVersion: "3.14.7", zodVersion: "4.6.5", sourceLockDigest: sha(readFileSync(join(root, "package-lock.json"))), entries: entries.sort((a, b) => a.path.localeCompare(b.path)) });
        const manifestText = JSON.stringify(manifest);
        artifactDigest = sha(manifestText);
        const frozen = join(candidates, artifactDigest);
        const payload = join(temporary, "payload"); mkdirSync(payload, { mode: 0o700 });
        for (const entry of manifest.entries.filter(entry => entry.kind === "directory").sort((a, b) => a.path.length - b.path.length)) mkdirSync(join(payload, entry.path), { mode: 0o700 });
        for (const entry of manifest.entries.filter(entry => entry.kind !== "directory")) {
          const path = join(payload, entry.path);
          if (entry.kind === "link") { if (entry.target === null) throw new Error("LINK_INVALID"); symlinkSync(entry.target, path); }
          else { const source = sources.get(entry.path); const bytes = source === undefined ? extra.get(entry.path) : readFileSync(source); if (bytes === undefined || sha(bytes) !== entry.digest) throw new Error("SOURCE_CHANGED"); write(path, bytes, uid, gid, Number.parseInt(entry.mode, 8)); }
        }
        for (const entry of manifest.entries.filter(entry => entry.kind === "directory").sort((a, b) => b.path.length - a.path.length)) chmodSync(join(payload, entry.path), 0o550);
        verifyEntries(payload, manifest, uid, gid); runtimeProbe(payload);
        write(join(temporary, "manifest.json"), manifestText, uid, gid, 0o440);
        if (existsSync(frozen)) { const previous = readFileSync(join(frozen, "manifest.json")); if (sha(previous) !== artifactDigest) throw new Error("FROZEN_ARTIFACT_INVALID"); verifyEntries(join(frozen, "payload"), manifest, uid, gid); }
        else renameSync(temporary, frozen);
        output("prepared", "ARTIFACT_PREPARED"); return;
      }
      if (artifactDigest === null) throw new Error("ARTIFACT_ID_REQUIRED");
      for (const path of ["/", "/Library", "/Library/Application Support", roleBootstrapRoot, roleBootstrapRoot + "/control"]) {
        const stat = lstatSync(path);
        if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || ![0, ...(path === "/Library/Application Support" ? [80] : [])].includes(stat.gid) || (stat.mode & 0o022) !== 0) throw new Error("PROTECTED_PARENT_INVALID");
      }
      const original = roleBootstrapRoot + "/control/bootstrap-identities.json";
      const originalStat = lstatSync(original);
      if (!originalStat.isFile() || originalStat.isSymbolicLink() || originalStat.uid !== 0 || originalStat.gid !== 0 || originalStat.nlink !== 1 || (originalStat.mode & 0o7777) !== 0o600 || originalStat.size > 131072) throw new Error("BOOTSTRAP_RECEIPT_INVALID");
      const bootstrapBytes = readFileSync(original); const bootstrap = roleBootstrapReportSchema.parse(JSON.parse(bootstrapBytes.toString("utf8")));
      if (bootstrap.state !== "created" || bootstrap.callerUid !== 0 || bootstrap.accountsVerified !== 8) throw new Error("BOOTSTRAP_RECEIPT_INVALID");
      bootstrapReceiptDigest = sha(bootstrapBytes);
      const identity = bootstrap.roles.find(role => role.observation.role === "_toy_control")?.observation;
      if (identity?.uid === null || identity?.uid === undefined || identity.gid === null || identity.adminGroupObserved !== false) throw new Error("CONTROL_IDENTITY_INVALID");
      for (const [flag, expected] of [["-u", identity.uid], ["-g", identity.gid]] as const) {
        const child = spawnSync("/usr/bin/id", [flag, "_toy_control"], { env: environment, encoding: "utf8", timeout: 2000, maxBuffer: 1024 });
        if (child.error || child.status !== 0 || child.stdout.trim() !== String(expected)) throw new Error("CONTROL_IDENTITY_CHANGED");
      }
      controlUid = identity.uid; controlGid = identity.gid;
      const releaseParent = roleBootstrapRoot + "/control/releases";
      if (operation === "stage") privateDirectory(releaseParent, 0, 0);
      else { const stat = lstatSync(releaseParent); if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o7777) !== 0o700) throw new Error("RELEASE_PARENT_INVALID"); }
      finalPath = join(releaseParent, artifactDigest);
      const frozen = join(candidates, artifactDigest);
      const manifestPath = operation === "stage" ? join(frozen, "manifest.json") : join(finalPath, "manifest.json");
      const stat = lstatSync(manifestPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4194304 || (stat.mode & 0o222) !== 0 || operation === "verify" && (stat.uid !== 0 || stat.gid !== controlGid)) throw new Error("MANIFEST_INVALID");
      const manifestBytes = readFileSync(manifestPath);
      if (sha(manifestBytes) !== artifactDigest) throw new Error("ARTIFACT_ID_CHANGED");
      manifest = siwcControlStageManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
      if (operation === "stage") {
        if (existsSync(finalPath)) throw new Error("RELEASE_EXISTS");
        mkdirSync(finalPath, { mode: 0o700 }); preservedPartialStage = true;
        const payload = join(finalPath, "payload"); mkdirSync(payload, { mode: 0o700 }); chownSync(payload, 0, controlGid);
        copyEntries(join(frozen, "payload"), payload, manifest, 0, controlGid);
        verifyEntries(payload, manifest, 0, controlGid); runtimeProbe(payload);
        write(join(finalPath, "manifest.json"), manifestBytes, 0, controlGid, 0o440);
        chownSync(finalPath, 0, controlGid); chmodSync(payload, 0o550); chmodSync(finalPath, 0o550);
        preservedPartialStage = false;
      }
      for (const path of [finalPath, join(finalPath, "payload")]) { const stat = lstatSync(path); if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || stat.gid !== controlGid || (stat.mode & 0o7777) !== 0o550) throw new Error("STAGED_PARENT_INVALID"); }
      verifyEntries(join(finalPath, "payload"), manifest, 0, controlGid); runtimeProbe(join(finalPath, "payload")); ownershipVerified = true;
      if (sha(readFileSync(original)) !== bootstrapReceiptDigest) throw new Error("BOOTSTRAP_RECEIPT_CHANGED");
      output(operation === "stage" ? "staged" : "verified", operation === "stage" ? "ROOT_ARTIFACT_STAGED" : "ROOT_ARTIFACT_VERIFIED");
    } catch { output("blocked", "ARTIFACT_UNAVAILABLE"); }
  }
};
SiwcControlStage.run();
