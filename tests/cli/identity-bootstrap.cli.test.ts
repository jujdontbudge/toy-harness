import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { cliResultSchema, roleBootstrapRoot, serviceRoleNameSchema } from "@toy/contracts";
import type { CliResult } from "@toy/contracts";

const root = resolve(import.meta.dirname, "../..");
const receipts: { case: string; result: CliResult }[] = [];
const invoke = (name: string, args: string[], osCase?: string): CliResult => {
  const child = spawnSync(process.execPath, [...(osCase === undefined ? [] : ["--import", join(root, "tests/fixtures/bootstrap-os.ts")]), join(root, "cli/dist/main.js"), "bootstrap", "identities", "--json", ...args], {
    cwd: root, encoding: "utf8", timeout: 15000, maxBuffer: 262144,
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C", ...(osCase === undefined ? {} : { TOY_BOOTSTRAP_OS_CASE: osCase }) }
  });
  assert.equal(child.error, undefined);
  assert.equal(child.stderr, "");
  const result = cliResultSchema.parse(JSON.parse(child.stdout));
  assert.equal(child.status, result.meta.exitCode);
  receipts.push({ case: name, result });
  return result;
};

await test("R0.04 real CLI bootstrap preparation and guard refusals; root/denial ATs pending", { timeout: 30000 }, () => {
  assert.equal(process.platform, "darwin");
  assert.notEqual(process.getuid?.(), 0);
  const request = ["--request-id", randomUUID()];
  try {
    const planned = invoke("read-only Directory Service plan", ["--plan", ...request]);
    assert.ok(planned.ok && planned.commandId === "bootstrap.identities");
    assert.equal(planned.data.identityGateVerified, false);
    assert.equal(planned.data.maintenanceIdentityVerified, false);
    assert.equal(planned.data.servicesActivated, false);
    assert.equal(planned.data.effectState, "none");
    assert.equal(planned.meta.effectState, "none");
    assert.equal(planned.data.accountsVerified, 0);
    assert.deepEqual(planned.data.roles.map(role => role.observation.role), serviceRoleNameSchema.options);
    assert.ok(planned.data.directories.every(directory => directory.path === roleBootstrapRoot || directory.path.startsWith(roleBootstrapRoot + "/")));
    if (planned.data.state === "planned") {
      assert.equal(planned.meta.exitCode, 0);
      assert.equal(planned.data.reasonCode, "PLAN_READY");
      assert.ok(planned.data.snapshotDigest);
      assert.equal(new Set(planned.data.roles.map(role => role.candidateUid)).size, 8);
      assert.ok(planned.data.roles.every(role => role.observation.state === "missing" && role.observation.uid === null && role.candidateUid !== null && role.candidateUid === role.candidateGid));
    } else {
      assert.equal(planned.data.state, "blocked");
      assert.equal(planned.meta.exitCode, 5);
      assert.ok(["DIRECTORY_QUERY_UNAVAILABLE", "DIRECTORY_QUERY_DENIED", "DIRECTORY_QUERY_TIMEOUT", "DIRECTORY_QUERY_INVALID", "ROLE_NAME_CONFLICT", "PATH_CONFLICT", "ID_POOL_EXHAUSTED"].includes(planned.data.reasonCode));
    }
    const denied = invoke("already-root caller required without escalation", [...request, "--expected-snapshot", "0".repeat(64)]);
    assert.ok(!denied.ok);
    assert.equal(denied.error.code, "UNAUTHORIZED");
    assert.equal(denied.meta.exitCode, 3);
    assert.equal(denied.meta.effectState, "none");
    for (const args of [request, ["--plan", ...request, "--expected-snapshot", "0".repeat(64)], ["--plan", ...request, "--uid", "0"], ["--plan", ...request, "--path", "/tmp/toy"], ["--plan", ...request, "--expected-snapshot", "invalid"]]) {
      const invalid = invoke("invalid or caller-selected bootstrap scope", args);
      assert.ok(!invalid.ok);
      assert.equal(invalid.error.code, "INVALID_INPUT");
      assert.equal(invalid.meta.exitCode, 2);
      assert.equal(invalid.meta.effectState, "none");
    }
    const testEnvironment = invoke("disposable stack cannot change host identities", ["--plan", ...request, "--env", "test", "--stack", randomUUID()]);
    assert.ok(!testEnvironment.ok);
    assert.equal(testEnvironment.error.code, "UNAUTHORIZED");
    assert.equal(testEnvironment.meta.exitCode, 3);
    assert.equal(testEnvironment.meta.effectState, "none");
  } finally {
    const directory = join(root, "build/evidence/R0.04/attempts", new Date().toISOString().replaceAll(":", "-") + "-" + randomUUID());
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "identity-bootstrap-receipts.json"), JSON.stringify({ schemaVersion: "toy.r004-bootstrap-preparation-receipts.v1", wholeAssignedATsPassed: false, rootApplyExecuted: false, receipts }, null, 2) + "\n");
  }
});

await test("R0.04 CLI bootstrap accepts macOS OS readbacks and refuses unsafe alternatives", { timeout: 30000 }, () => {
  const request = ["--request-id", randomUUID()];
  const plan = invoke("OS-fake root plan with admin-owned Application Support", ["--plan", ...request], "macos-readbacks");
  assert.ok(plan.ok && plan.commandId === "bootstrap.identities");
  assert.equal(plan.data.state, "planned");
  assert.equal(plan.data.reasonCode, "PLAN_READY");
  assert.ok(plan.data.snapshotDigest);
  const applied = invoke("OS-fake disabled authentication plus native/wrapped dscl readbacks", [...request, "--expected-snapshot", plan.data.snapshotDigest], "macos-readbacks");
  assert.ok(applied.ok && applied.commandId === "bootstrap.identities");
  assert.equal(applied.data.state, "created");
  assert.equal(applied.data.accountsVerified, 8);
  assert.equal(applied.data.identityGateVerified, false);
  assert.equal(applied.data.maintenanceIdentityVerified, false);
  assert.equal(applied.data.servicesActivated, false);
  const unsafe = invoke("OS-fake unsafe parent group refused", ["--plan", ...request], "unsafe-parent");
  assert.ok(unsafe.ok && unsafe.commandId === "bootstrap.identities");
  assert.equal(unsafe.data.reasonCode, "PATH_CONFLICT");
  assert.equal(unsafe.data.effectState, "none");
  const allowed = invoke("OS-fake authentication still allowed stops creation", [...request, "--expected-snapshot", plan.data.snapshotDigest], "authentication-allowed");
  assert.ok(allowed.ok && allowed.commandId === "bootstrap.identities");
  assert.equal(allowed.data.state, "partial");
  assert.equal(allowed.data.reasonCode, "OS_CHANGE_FAILED");
  assert.equal(allowed.data.accountsVerified, 0);
  assert.equal(allowed.data.effectState, "unknown");
  const directory = join(root, "build/evidence/R0.04/attempts", new Date().toISOString().replaceAll(":", "-") + "-" + randomUUID());
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "macos-bootstrap-os-regressions.json"), JSON.stringify({ schemaVersion: "toy.r004-macos-os-regression-receipts.v1", externalOsFakeOnly: true, rootIdentitySimulated: true, actualAccountsChanged: false, wholeAssignedATsPassed: false, receipts }, null, 2) + "\n");
});
