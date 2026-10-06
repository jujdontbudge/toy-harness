import childProcess from "node:child_process";
import type { SpawnSyncOptions } from "node:child_process";
import fs from "node:fs";
import type { PathLike, StatOptions } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { roleBootstrapRoot } from "@toy/contracts";

const mode = process.env.TOY_BOOTSTRAP_OS_CASE;
if (!["macos-readbacks", "unsafe-parent", "authentication-allowed"].includes(mode ?? "")) throw new Error("FIXTURE_CASE_REQUIRED");
const nativeSpawn = childProcess.spawnSync;
const nativeStat = fs.lstatSync;
const users = new Map<string, Map<string, string>>([["root", new Map([["UniqueID", "0"], ["PrimaryGroupID", "0"]])]]);
const groups = new Map<string, Map<string, string>>([["wheel", new Map([["PrimaryGroupID", "0"]])], ["admin", new Map([["PrimaryGroupID", "80"]])]]);
const disabled = new Set<string>();
const directories = new Map<string, { uid: number; gid: number; mode: number }>();
const createdFiles = new Set<string>();
const privatePath = (path: PathLike): boolean => typeof path === "string" && (path === roleBootstrapRoot || path.startsWith(roleBootstrapRoot + "/"));
const missing = (): never => { throw Object.assign(new Error("FIXTURE_PATH_MISSING"), { code: "ENOENT" }); };
const result = (stdout = "", status = 0, stderr = "") => ({ pid: 0, output: [null, stdout, stderr], stdout, stderr, status, signal: null });
const directory = (path: string) => {
  const value = directories.get(path);
  if (value === undefined) return missing();
  return value;
};
const spawn = (command: string, args: readonly string[], options: SpawnSyncOptions = {}) => {
  if (command === process.execPath && args[0]?.endsWith("/control/dist/bootstrap/main.js")) return nativeSpawn(command, ["--import", import.meta.filename, ...args], { ...options, env: { ...options.env, TOY_BOOTSTRAP_OS_CASE: mode } });
  if (command === "/usr/bin/id") {
    const role = args[1];
    const attrs = role === undefined ? undefined : users.get(role);
    if (attrs === undefined) return result("", 1, "no such user");
    return result((args[0] === "-u" ? attrs.get("UniqueID") : args[0] === "-g" ? attrs.get("PrimaryGroupID") : role) + "\n");
  }
  if (command === "/usr/bin/pwpolicy") {
    const role = args[1];
    if (role === undefined || !users.has(role)) return result("", 1);
    if (args[2] === "-disableuser") { disabled.add(role); return result(); }
    if (args[2] === "-authentication-allowed") return result("User " + role + (disabled.has(role) && mode !== "authentication-allowed" ? " is not allowed to authenticate.\n" : " is allowed to authenticate.\n"));
    return result("", 1, "disabled accounts have no getpolicy response");
  }
  if (command === "/usr/bin/dscl") {
    if (args[0] !== "/Local/Default") throw new Error("FIXTURE_DIRECTORY_SCOPE");
    const path = args[2];
    const key = args[3];
    const store = path?.startsWith("/Users") ? users : path?.startsWith("/Groups") ? groups : null;
    if (store === null || path === undefined || key === undefined) throw new Error("FIXTURE_DIRECTORY_REQUEST");
    if (args[1] === "-list") return result([...store].map(([name, attrs]) => name + " " + attrs.get(key)).join("\n") + (store.size ? "\n" : ""));
    const name = path.split("/")[2];
    if (name === undefined) throw new Error("FIXTURE_ROLE_REQUIRED");
    if (args[1] === "-create") {
      const value = args[4];
      if (value === undefined) throw new Error("FIXTURE_ATTRIBUTE_REQUIRED");
      let attrs = store.get(name);
      if (attrs === undefined) { attrs = new Map(); store.set(name, attrs); }
      attrs.set(key, value);
      return result();
    }
    if (args[1] === "-read") {
      const value = store.get(name)?.get(key);
      if (value === undefined) return result("", 1);
      return result((key === "IsHidden" ? "dsAttrTypeNative:" : "") + key + (value.includes(" ") ? ":\n " : ": ") + value + "\n");
    }
    throw new Error("FIXTURE_DIRECTORY_OPERATION");
  }
  throw new Error("FIXTURE_UNEXPECTED_PROCESS");
};
Object.defineProperty(childProcess, "spawnSync", { value: spawn });
Object.defineProperty(fs, "lstatSync", { value: (path: PathLike, options?: StatOptions) => {
  const protectedParent = typeof path === "string" && ["/", "/Library", "/Library/Application Support"].includes(path);
  if (!protectedParent && !privatePath(path)) return nativeStat(path, options);
  const value = protectedParent ? { uid: 0, gid: path === "/Library/Application Support" ? mode === "unsafe-parent" ? 81 : 80 : 0, mode: 0o755 } : directory(String(path));
  const stat = options?.bigint ? nativeStat("/", { bigint: true }) : nativeStat("/");
  Object.assign(stat, options?.bigint ? { uid: BigInt(value.uid), gid: BigInt(value.gid), mode: BigInt(0o40000 | value.mode) } : { uid: value.uid, gid: value.gid, mode: 0o40000 | value.mode });
  return stat;
} });
Object.defineProperty(fs, "mkdirSync", { value: (path: string, options: { mode: number }) => {
  if (!privatePath(path) || directories.has(path)) throw new Error("FIXTURE_DIRECTORY_WRITE");
  directories.set(path, { uid: 0, gid: 0, mode: options.mode });
} });
Object.defineProperty(fs, "chmodSync", { value: (path: string, value: number) => { directory(path).mode = value; } });
Object.defineProperty(fs, "chownSync", { value: (path: string, uid: number, gid: number) => { Object.assign(directory(path), { uid, gid }); } });
Object.defineProperty(fs, "writeFileSync", { value: (path: string) => {
  if (path !== roleBootstrapRoot + "/control/bootstrap-identities.json" || createdFiles.has(path)) throw new Error("FIXTURE_FILE_WRITE");
  createdFiles.add(path);
} });
process.getuid = () => 0;
process.geteuid = () => 0;
syncBuiltinESMExports();
