import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { cliResultSchema } from "@toy/contracts";

const root = resolve(import.meta.dirname, "../..");
const planningRoot = resolve(root, "../personal-assistant-harness");
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

await test("Sources named-member coverage remains visible through toy research check", () => {
  const child = spawnSync(process.execPath, [join(root, "cli/dist/main.js"), "research", "check", "--release", "R0", "--json"], {
    cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024,
    env: { PATH: "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C" }
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 5);
  assert.equal(child.stderr, "");
  const result = cliResultSchema.parse(JSON.parse(child.stdout));
  assert.ok(result.ok && result.commandId === "research.check");
  assert.equal(result.meta.exitCode, 5);
  assert.equal(result.data.admission, "BLOCKED");
  assert.equal(result.data.dependencyClosureVerified, false);
  assert.equal(result.data.acceptanceComplete, false);
  assert.deepEqual(result.data.wholeATsPassed, []);
  assert.ok(result.data.reports.every(report => report.origin === "planning_archive" && report.digest === report.originalDigest && report.path.endsWith(".md")));
  assert.deepEqual(result.data.componentComparisons, []);
  for (const componentId of ["A08", "A09", "M02"]) {
    assert.ok(result.data.findings.some(finding => finding.componentId === componentId && finding.code === "COMPONENT_COMPARISON_MISSING"));
  }
  const coverage = result.data.sourcesCatalogCoverage;
  assert.equal(coverage.activationVerified, false);
  assert.deepEqual(coverage.sections.map(section => section.section), Array.from({ length: 48 }, (_, index) => "9." + String(index + 1)));
  assert.deepEqual([...new Set(coverage.sections.flatMap(section => section.componentIds))].sort(), Array.from({ length: 66 }, (_, index) => "D" + String(index + 1).padStart(2, "0")));
  assert.equal(coverage.sectionMappingComplete, true);
  assert.equal(coverage.memberMappingComplete, true);
  for (const [name, componentId] of [
    ["Raindrop.io", "D26"], ["Google Docs", "D05"], ["Notion", "D44"],
    ["HubSpot", "D54"], ["Attio", "D55"], ["Box", "D59"],
    ["Google Tasks", "D60"], ["Todoist", "D60"], ["Gradescope", "D61"],
    ["PrairieLearn", "D61"], ["Piazza", "D61"], ["Google Photos", "D64"]
  ] as const) {
    assert.ok(coverage.members.some(member => member.memberKind === "named_provider" && member.memberName.includes(name) && member.componentId === componentId), name);
  }
  for (const componentId of ["D29", "D53", "D56"]) {
    assert.ok(coverage.members.some(member => member.componentId === componentId && member.routeState === "unselected"), componentId);
  }
  assert.ok(coverage.members.some(member => member.componentId === "D41" && member.routeState === "optional_pending"));
  assert.ok(coverage.members.filter(member => member.componentId === "D66").every(member => member.routeState === "superseded"));
  assert.ok(coverage.members.some(member => member.componentId === "D66"));
  assert.ok(coverage.supersessionText);
  assert.ok(coverage.members.filter(member => member.componentId === "D66").every(member => member.routeEvidence === coverage.supersessionText));
  assert.ok(coverage.findings.some(finding => finding.code === "SUPERSESSION_REGISTER_CONFLICT" && finding.componentId === "D66"));
  const source = readFileSync(join(planningRoot, coverage.catalogPath), "utf8");
  const lines = source.split(/\r?\n/);
  const register = readFileSync(join(planningRoot, result.data.registerPath), "utf8");
  const registerLines = register.split(/\r?\n/);
  assert.equal(digest(source), coverage.catalogDigest);
  assert.equal(digest(register), result.data.registerDigest);
  for (const member of coverage.members) {
    assert.equal(member.activationVerified, false);
    assert.equal(member.sourceText, lines[member.sourceLine - 1]);
    assert.equal(member.sourceDigest, digest(member.sourceText));
    assert.ok(member.componentId && member.registerSourceLine && member.registerRowDigest, member.memberName);
    const row = registerLines[member.registerSourceLine - 1];
    assert.ok(row);
    assert.equal(member.registerRowDigest, digest(row));
    assert.ok(row.includes(member.componentId));
    assert.ok(member.routeEvidence.length > 0);
  }
  const output = join(root, "build/evidence/R0.02");
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "catalog-coverage-cli-test.json"), JSON.stringify({
    command: "toy research check --release R0 --json", exitCode: child.status,
    result, wholeATsPassed: [], acceptanceComplete: false
  }, null, 2) + "\n");
});

await test("Ops requirement omissions reach every mapped component through toy research check", () => {
  const child = spawnSync(process.execPath, [join(root, "cli/dist/main.js"), "research", "check", "--release", "R0", "--json"], {
    cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024,
    env: { PATH: "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C" }
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 5);
  assert.equal(child.stderr, "");
  const result = cliResultSchema.parse(JSON.parse(child.stdout));
  assert.ok(result.ok && result.commandId === "research.check");
  assert.equal(result.data.admission, "BLOCKED");
  assert.equal(result.data.acceptanceComplete, false);
  assert.deepEqual(result.data.wholeATsPassed, []);
  assert.equal(result.data.components.length, 165);
  assert.equal(result.data.componentDecisions.length, 165);
  const opsIds = new Set(["A03", "A04", "A05", "A06", "A11", "A12", "A13", "A14", "A15", "A16", "A17", "A18", "A19"]);
  const addedRows = result.data.componentDecisions.filter(decision => decision.missingRequirementIds.includes("2.4") || decision.missingRequirementIds.includes("5.10"));
  assert.deepEqual(addedRows.map(decision => decision.componentId).sort(), [...opsIds].sort());
  for (const decision of result.data.componentDecisions) {
    const expected = ["0.1", "0.2", "0.10", ...(decision.componentId.startsWith("D") ? ["0.9"] : []), ...(opsIds.has(decision.componentId) ? ["2.4", "5.10"] : [])];
    assert.deepEqual(decision.missingRequirementIds, expected, decision.componentId);
    assert.equal(decision.state, "BLOCKED");
    assert.ok(decision.findings.includes("MAPPED_REQUIREMENTS_MISSING"));
  }
  const output = join(root, "build/evidence/R0.02");
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "ops-scope-corrected-cli-test.json"), JSON.stringify({
    command: "toy research check --release R0 --json", exitCode: child.status,
    result, globalRequirementRows: 165, addedOpsRequirementRows: 13,
    wholeATsPassed: [], acceptanceComplete: false
  }, null, 2) + "\n");
});
