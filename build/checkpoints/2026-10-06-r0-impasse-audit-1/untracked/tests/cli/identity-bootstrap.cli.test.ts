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
const invoke = (name: string, args: string[]): CliResult => {
  const child = spawnSync(process.execPath, [join(root, "cli/dist/main.js"), "bootstrap", "identities", "--json", ...args], {
    cwd: root, encoding: "utf8", timeout: 15000, maxBuffer: 262144,
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C" }
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
