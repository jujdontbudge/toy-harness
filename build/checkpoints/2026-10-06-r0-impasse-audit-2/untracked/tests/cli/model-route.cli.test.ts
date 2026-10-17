import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { cliResultSchema, installedCodexRuntimeSchema, modelArmSchema, modelRoleSchema, modelRouteSettingsSchema } from "@toy/contracts";
import type { CliResult } from "@toy/contracts";

const root = resolve(import.meta.dirname, "../..");
const receipts: { case: string; result: CliResult }[] = [];
const doctor = (name: string, exitCode: number): CliResult => {
  const child = spawnSync(process.execPath, [join(root, "cli/dist/main.js"), "doctor", "--deep", "--json"], { cwd: root, encoding: "utf8", timeout: 15000, maxBuffer: 2 * 1024 * 1024, env: { PATH: "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C" } });
  assert.equal(child.error, undefined);
  assert.equal(child.stderr, "");
  const result = cliResultSchema.parse(JSON.parse(child.stdout));
  receipts.push({ case: name, result });
  assert.equal(child.status, exitCode);
  assert.equal(result.meta.exitCode, exitCode);
  return result;
};

await test("R0.01 CLI policy diagnostics; assigned inference and stack probes remain pending", { timeout: 45000 }, () => {
  const path = join(root, "behavior/models.yaml");
  const original = readFileSync(path, "utf8");
  try {
    const result = doctor("original and experimental routes", 5);
    assert.ok(result.ok && result.commandId === "doctor" && !result.data.complete && result.data.verdict === "NOT_IMPLEMENTED");
    const runtime = result.data.checks.find(check => check.id === "read.model-route");
    assert.ok(runtime?.prerequisite);
    const installed = installedCodexRuntimeSchema.parse(JSON.parse(runtime.prerequisite));
    assert.equal(installed.inferenceAttested, false);
    assert.equal(installed.authorizationInspected, false);
    assert.equal(installed.paidFallbackPermitted, false);
    const policy = result.data.checks.find(check => check.id === "read.model-route-policy");
    assert.ok(policy?.prerequisite && policy.state === "PASS");
    const observed: unknown = JSON.parse(policy.prerequisite);
    assert.ok(observed && typeof observed === "object" && "requestedRoutes" in observed && Array.isArray(observed.requestedRoutes));
    assert.equal(observed.requestedRoutes.length, 8);
    const routes: unknown[] = observed.requestedRoutes;
    for (const route of routes) {
      assert.ok(route && typeof route === "object" && "role" in route && "arm" in route && "model" in route && "effort" in route && "serviceTier" in route);
      const role = modelRoleSchema.parse(route.role);
      const arm = modelArmSchema.parse(route.arm);
      const settings = modelRouteSettingsSchema.parse({ model: route.model, effort: route.effort, serviceTier: route.serviceTier });
      assert.equal(settings.model, role === "child" ? "gpt-6-luna" : "gpt-6.1-sol");
      assert.equal(settings.effort, arm === "experimental-background-high-standard" ? "high" : role === "research" ? "medium" : "max");
      assert.equal(settings.serviceTier, arm === "original" ? "priority" : "default");
      if (arm !== "original") assert.equal(role, "background");
    }
    assert.ok("liveInferenceAttested" in observed && observed.liveInferenceAttested === false);
    assert.ok("providerOutputCap" in observed && observed.providerOutputCap === null);
    assert.ok("outputLimitKind" in observed && observed.outputLimitKind === "estimate");
    const candidate: unknown = JSON.parse(original);
    assert.ok(candidate && typeof candidate === "object" && "original" in candidate && candidate.original && typeof candidate.original === "object" && "background" in candidate.original && candidate.original.background && typeof candidate.original.background === "object" && "effort" in candidate.original.background);
    candidate.original.background.effort = "high";
    writeFileSync(path, JSON.stringify(candidate));
    const rejected = doctor("experimental settings cannot replace original", 1);
    assert.ok(rejected.ok && rejected.commandId === "doctor" && rejected.data.verdict === "FAIL" && !rejected.data.complete);
    assert.ok(rejected.data.checks.some(check => check.id === "read.model-route-policy" && check.state === "FAIL"));
    writeFileSync(path, original);
    doctor("original policy restored", 5);
  } finally {
    writeFileSync(path, original);
    const directory = join(root, "build/evidence/R0.01/attempts", new Date().toISOString().replaceAll(":", "-") + "-" + randomUUID());
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "policy-receipts.json"), JSON.stringify({ schemaVersion: "toy.r001-policy-receipts.v1", wholeAssignedATsPassed: false, receipts }, null, 2) + "\n");
  }
});
