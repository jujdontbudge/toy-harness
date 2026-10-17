import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { cliResultSchema, featureFactsSchema } from "@toy/contracts";
import type { CliResult, FeatureFactsV1 } from "@toy/contracts";

const root = resolve(import.meta.dirname, "../..");
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
const factsPath = join(root, "architecture/features.json");
const mapPath = join(root, "skills/toy-control/FEATURE-MAP.md");
const receipts: { case: string; exitCode: number; result: CliResult }[] = [];
const invoke = (name: string, args: string[], expected: number): CliResult => {
  const child = spawnSync(process.execPath, [join(root, "cli/dist/main.js"), ...args, "--json"], { cwd: root, encoding: "utf8", timeout: 125000, maxBuffer: 2 * 1024 * 1024, env: { PATH: "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C" } });
  assert.equal(child.error, undefined, name);
  const result = cliResultSchema.parse(JSON.parse(child.stdout));
  receipts.push({ case: name, exitCode: child.status ?? 1, result });
  assert.equal(child.status, expected, name);
  assert.equal(result.meta.exitCode, expected);
  assert.equal(child.stderr, "");
  return result;
};
const checkReason = (result: CliResult, reason: string, linkage: string): void => {
  assert.ok(result.ok && result.commandId === "feature-map.check");
  assert.ok(result.data.findings.some((item) => item.reasonCode === reason && item.prerequisite === linkage), reason + ":" + linkage);
};

