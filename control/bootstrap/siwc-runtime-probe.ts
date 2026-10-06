import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { SiwcControlRuntimeReceiptV1 } from "@toy/contracts";

const [payload, uidText, gidText, requestId] = process.argv.slice(2);
if (process.platform !== "darwin" || process.version !== "v24.21.0" || process.getuid?.() !== 0 || process.geteuid?.() !== 0
  || payload === undefined || !/^\/Library\/Application Support\/Toy\/control\/releases\/[a-f0-9]{64}\/payload$/.test(payload)
  || uidText === undefined || gidText === undefined || !/^[0-9]{3}$/.test(uidText) || !/^[0-9]{3}$/.test(gidText)
  || requestId === undefined || !/^[0-9a-f-]{36}$/.test(requestId) || process.argv.length !== 6) process.exit(2);
const uid = Number(uidText); const gid = Number(gidText);
if (uid < 300 || uid > 499 || uid !== gid || !process.setgroups || !process.setgid || !process.setuid || !process.getuid || !process.geteuid || !process.getgid || !process.getegid || !process.getgroups) process.exit(2);
try { process.setgroups([gid]); process.setgid(gid); process.setuid(uid); }
catch { process.exit(3); }
const groups = [...new Set(process.getgroups())].sort((a, b) => a - b);
if (process.getuid() !== uid || process.geteuid() !== uid || process.getgid() !== gid || process.getegid() !== gid || groups.length !== 1 || groups[0] !== gid) process.exit(3);
let moduleImported = false;
let keychainState: SiwcControlRuntimeReceiptV1["keychainState"] = "not_called";
let helperExitCode: number | null = null;
let helperTerminated = false;
try {
  const owner: unknown = await import(pathToFileURL(join(payload, "control/dist/secrets/public.js")).href);
  moduleImported = typeof owner === "object" && owner !== null && "createSiwcAuthorization" in owner && typeof owner.createSiwcAuthorization === "function"
    && "createMacOsSiwcKeychain" in owner && typeof owner.createMacOsSiwcKeychain === "function";
  if (moduleImported) {
    const result = spawnSync(join(payload, "runtime/python/bin/python3"), ["-I", "-S", "-B", join(payload, "python/toy_control/siwc_keychain.py"), "read"], {
      cwd: payload, env: { HOME: process.env.HOME, PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, stdio: "ignore", timeout: 10000, killSignal: "SIGKILL"
    });
    helperExitCode = result.status; helperTerminated = result.signal !== null || result.error !== undefined;
    keychainState = !helperTerminated && result.status === 0 ? "present" : !helperTerminated && result.status === 3 ? "absent" : "unavailable";
  }
} catch { moduleImported = false; }
const receipt: SiwcControlRuntimeReceiptV1 = { requestId, uid: process.getuid(), euid: process.geteuid(), gid: process.getgid(), egid: process.getegid(), groups, moduleImported, keychainState, helperExitCode, helperTerminated };
process.stdout.write(JSON.stringify(receipt) + "\n");
process.exitCode = moduleImported && (keychainState === "absent" || keychainState === "present") ? 0 : 5;
