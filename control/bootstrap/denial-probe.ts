import { chmodSync, mkdirSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { RoleControlDenialOperationV1, RoleControlDenialReceiptV1 } from "@toy/contracts";

const [target, scratch, uidText, gidText, requestId] = process.argv.slice(2);
if (process.platform !== "darwin" || process.getuid?.() !== 0 || process.geteuid?.() !== 0 || target === undefined || scratch === undefined || uidText === undefined || gidText === undefined || requestId === undefined || !isAbsolute(target) || !isAbsolute(scratch) || [target, scratch].some(path => path.split("/").includes("..")) || !/^[0-9a-f-]{36}$/.test(requestId) || !/^[0-9]{3}$/.test(uidText) || !/^[0-9]{3}$/.test(gidText)) process.exit(2);
const uid = Number(uidText); const gid = Number(gidText);
if (uid < 300 || uid > 499 || uid !== gid || !process.setgroups || !process.setgid || !process.setuid || !process.getuid || !process.geteuid || !process.getgid || !process.getegid || !process.getgroups) process.exit(2);
try {
  process.setgroups([gid]);
  process.setgid(gid);
  process.setuid(uid);
} catch { process.exit(3); }
const groups = [...new Set(process.getgroups())].sort((a, b) => a - b);
if (process.getuid() !== uid || process.geteuid() !== uid || process.getgid() !== gid || process.getegid() !== gid || groups.length !== 1 || groups[0] !== gid) process.exit(3);
let permittedScratchWrite = false;
try {
  writeFileSync(join(scratch, "positive"), "permitted-agent-scratch", { flag: "wx", mode: 0o600 });
  symlinkSync("safe-nonsecret-target", join(scratch, "replacement-link"));
  mkdirSync(join(scratch, "replacement-directory"), { mode: 0o700 });
  permittedScratchWrite = true;
} catch { process.exit(4); }
const attempts: RoleControlDenialReceiptV1["attempts"] = [];
const attempt = (operation: RoleControlDenialOperationV1, action: () => void): void => {
  try { action(); attempts.push({ operation, denied: false, errno: null }); }
  catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : null;
    const errno = code === "EACCES" || code === "EPERM" ? code : "OTHER";
    attempts.push({ operation, denied: errno !== "OTHER", errno });
  }
};
attempt("write", () => writeFileSync(join(target, "write"), "unexpected-agent-write", { flag: "a" }));
attempt("unlink", () => unlinkSync(join(target, "unlink")));
attempt("rename", () => renameSync(join(target, "rename"), join(target, "renamed")));
attempt("symlink-replacement", () => renameSync(join(scratch, "replacement-link"), join(target, "symlink-replacement")));
attempt("chmod", () => chmodSync(join(target, "chmod"), 0o600));
attempt("parent-replacement", () => renameSync(join(scratch, "replacement-directory"), join(target, "parent-replacement")));
const receipt: RoleControlDenialReceiptV1 = { requestId, pid: process.pid, uid: process.getuid(), euid: process.geteuid(), gid: process.getgid(), egid: process.getegid(), groups, permittedScratchWrite, attempts };
process.stdout.write(JSON.stringify(receipt) + "\n");
