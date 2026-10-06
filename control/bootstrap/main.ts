import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, chownSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import {
  roleBootstrapDirectorySchema, roleBootstrapInputSchema, roleBootstrapReportSchema, roleBootstrapRoleSchema,
  roleBootstrapRoot, serviceRoleNameSchema
} from "@toy/contracts";
import type { RoleBootstrapInputV1, RoleBootstrapReportV1, RoleBootstrapRoleV1, ServiceRoleIdentityObservationV1 } from "@toy/contracts";

const directories = roleBootstrapDirectorySchema.array().parse([
  { path: roleBootstrapRoot, owner: "root", mode: "0711" },
  { path: roleBootstrapRoot + "/control", owner: "root", mode: "0700" },
  { path: roleBootstrapRoot + "/state", owner: "root", mode: "0711" },
  { path: roleBootstrapRoot + "/state/homes", owner: "root", mode: "0711" },
  { path: roleBootstrapRoot + "/run", owner: "root", mode: "0711" },
  ...serviceRoleNameSchema.options.map(role => ({ path: roleBootstrapRoot + "/state/homes/" + role, owner: role, mode: "0700" }))
]);
const timeoutMs = Number(process.argv[2]);
if (process.platform !== "darwin" || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000 || !process.getuid || !process.geteuid) process.exit(2);
const callerUid = process.getuid();
const deadline = process.hrtime.bigint() + BigInt(timeoutMs - 50) * 1000000n;
const command = (file: "/usr/bin/dscl" | "/usr/bin/id" | "/usr/bin/pwpolicy", args: string[]): string => {
  const remaining = Math.min(10000, Number((deadline - process.hrtime.bigint()) / 1000000n));
  if (remaining < 1) throw new Error("DEADLINE");
  const child = spawnSync(file, args, {
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C" }, encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"], maxBuffer: 262144, timeout: remaining, killSignal: "SIGKILL"
  });
  if (child.error && "code" in child.error && child.error.code === "ETIMEDOUT") throw new Error("OS_COMMAND_TIMEOUT");
  if (child.error || child.status !== 0) throw new Error(/Operation not permitted|Permission denied/i.test(child.stderr) ? "OS_COMMAND_DENIED" : "OS_COMMAND_FAILED");
  return child.stdout;
};
const list = (path: "/Users" | "/Groups", key: "UniqueID" | "PrimaryGroupID") => {
  const rows = command("/usr/bin/dscl", ["/Local/Default", "-list", path, key]).trim().split("\n");
  const entries = rows.map(row => {
    const match = /^(\S+)\s+(-?[0-9]+)\s*$/.exec(row);
    const name = match?.[1]; const id = match?.[2];
    if (name === undefined || id === undefined || BigInt(id) < -2147483648n || BigInt(id) > 4294967295n) throw new Error("INVALID_DIRECTORY_LIST");
    return { name, id: String(BigInt.asUintN(32, BigInt(id))) };
  }).sort((a, b) => a.name.localeCompare(b.name));
  if (new Set(entries.map(row => row.name)).size !== entries.length) throw new Error("DUPLICATE_RECORD_NAME");
  return entries;
};
const unknown = (role: ServiceRoleIdentityObservationV1["role"]): ServiceRoleIdentityObservationV1 => ({ role, state: "unknown", uid: null, gid: null, adminGroupObserved: null });
const observe = (role: ServiceRoleIdentityObservationV1["role"]): ServiceRoleIdentityObservationV1 => {
  try {
    const uidText = command("/usr/bin/id", ["-u", role]).trim();
    const gidText = command("/usr/bin/id", ["-g", role]).trim();
    if (!/^[0-9]+$/.test(uidText) || !/^[0-9]+$/.test(gidText)) return unknown(role);
    const groups = command("/usr/bin/id", ["-Gn", role]).trim().split(/\s+/);
    return { role, state: "observed", uid: Number(uidText), gid: Number(gidText), adminGroupObserved: groups.includes("admin") || groups.includes("wheel") };
  } catch { return unknown(role); }
};
const run = (input: RoleBootstrapInputV1): RoleBootstrapReportV1 => {
  let roles: RoleBootstrapRoleV1[] = serviceRoleNameSchema.options.map(role => ({ observation: unknown(role), candidateUid: null, candidateGid: null }));
  let snapshotDigest: string | null = null;
  let accountsVerified = 0;
  let effectsStarted = false;
  const report = (state: RoleBootstrapReportV1["state"], reasonCode: RoleBootstrapReportV1["reasonCode"]): RoleBootstrapReportV1 => roleBootstrapReportSchema.parse({
    schemaVersion: "toy.role-identity-bootstrap.v1", requestId: input.requestId, observedAt: new Date().toISOString(),
    mode: input.plan ? "plan" : "apply", state, reasonCode, snapshotDigest, allocationMethod: "observed_vacancy", callerUid,
    roles, directories, accountsVerified, effectState: state === "created" ? "confirmed" : effectsStarted ? "unknown" : "none",
    identityGateVerified: false, maintenanceIdentityVerified: false, servicesActivated: false
  });
  if (!input.plan && (callerUid !== 0 || process.geteuid?.() !== 0)) return report("blocked", "ROOT_CALLER_REQUIRED");
  let users: ReturnType<typeof list>; let groups: ReturnType<typeof list>;
  try { users = list("/Users", "UniqueID"); groups = list("/Groups", "PrimaryGroupID"); }
  catch (error) {
    const code = error instanceof Error ? error.message : "";
    return report("blocked", code === "OS_COMMAND_DENIED" ? "DIRECTORY_QUERY_DENIED" : code === "OS_COMMAND_TIMEOUT" || code === "DEADLINE" ? "DIRECTORY_QUERY_TIMEOUT" : code === "INVALID_DIRECTORY_LIST" || code === "DUPLICATE_RECORD_NAME" ? "DIRECTORY_QUERY_INVALID" : "DIRECTORY_QUERY_UNAVAILABLE");
  }
  roles = serviceRoleNameSchema.options.map(role => ({
    observation: users.some(user => user.name === role) ? observe(role) : { role, state: "missing", uid: null, gid: null, adminGroupObserved: null },
    candidateUid: null, candidateGid: null
  }));
  if (roles.some(role => role.observation.state !== "missing") || groups.some(group => serviceRoleNameSchema.safeParse(group.name).success)) return report("blocked", "ROLE_NAME_CONFLICT");
  const parents = [];
  try {
    for (const path of ["/", "/Library", "/Library/Application Support"]) {
      const stat = lstatSync(path, { bigint: true });
      const allowedGids = path === "/Library/Application Support" ? [0n, 80n] : [0n];
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0n || !allowedGids.includes(stat.gid) || (stat.mode & 0o022n) !== 0n) return report("blocked", "PATH_CONFLICT");
      parents.push({ path, dev: String(stat.dev), ino: String(stat.ino), uid: String(stat.uid), gid: String(stat.gid), mode: String(stat.mode) });
    }
    try { lstatSync(roleBootstrapRoot); return report("blocked", "PATH_CONFLICT"); }
    catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") return report("blocked", "PATH_CONFLICT"); }
  } catch { return report("blocked", "PATH_CONFLICT"); }
  const occupied = new Set([...users, ...groups].map(row => Number(row.id)));
  const candidates = Array.from({ length: 200 }, (_, index) => 300 + index).filter(id => !occupied.has(id)).slice(0, 8);
  if (candidates.length !== 8) return report("blocked", "ID_POOL_EXHAUSTED");
  roles = roles.map((role, index) => roleBootstrapRoleSchema.parse({ ...role, candidateUid: candidates[index], candidateGid: candidates[index] }));
  snapshotDigest = createHash("sha256").update(JSON.stringify({ users, groups, parents, roles, directories })).digest("hex");
  if (input.plan) return report("planned", "PLAN_READY");
  if (snapshotDigest !== input.expectedSnapshotDigest) return report("blocked", "SNAPSHOT_CHANGED");
  try {
    process.umask(0o077);
    effectsStarted = true;
    mkdirSync(roleBootstrapRoot, { mode: 0o711 });
    chmodSync(roleBootstrapRoot, 0o711);
    for (const role of roles) {
      const name = role.observation.role; const id = role.candidateUid;
      if (id === null) throw new Error("MISSING_CANDIDATE");
      const currentUsers = list("/Users", "UniqueID"); const currentGroups = list("/Groups", "PrimaryGroupID");
      if ([...currentUsers, ...currentGroups].some(row => row.name === name || Number(row.id) === id)) throw new Error("ROLE_CONFLICT");
      const groupId = randomUUID(); const userId = randomUUID();
      command("/usr/bin/dscl", ["/Local/Default", "-create", "/Groups/" + name, "GeneratedUID", groupId]);
      command("/usr/bin/dscl", ["/Local/Default", "-create", "/Groups/" + name, "PrimaryGroupID", String(id)]);
      command("/usr/bin/dscl", ["/Local/Default", "-create", "/Groups/" + name, "RealName", "Toy " + name]);
      const attributes = { GeneratedUID: userId, UniqueID: String(id), PrimaryGroupID: String(id), NFSHomeDirectory: roleBootstrapRoot + "/state/homes/" + name, UserShell: "/usr/bin/false", RealName: "Toy " + name, IsHidden: "1" };
      for (const [key, value] of Object.entries(attributes)) command("/usr/bin/dscl", ["/Local/Default", "-create", "/Users/" + name, key, value]);
      command("/usr/bin/pwpolicy", ["-u", name, "-disableuser"]);
      const authentication = command("/usr/bin/pwpolicy", ["-u", name, "-authentication-allowed"]);
      if (!/is not allowed to authenticate/.test(authentication)) throw new Error("DISABLED_POLICY_NOT_OBSERVED");
      for (const [key, value] of Object.entries(attributes)) {
        if (command("/usr/bin/dscl", ["/Local/Default", "-read", "/Users/" + name, key]).trim().replace(/^dsAttrTypeNative:/, "").replace(/:\s*\n\s*/, ": ") !== key + ": " + value) throw new Error("USER_READBACK_MISMATCH");
      }
      for (const [key, value] of Object.entries({ GeneratedUID: groupId, PrimaryGroupID: String(id) })) {
        if (command("/usr/bin/dscl", ["/Local/Default", "-read", "/Groups/" + name, key]).trim().replace(/:\s*\n\s*/, ": ") !== key + ": " + value) throw new Error("GROUP_READBACK_MISMATCH");
      }
      role.observation = observe(name);
      if (role.observation.state !== "observed" || role.observation.uid !== id || role.observation.gid !== id || role.observation.adminGroupObserved !== false) throw new Error("IDENTITY_READBACK_MISMATCH");
      accountsVerified++;
    }
    for (const directory of directories) {
      const identity = directory.owner === "root" ? null : roles.find(role => role.observation.role === directory.owner)?.observation;
      const uid = directory.owner === "root" ? 0 : identity?.uid;
      const gid = directory.owner === "root" ? 0 : identity?.gid;
      if (uid === null || uid === undefined || gid === null || gid === undefined) throw new Error("DIRECTORY_OWNER_UNKNOWN");
      const mode = Number.parseInt(directory.mode, 8);
      if (directory.path !== roleBootstrapRoot) mkdirSync(directory.path, { mode });
      chownSync(directory.path, uid, gid); chmodSync(directory.path, mode);
      const stat = lstatSync(directory.path);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid || stat.gid !== gid || (stat.mode & 0o7777) !== mode) throw new Error("DIRECTORY_READBACK_MISMATCH");
    }
    const complete = report("created", "ROLE_IDENTITIES_CREATED");
    writeFileSync(roleBootstrapRoot + "/control/bootstrap-identities.json", JSON.stringify(complete) + "\n", { mode: 0o600, flag: "wx" });
    return complete;
  } catch { return report("partial", "OS_CHANGE_FAILED"); }
};

const chunks: Buffer[] = [];
let bytes = 0;
for await (const chunk of process.stdin) {
  if (!Buffer.isBuffer(chunk)) process.exit(2);
  bytes += chunk.length;
  if (bytes > 8192) process.exit(2);
  chunks.push(chunk);
}
try {
  const input = roleBootstrapInputSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  process.stdout.write(JSON.stringify(run(input)) + "\n");
} catch { process.exitCode = 2; }
