import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { siwcKeychainLauncherSchema } from "@toy/contracts";
import type { SiwcKeychainLauncherV1, SiwcKeychainStore } from "@toy/contracts";

const root = resolve(import.meta.dirname, "../../..");
const helper = resolve(root, "python/toy_control/siwc_keychain.py");
const invoke = (binding: SiwcKeychainLauncherV1, operation: "read" | "write", expectedDigest: string | null = null, value: Uint8Array = new Uint8Array()): Promise<{ code: number; bytes: Uint8Array }> => new Promise((resolveResult, reject) => {
  if (expectedDigest !== null && !/^[0-9a-f]{64}$/.test(expectedDigest) || value.byteLength > 262144) { reject(new Error("siwc_keychain_input_invalid")); return; }
  const python = binding.pythonExecutable;
  if (createHash("sha256").update(readFileSync(python)).digest("hex") !== binding.pythonDigest || createHash("sha256").update(readFileSync(helper)).digest("hex") !== binding.helperDigest) { reject(new Error("siwc_keychain_artifact_mismatch")); return; }
  const child = spawn(python, ["-I", helper, operation, ...(operation === "write" ? [expectedDigest ?? "absent"] : [])], { cwd: root, env: { PATH: dirname(python) + ":/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, stdio: ["pipe", "pipe", "ignore"], timeout: 10000, killSignal: "SIGTERM" });
  const chunks: Uint8Array[] = [];
  let length = 0;
  let invalid = false;
  child.stdout.on("data", (chunk: Buffer) => {
    length += chunk.byteLength;
    if (length > 262144) { invalid = true; child.kill(); return; }
    chunks.push(chunk);
  });
  child.once("error", () => reject(new Error("siwc_keychain_unavailable")));
  child.stdin.on("error", () => { invalid = true; });
  child.once("close", (code, signal) => {
    if (invalid || signal !== null || code === null) reject(new Error("siwc_keychain_unavailable"));
    else resolveResult({ code, bytes: Buffer.concat(chunks) });
  });
  child.stdin.end(value);
});

export const createMacOsSiwcKeychain = (input: SiwcKeychainLauncherV1): SiwcKeychainStore => {
  const binding = siwcKeychainLauncherSchema.parse(input);
  return {
  async read() {
    const result = await invoke(binding, "read");
    if (result.code === 3) return null;
    if (result.code !== 0) throw new Error("siwc_keychain_unavailable");
    return result.bytes;
  },
  async compareAndWrite(expectedDigest, value) {
    const result = await invoke(binding, "write", expectedDigest, value);
    if (result.code === 4) return false;
    if (result.code !== 0 || result.bytes.byteLength !== 0) throw new Error("siwc_keychain_unavailable");
    return true;
  }
  };
};