await test("AT-cli-7/8 and H101 engineering fixtures through the public toy CLI", { timeout: 360000 }, () => {
  const originalFacts = readFileSync(factsPath, "utf8");
  const originalMap = readFileSync(mapPath, "utf8");
  const originalIndex = readFileSync(join(root, "tests/acceptance-index.json"), "utf8");
  const proofPath = join(root, "build/evidence/R0.K4a/reference-verification.json");
  const originalProof = readFileSync(proofPath, "utf8");
  const backups = new Map<string, string>([[factsPath, originalFacts], [mapPath, originalMap], [join(root, "tests/acceptance-index.json"), originalIndex], [proofPath, originalProof], [join(root, "packages/sources/src/public.ts"), readFileSync(join(root, "packages/sources/src/public.ts"), "utf8")], [join(root, "packages/self-improvement/src/public.ts"), readFileSync(join(root, "packages/self-improvement/src/public.ts"), "utf8")]]);
  const created = new Map<string, string>();
  const emissions = new Set<string>();
  const facts = (): FeatureFactsV1 => featureFactsSchema.parse(JSON.parse(originalFacts));
  const mutation = (name: string, change: (inventory: FeatureFactsV1) => void, reason: string, linkage: string): void => {
    const inventory = facts();
    change(inventory);
    const content = JSON.stringify(inventory, null, 2) + "\n";
    writeFileSync(factsPath, content);
    try {
      checkReason(invoke(name, ["feature-map", "check"], 1), reason, linkage);
      assert.equal(readFileSync(factsPath, "utf8"), content);
      assert.equal(readFileSync(mapPath, "utf8"), originalMap);
    } finally { writeFileSync(factsPath, originalFacts); }
  };
  try {
    const coherent = invoke("coherent", ["feature-map", "check"], 0);
    assert.ok(readFileSync(mapPath, "utf8").includes("| control.capture |") && readFileSync(mapPath, "utf8").includes("R1 / specified"));
    assert.ok(coherent.ok && coherent.commandId === "feature-map.check" && coherent.data.state === "PASS");
    mutation("new unmapped feature", (inventory) => { const first = inventory.features[0]; assert.ok(first); inventory.features.push({ ...first, id: "fixture.unmapped" }); }, "MAP_FEATURE_MISSING", "fixture.unmapped");
    mutation("unmapped command", (inventory) => { inventory.features.forEach((feature) => { feature.commands = feature.commands.filter((id) => id !== "help"); }); }, "COMMAND_UNMAPPED", "help");
    mutation("new orphan command", (inventory) => { inventory.commands.push("fixture.orphan"); }, "COMMAND_ORPHAN", "fixture.orphan");
    mutation("unmapped AT", (inventory) => { inventory.features.forEach((feature) => { feature.atIds = feature.atIds.filter((id) => id !== "AT-cli-7"); }); }, "AT_UNMAPPED", "AT-cli-7");
    mutation("orphan AT", (inventory) => { inventory.ats.push("AT-fixture-orphan"); }, "AT_ORPHAN", "AT-fixture-orphan");
    mutation("duplicate ID", (inventory) => { inventory.commands.push("help"); }, "DUPLICATE_COMMAND", "help");
    mutation("duplicate feature", (inventory) => { const first = inventory.features[0]; assert.ok(first); inventory.features.push(first); }, "DUPLICATE_FEATURE", "control.help");
    mutation("duplicate AT", (inventory) => { inventory.ats.push("AT-cli-7"); }, "DUPLICATE_AT", "AT-cli-7");
    for (const [field, value, reason] of [["requirementIds", "fixture.missing", "REQUIREMENT_DANGLING"], ["publicInterface", "fixture.missing", "INTERFACE_DANGLING"], ["entry", "build/absent-entry", "ENTRY_DANGLING"], ["paths", "build/absent-path", "PATH_DANGLING"]] as const) {
      mutation("dangling " + field, (inventory) => {
        const first = inventory.features[0]; assert.ok(first);
        if (field === "requirementIds" || field === "paths") first[field] = [value]; else first[field] = value;
      }, reason, "control.help:" + value);
    }
    writeFileSync(mapPath, originalMap + "\nStale fixture\n");
    checkReason(invoke("stale map", ["feature-map", "check"], 1), "MAP_DIGEST_STALE", "skills/toy-control/FEATURE-MAP.md");
    writeFileSync(mapPath, originalMap);
    const added: unknown = JSON.parse(originalIndex);
    assert.ok(added && typeof added === "object" && "acceptance" in added && Array.isArray(added.acceptance));
    const existing: unknown = added.acceptance[0]; assert.ok(existing && typeof existing === "object");
    added.acceptance.push({ ...existing, id: "AT-fixture-unmapped" });
    writeFileSync(join(root, "tests/acceptance-index.json"), JSON.stringify(added));
    checkReason(invoke("new unmapped AT", ["feature-map", "check"], 1), "AT_UNMAPPED", "AT-fixture-unmapped");
    writeFileSync(join(root, "tests/acceptance-index.json"), originalIndex);
    const changed: unknown = JSON.parse(originalIndex);
    assert.ok(changed && typeof changed === "object" && "acceptance" in changed && Array.isArray(changed.acceptance));
    const first: unknown = changed.acceptance[0]; assert.ok(first && typeof first === "object" && "sourceAssertion" in first && "id" in first);
    const firstId = String(first.id); first.sourceAssertion = "Changed assertion fixture";
    writeFileSync(join(root, "tests/acceptance-index.json"), JSON.stringify(changed));
    checkReason(invoke("changed assertion", ["feature-map", "check"], 1), "ASSERTION_CHANGED", firstId);
    writeFileSync(join(root, "tests/acceptance-index.json"), originalIndex);
    const updates = [invoke("update first", ["feature-map", "update"], 0), invoke("update second", ["feature-map", "update"], 0)];
    assert.ok(updates[0]?.ok && updates[0].commandId === "feature-map.update");
    assert.ok(updates[1]?.ok && updates[1].commandId === "feature-map.update");
    assert.deepEqual(updates[0].data, updates[1].data);
    assert.equal(readFileSync(mapPath, "utf8"), originalMap);
    invoke("check second", ["feature-map", "check"], 0);
    const missing = facts(); missing.interfaces = [];
    writeFileSync(factsPath, JSON.stringify(missing));
    invoke("update refuses missing facts", ["feature-map", "update"], 4);
    assert.equal(readFileSync(mapPath, "utf8"), originalMap);
    writeFileSync(factsPath, originalFacts);
    const escaped = facts(); const escapedFeature = escaped.features[0]; assert.ok(escapedFeature); escapedFeature.paths = ["../escaped-output"];
    writeFileSync(factsPath, JSON.stringify(escaped));
    invoke("escaped output refused", ["feature-map", "update"], 4);
    assert.equal(readFileSync(mapPath, "utf8"), originalMap); writeFileSync(factsPath, originalFacts);
    unlinkSync(mapPath); symlinkSync(join(root, "control/authority"), mapPath);
    invoke("protected output refused", ["feature-map", "update"], 4);
    assert.ok(lstatSync(mapPath).isSymbolicLink()); unlinkSync(mapPath); writeFileSync(mapPath, originalMap);
    const unverified: unknown = JSON.parse(originalProof); assert.ok(unverified && typeof unverified === "object" && "referencesVerified" in unverified); unverified.referencesVerified = false;
    writeFileSync(proofPath, JSON.stringify(unverified));
    invoke("unverified template refused", ["new", "connector", "k4-unverified", "--provider", "toy-k4a-empty", "--plan"], 4);
    writeFileSync(proofPath, originalProof);
    invoke("path escaped name refused", ["new", "connector", "../escaped", "--provider", "toy-k4a-empty"], 2);
    const suffix = randomUUID().slice(0, 8);
    for (const kind of ["connector", "tool", "skill", "migration"] as const) {
      const name = `k4-${kind}-${suffix}`;
      const selectors = kind === "connector" ? ["--provider", "toy-k4a-empty"] : kind === "tool" ? ["--module", "ops", "--operation", "OpsControlRead.status"] : ["--module", kind === "migration" ? "ops" : "self-improvement"];
      const args = ["new", kind, name, ...selectors];
      const planned = invoke(kind + " plan", [...args, "--plan"], 0);
      assert.ok(planned.ok && (planned.commandId === "new.connector" || planned.commandId === "new.tool" || planned.commandId === "new.skill" || planned.commandId === "new.migration"));
      assert.equal(planned.data.applied, false);
      for (const patch of planned.data.patches) if (patch.kind === "create") assert.equal(existsSync(join(root, patch.path)), false);
      for (const item of planned.data.patches) if (item.kind === "create" && item.path.endsWith(".ts")) {
        const base = join(root, item.path.replace("/src/", "/dist/").slice(0, -3));
        for (const suffix of [".js", ".js.map", ".d.ts", ".d.ts.map"]) {
          const path = base + suffix;
          assert.equal(existsSync(path), false, "Fixture emission must not preexist"); emissions.add(path);
        }
      }
      const applied = invoke(kind + " apply", args, 0);
      assert.ok(applied.ok && (applied.commandId === "new.connector" || applied.commandId === "new.tool" || applied.commandId === "new.skill" || applied.commandId === "new.migration"));
      assert.equal(applied.data.applied, true);
      for (const patch of applied.data.patches) {
        assert.equal(digest(readFileSync(join(root, patch.path), "utf8")), patch.afterDigest);
        if (patch.kind === "create") created.set(join(root, patch.path), patch.patch);
      }
      invoke(kind + " overwrite refused", args, 4);
      invoke(kind + " generated map", ["feature-map", "check"], 0);
    }
    const scanned = invoke("valid generated fixtures and static violations", ["gardener", "run", "--request-id", randomUUID(), "--timeout-ms", "120000"], 0);
    assert.ok(scanned.ok && scanned.commandId === "gardener.run" && scanned.data.state === "PASS" && scanned.data.complete);
    assert.ok(scanned.data.findings.length >= 29);
  } finally {
    if (existsSync(mapPath) && lstatSync(mapPath).isSymbolicLink()) unlinkSync(mapPath);
    for (const [path, content] of backups) writeFileSync(path, content);
    for (const [path, content] of created) if (existsSync(path) && readFileSync(path, "utf8") === content) unlinkSync(path);
    for (const path of emissions) if (existsSync(path) && lstatSync(path).isFile()) unlinkSync(path);
    try {
      const restored = spawnSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-b", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 2 * 1024 * 1024, env: { PATH: "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C" } });
      assert.equal(restored.error, undefined, "Canonical compilation after fixture cleanup");
      assert.equal(restored.status, 0, "Canonical compilation after fixture cleanup");
      invoke("canonical CLI after fixture cleanup", ["feature-map", "check"], 0);
    } finally {
      const output = join(root, "build/evidence/R0.K4/attempts", new Date().toISOString().replaceAll(":", "-") + "-" + randomUUID());
      mkdirSync(output, { recursive: true });
      writeFileSync(join(output, "receipts.json"), JSON.stringify({ schemaVersion: "toy.k4-cli-receipts.v1", receipts }, null, 2) + "\n");
    }
  }
});
