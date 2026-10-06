import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { cliCommandSchemas } from "@toy/contracts";

const root = resolve(import.meta.dirname, "..");
const requestId = "bd041f4e-8176-46a7-9108-b9c4a89b965e";
const output = join(root, "build/evidence/R0.05/root-unfiltered-control-" + requestId);
const pins = new Map([
  ["packages/ops/dist/role-control-probe.js", "1764a98e5ae45694118007c242320711a7bd9e0d021b7c6d6ee0cbb8cff73ec2"],
  ["control/dist/bootstrap/denial-probe.js", "7fda1824ec7bc308cac97d07c7c92cadd5527e87e89d79b410d33d95d1b30672"]
]);
const drive = (args: readonly string[]): unknown => {
  const child = spawnSync(process.execPath, [join(root, "cli/dist/main.js"), ...args, "--json"], {
    cwd: root, env: { PATH: dirname(process.execPath) + ":/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 130000, maxBuffer: 1048576
  });
  if (child.error || child.signal !== null) throw new Error("CLI_UNAVAILABLE");
  const decoded: unknown = JSON.parse(child.stdout);
  return decoded;
};
const retain = (name: string, value: unknown): void => {
  const path = join(output, name + ".json");
  writeFileSync(path, JSON.stringify(value) + "\n", { flag: "wx", mode: 0o644 });
  chmodSync(path, 0o644);
};

if (process.argv.length !== 3 || process.argv[2] !== requestId) process.exit(2);
if (process.getuid?.() !== 0 || process.geteuid?.() !== 0) {
  process.stdout.write(JSON.stringify({ requestId, state: "ROOT_CALLER_REQUIRED", rootExecuted: false }) + "\n");
  process.exit(4);
}
let stage = "runtime-pins";
let stackId: string | null = null;
let operationId: string | null = null;
let passed = false;
let teardownComplete = false;
try {
  if (process.version !== "v24.21.0" || process.platform !== "darwin") throw new Error("RUNTIME_INVALID");
  for (const [path, expected] of pins) if (createHash("sha256").update(readFileSync(join(root, path))).digest("hex") !== expected) throw new Error("RUNTIME_CHANGED");
  stage = "request-directory";
  mkdirSync(output, { mode: 0o755 });
  chmodSync(output, 0o755);
  stage = "identities-before";
  const before = cliCommandSchemas["bootstrap.identities"].result.parse(drive(["bootstrap", "identities", "--verify", "--request-id", randomUUID()]));
  retain("identities-before", before);
  if (!before.ok || before.data.state !== "verified" || before.data.accountsVerified !== 8) throw new Error("IDENTITIES_UNVERIFIED");
  retain("doctor-before", cliCommandSchemas.doctor.result.parse(drive(["doctor", "--deep"])));
  stage = "stack-up";
  const up = cliCommandSchemas["stack.up"].result.parse(drive(["--env", "test", "stack", "up", "--release", "R0", "--clock", "fake", "--model", "fake", "--request-id", randomUUID(), "--wait-ms", "10000"]));
  retain("stack-up", up);
  if (!up.ok) throw new Error("STACK_UNAVAILABLE");
  stackId = up.data.stackId;
  if (stackId === null || !up.data.result?.ready) throw new Error("STACK_NOT_READY");
  const scope = ["--env", "test", "--stack", stackId];
  stage = "probe-run";
  const run = cliCommandSchemas["probe.run"].result.parse(drive([...scope, "probe", "run", "AT-authority-35", "--request-id", requestId, "--timeout-ms", "120000", "--wait-ms", "120000"]));
  retain("probe-run", run);
  if (!run.ok) throw new Error("PROBE_UNAVAILABLE");
  operationId = run.data.operation.operationId;
  stage = "probe-show";
  const show = cliCommandSchemas["probe.show"].result.parse(drive([...scope, "probe", "show", operationId]));
  retain("probe-show", show);
  if (!show.ok || JSON.stringify(show.data) !== JSON.stringify(run.data)) throw new Error("READBACK_MISMATCH");
  if (run.data.result?.sourceRegistration?.sourceAssertionHash !== "934a98cc59306705d350903d2a8f21a05b987a09458c148e657f65b8485c1d2c"
    || run.data.result.state !== "NOT_IMPLEMENTED" || run.data.result.complete || run.data.result.cases.length !== 1
    || run.data.result.cases[0]?.state !== "PASS" || run.data.result.cases[0].id !== "bootstrap.role-control-denials") throw new Error("DIAGNOSTIC_UNVERIFIED");
  stage = "identities-after";
  const after = cliCommandSchemas["bootstrap.identities"].result.parse(drive(["bootstrap", "identities", "--verify", "--request-id", randomUUID()]));
  retain("identities-after", after);
  if (!after.ok || after.data.state !== "verified" || after.data.accountsVerified !== 8 || after.data.bootstrapReceiptDigest !== before.data.bootstrapReceiptDigest) throw new Error("IDENTITIES_CHANGED");
  retain("doctor-after", cliCommandSchemas.doctor.result.parse(drive(["doctor", "--deep"])));
  passed = true;
} catch {
  passed = false;
} finally {
  if (stackId !== null) {
    try {
      const down = cliCommandSchemas["stack.down"].result.parse(drive(["--env", "test", "--stack", stackId, "stack", "down", "--request-id", randomUUID(), "--wait-ms", "10000"]));
      retain("stack-down", down);
      teardownComplete = down.ok && down.data.result?.teardown?.complete === true && down.data.result.teardown.unresolvedResourceRefs.length === 0;
    } catch { teardownComplete = false; }
  }
}
process.stdout.write(JSON.stringify({ requestId, state: passed && teardownComplete ? "DIAGNOSTIC_PASS" : "FAILED", stage, stackId, operationId,
  rootExecuted: true, teardownComplete, evidenceDirectory: output, liveProviderSends: 0, wholeATComplete: false }) + "\n");
process.exitCode = passed && teardownComplete ? 0 : 1;
