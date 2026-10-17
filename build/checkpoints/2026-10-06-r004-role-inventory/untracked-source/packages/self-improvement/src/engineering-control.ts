import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { acceptanceIndexSchema, checkoutPathSchema, cliDeclarations, featureFactsSchema, featureMapCheckSchema, featureMapUpdateSchema, generatorInputSchema, generatorPlanSchema, gardenerInputSchema, gardenerReportSchema, kitchenGateSummarySchema, mapCheckInputSchema, mapUpdateInputSchema, opsControlContextSchema, opsErrorMessages, referenceAdmissionEvidenceSchema, researchRegisterInspectionSchema } from "@toy/contracts";
import type { CheckViewV1, FeatureFactsV1, FilePatchV1, GeneratorInputV1, GeneratorPlanV1, FeatureMapCheckV1, FeatureMapUpdateV1, MapCheckInputV1, MapUpdateInputV1, GardenerInputV1, GardenerReportV1, OpsControlContextV1, ResearchInspectionFindingV1, ResearchRegisterInspectionV1, Result } from "@toy/contracts";
import { trustedCheckoutRoot, trustedToolEnvironment } from "@toy/ops/public";

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const mapPath = "skills/toy-control/FEATURE-MAP.md";
const factsPath = "architecture/features.json";
const planning = (): string => join(dirname(trustedCheckoutRoot()), "personal-assistant-harness");
const read = (path: string): string => readFileSync(safePath(path), "utf8");
const checkedPath = (path: string): string => {
  checkoutPathSchema.parse(path);
  const root = realpathSync(trustedCheckoutRoot());
  const absolute = resolve(root, path);
  if (relative(root, absolute).startsWith("..")) throw new Error("ESCAPED_PATH");
  let current = root;
  for (const part of path.split("/")) {
    current = join(current, part);
    try {
      const file = lstatSync(current);
      if (file.isSymbolicLink() || !file.isDirectory() && !file.isFile()) throw new Error("UNSAFE_PATH");
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
    }
  }
  return absolute;
};
const safePath = (path: string): string => {
  if ([".git", ".agents", ".codex", ".aws", "control"].some((prefix) => path === prefix || path.startsWith(prefix + "/"))) throw new Error("PROTECTED_PATH");
  return checkedPath(path);
};
const sourceExists = (path: string): boolean => existsSync(checkedPath(path));
const refused = <Data>(code: "INVALID_INPUT" | "CONFLICT" | "ARTIFACT_MISMATCH" | "DEPENDENCY_UNAVAILABLE" | "TIMEOUT"): Result<Data> => ({ ok: false, error: { module: "ops", code, message: opsErrorMessages[code], retryable: false } });
const finding = (reasonCode: string, linkage: string, state: "PASS" | "FAIL" = "FAIL", staticCheck = false): CheckViewV1 => ({
  id: staticCheck ? "engineering.static" : "engineering.map", owner: "self-improvement", state, checkedAt: new Date().toISOString(),
  reasonCode, prerequisite: linkage.slice(0, 2000), nextCommandId: staticCheck ? "gardener.run" : "feature-map.check",
  links: { recordRefs: [], observations: [], artifactDigests: [hash(linkage)] }
});
const patch = (path: string, content: string): FilePatchV1 => {
  const absolute = safePath(path);
  const before = existsSync(absolute) ? read(path) : null;
  return { path, beforeDigest: before === null ? null : hash(before), afterDigest: hash(content), kind: before === null ? "create" : "update", mediaType: path.endsWith(".json") ? "application/json" : "text/plain", patch: content };
};
const apply = (patches: FilePatchV1[]): void => {
  const originals = new Map<string, string | null>();
  if (new Set(patches.map((item) => item.path)).size !== patches.length) throw new Error("DUPLICATE_PATCH");
  for (const item of patches) {
    const absolute = safePath(item.path);
    const before = existsSync(absolute) ? read(item.path) : null;
    if ((before === null ? null : hash(before)) !== item.beforeDigest || hash(item.patch) !== item.afterDigest) throw new Error("STALE_PATCH");
    originals.set(item.path, before);
  }
  const applied: FilePatchV1[] = [];
  try {
    for (const item of patches) {
      const absolute = safePath(item.path);
      const before = existsSync(absolute) ? read(item.path) : null;
      if ((before === null ? null : hash(before)) !== item.beforeDigest) throw new Error("STALE_PATCH");
      mkdirSync(dirname(absolute), { recursive: true });
      if (item.kind === "create") writeFileSync(absolute, item.patch, { flag: "wx", mode: 0o600 });
      else {
        const temporary = absolute + "." + randomUUID() + ".tmp";
        try { writeFileSync(temporary, item.patch, { flag: "wx", mode: 0o600 }); renameSync(temporary, absolute); }
        finally { if (existsSync(temporary)) unlinkSync(temporary); }
      }
      applied.push(item);
    }
  } catch (error) {
    for (const item of applied.reverse()) {
      if (existsSync(safePath(item.path)) && hash(read(item.path)) === item.afterDigest) {
        const before = originals.get(item.path);
        if (before === null) unlinkSync(safePath(item.path));
        else if (before !== undefined) writeFileSync(safePath(item.path), before);
      }
    }
    throw error;
  }
};
const render = (facts: FeatureFactsV1, sourceDigest: string): string => {
  const index = acceptanceIndexSchema.parse(JSON.parse(read("tests/acceptance-index.json")));
  const ats = new Map(index.acceptance.map((at) => [at.id, at]));
  const rows = facts.features.map((feature) => {
    const state = feature.implementation;
    const proof = feature.atIds.map((id) => `${id} / ${ats.get(id)?.firstRelease ?? "MISSING"} / ${ats.get(id)?.rung ?? "MISSING"} / ${ats.get(id)?.sourceAssertionHash ?? "MISSING"}`).join("; ");
    return `| ${feature.id} | ${feature.description.replaceAll("|", "\\|").replaceAll("\n", " ")} | ${feature.requirementIds.join(", ")} | ${feature.firstRelease} / ${state} | [${feature.entry}](../../${feature.entry}) | ${feature.owner} / ${feature.publicInterface} | ${feature.paths.map((path) => `[${path}](../../${path})`).join("; ")} | ${feature.commands.join("; ") || "future assigned-rung owner route"} | ${proof} |`;
  });
  return `# Toy feature map\n\nCanonical source: architecture/features.json, generated owner command declarations and source-bound acceptance index. Source digest: ${sourceDigest}. States describe implementation availability; acceptance requires saved whole-assertion evidence. Future declarations remain specified.\n\n| Feature ID | Behavior | Requirements | First release / state | User entry | Public interface | Source paths | CLI | Assigned proof and assertion digest |\n|---|---|---|---|---|---|---|---|---|\n${rows.join("\n")}\n`;
};
const inspect = (): { facts: FeatureFactsV1; check: FeatureMapCheckV1; expected: string } => {
  const raw = read(factsPath);
  const facts = featureFactsSchema.parse(JSON.parse(raw));
  const indexRaw = read("tests/acceptance-index.json");
  const index = acceptanceIndexSchema.parse(JSON.parse(indexRaw));
  const findings: CheckViewV1[] = [];
  const fail = (code: string, id: string): void => { findings.push(finding(code, id)); };
  for (const [kind, ids] of [["FEATURE", facts.features.map((feature) => feature.id)], ["COMMAND", facts.commands], ["AT", facts.ats], ["REQUIREMENT", facts.requirements.map((item) => item.id)], ["INTERFACE", facts.interfaces.map((item) => item.id)], ["AT_SOURCE", index.acceptance.map((at) => at.id)]] as const) {
    const seen = new Set<string>();
    for (const id of ids) { if (seen.has(id)) fail("DUPLICATE_" + kind, id); seen.add(id); }
  }
  const requirements = new Map(facts.requirements.map((item) => [item.id, item]));
  const interfaces = new Map(facts.interfaces.map((item) => [item.id, item]));
  const features = new Map(facts.features.map((feature) => [feature.id, feature]));
  const atIds = new Set(index.acceptance.map((at) => at.id));
  const commandIds = new Set<string>(cliDeclarations.map((command) => command.id));
  const routedAts = new Set(facts.features.flatMap((feature) => feature.atIds));
  const routedCommands = new Set(facts.features.flatMap((feature) => feature.commands));
  for (const command of cliDeclarations) {
    if (!facts.commands.includes(command.id) || !routedCommands.has(command.id)) fail("COMMAND_UNMAPPED", command.id);
    for (const id of command.featureIds) {
      const feature = features.get(id);
      if (!feature?.commands.includes(command.id)) fail("FEATURE_UNMAPPED", id);
      if (feature && (feature.owner !== command.owner || feature.publicInterface !== command.operation || feature.firstRelease !== command.firstRelease || feature.implementation !== command.implementation)) fail("COMMAND_DECLARATION_STALE", command.id);
    }
  }
  for (const id of facts.commands) if (!commandIds.has(id)) fail("COMMAND_ORPHAN", id);
  for (const at of index.acceptance) {
    if (!facts.ats.includes(at.id) || !routedAts.has(at.id)) fail("AT_UNMAPPED", at.id);
    if (!at.sourceAssertion.startsWith("- **" + at.id + " [" + at.firstRelease + "]**")) fail("ASSERTION_ID_MISMATCH", at.id);
    if (hash(at.sourceAssertion) !== at.sourceAssertionHash) fail("ASSERTION_CHANGED", at.id);
    try {
      const source = readFileSync(join(planning(), at.source), "utf8");
      if (hash(source) !== at.sourceDigest || !source.split(/\r?\n/).includes(at.sourceAssertion)) fail("AT_SOURCE_STALE", at.id);
    } catch { fail("AT_SOURCE_MISSING", at.id); }
  }
  for (const id of facts.ats) if (!atIds.has(id)) fail("AT_ORPHAN", id);
  for (const requirement of facts.requirements) {
    try { if (!lstatSync(join(planning(), requirement.path)).isFile()) fail("REQUIREMENT_PATH", requirement.id); }
    catch { fail("REQUIREMENT_PATH", requirement.id); }
  }
  for (const contract of facts.interfaces) {
    try { if (!sourceExists(contract.path)) fail("INTERFACE_PATH", contract.id); }
    catch { fail("INTERFACE_PATH", contract.id); }
  }
  for (const feature of facts.features) {
    if (feature.atIds.length === 0) fail("FEATURE_AT_MISSING", feature.id);
    for (const id of feature.requirementIds) if (!requirements.has(id)) fail("REQUIREMENT_DANGLING", feature.id + ":" + id);
    if (!interfaces.has(feature.publicInterface) || interfaces.get(feature.publicInterface)?.owner !== feature.owner) fail("INTERFACE_DANGLING", feature.id + ":" + feature.publicInterface);
    for (const path of [feature.entry, ...feature.paths]) {
      try { if (!sourceExists(path)) fail(path === feature.entry ? "ENTRY_DANGLING" : "PATH_DANGLING", feature.id + ":" + path); }
      catch { fail("PATH_REFUSED", feature.id + ":" + path); }
    }
    for (const id of feature.commands) if (!commandIds.has(id)) fail("COMMAND_DANGLING", feature.id + ":" + id);
    for (const id of feature.atIds) if (!atIds.has(id)) fail("AT_DANGLING", feature.id + ":" + id);
  }
  const sourceDigest = hash(JSON.stringify([hash(raw), hash(indexRaw), cliDeclarations]));
  const expected = render(facts, sourceDigest);
  const actual = read(mapPath);
  const mapped = new Set(actual.split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| Feature ID ")).map((line) => line.split(" | ")[0]?.slice(2) ?? ""));
  for (const feature of facts.features) if (!mapped.has(feature.id)) fail("MAP_FEATURE_MISSING", feature.id);
  for (const id of mapped) if (!features.has(id)) fail("MAP_FEATURE_ORPHAN", id);
  if (actual !== expected) fail("MAP_DIGEST_STALE", mapPath);
  return { facts, expected, check: featureMapCheckSchema.parse({ sourceDigest, actualMapDigest: hash(actual), expectedMapDigest: hash(expected), featureCount: String(facts.features.length), commandCount: String(cliDeclarations.length), atCount: String(index.acceptance.length), findings, state: findings.length === 0 ? "PASS" : "FAIL" }) };
};

const readResearchFile = (path: string): string => {
  checkoutPathSchema.parse(path);
  if (path !== "specs/RESEARCH-REGISTER.md" && !path.startsWith("research/")) throw new Error("RESEARCH_PATH_REFUSED");
  let current = realpathSync(planning());
  for (const part of path.split("/")) {
    current = join(current, part);
    const file = lstatSync(current);
    if (file.isSymbolicLink() || !file.isDirectory() && !file.isFile()) throw new Error("RESEARCH_PATH_REFUSED");
  }
  return readFileSync(current, "utf8");
};
const inspectResearch = (input: MapCheckInputV1): ResearchRegisterInspectionV1 => {
  const registerPath = "specs/RESEARCH-REGISTER.md";
  const raw = readResearchFile(registerPath);
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((line) => /^## 4\. Component inventory\s*$/.test(line));
  const end = lines.findIndex((line, index) => index > start && /^## 5\./.test(line));
  if (start < 0 || end < 0) throw new Error("REGISTER_INVENTORY_MISSING");
  const reports: ResearchRegisterInspectionV1["reports"] = [];
  const reportKeys = new Set<string>();
  for (const line of lines.slice(0, start)) {
    const match = /^\| \*\*([A-Z]+)\*\* \| \[[^\]]+\]\(\.\.\/(research\/[a-zA-Z0-9._/-]+)\) \| (.+) \|$/.exec(line);
    if (!match) continue;
    const [, key, path, listedSections] = match;
    if (!key || !path || !listedSections || reportKeys.has(key)) throw new Error("REGISTER_REPORT_INVALID");
    reportKeys.add(key);
    let digest: string | null = null;
    try { digest = hash(readResearchFile(path)); } catch { digest = null; }
    reports.push({ key, path, listedSections, digest });
  }
  if (reports.length === 0) throw new Error("REGISTER_REPORTS_MISSING");
  const inHousePinMissing = lines.slice(start, end).some((line) => /^All in-house implementations\b/.test(line) && line.includes("PIN-MISSING"));
  const components: ResearchRegisterInspectionV1["components"] = [];
  const findings: ResearchInspectionFindingV1[] = [];
  const ids = new Set<string>();
  for (let index = start + 1; index < end; index += 1) {
    const row = lines[index];
    if (!row) continue;
    const match = /^\|\s+\*\*([A-Z][0-9]{2})\b/.exec(row);
    if (!match) continue;
    const id = match[1];
    const cells = row.split("|").slice(1, -1).map((cell) => cell.trim());
    if (!id || !/^[A-Z][0-9]{2}$/.test(id) || ids.has(id) || ![4, 5].includes(cells.length)) throw new Error("REGISTER_ROW_INVALID");
    ids.add(id);
    const [componentAndPin, consumingSpecs, third, fourth, fifth] = cells;
    if (!componentAndPin || consumingSpecs === undefined || third === undefined || fourth === undefined) throw new Error("REGISTER_ROW_INVALID");
    const researchReference = cells.length === 4 ? consumingSpecs : third;
    const alternativesAndReason = cells.length === 4 ? third : fourth;
    const releaseGate = cells.length === 4 ? fourth : fifth;
    if (releaseGate === undefined) throw new Error("REGISTER_ROW_INVALID");
    const sourceLine = index + 1;
    const missingPinDeclared = id.startsWith("M") && inHousePinMissing || /PIN-MISSING/.test(row);
    const keys = reports.filter((report) => new RegExp("\\b" + report.key + "\\b").test(researchReference)).map((report) => report.key);
    const gap = (code: ResearchInspectionFindingV1["code"]): void => { findings.push({ componentId: id, code, sourceLine }); };
    if (missingPinDeclared) gap("PIN_MISSING");
    if (!consumingSpecs) gap("CONSUMING_SPECS_MISSING");
    if (/UNRESEARCHED\s*[—–-]\s*OPEN/.test(researchReference)) gap("RESEARCH_CHOICE_OPEN");
    if (keys.length === 0 && !/(?:§|section\s+[0-9])/i.test(researchReference)) gap("RESEARCH_REFERENCE_MISSING");
    if (reports.some((report) => keys.includes(report.key) && report.digest === null)) gap("REPORT_MISSING");
    if (!alternativesAndReason) gap("DECISION_MISSING");
    if (!/\[R[0-5]\b/.test(releaseGate)) gap("GATE_MISSING");
    components.push({ id, sourceLine, rowDigest: hash(row), componentAndPin, consumingSpecs, researchReference, alternativesAndReason, releaseGate, missingPinDeclared, reportKeys: keys, certification: "UNVERIFIED" });
  }
  for (const code of ["GATE_EVIDENCE_UNVERIFIED", "RESEARCH_ATTESTATION_UNVERIFIED", "DEPENDENCY_CLOSURE_UNVERIFIED"] as const) findings.push({ componentId: null, code, sourceLine: null });
  return researchRegisterInspectionSchema.parse({ requestedRelease: input.release, registerPath, registerDigest: hash(raw), components, reports, findings, scope: "register_inventory", admission: "BLOCKED", acceptanceComplete: false });
};

export const EngineeringControl = {
  checkResearch(input: MapCheckInputV1, context: OpsControlContextV1): Result<ResearchRegisterInspectionV1> {
    if (!mapCheckInputSchema.safeParse(input).success || !opsControlContextSchema.safeParse(context).success) return refused("INVALID_INPUT");
    try { return { ok: true, data: inspectResearch(input) }; } catch { return refused("ARTIFACT_MISMATCH"); }
  },
  checkFeatureMap(input: MapCheckInputV1, context: OpsControlContextV1): Result<FeatureMapCheckV1> {
    try { mapCheckInputSchema.parse(input); opsControlContextSchema.parse(context); return { ok: true, data: inspect().check }; } catch { return refused("ARTIFACT_MISMATCH"); }
  },
  updateFeatureMap(input: MapUpdateInputV1, context: OpsControlContextV1): Result<FeatureMapUpdateV1> {
    try {
      mapUpdateInputSchema.parse(input); opsControlContextSchema.parse(context);
      const { check, expected, facts } = inspect();
      if (check.findings.some((item) => !["MAP_DIGEST_STALE", "MAP_FEATURE_MISSING", "MAP_FEATURE_ORPHAN"].includes(item.reasonCode ?? ""))) return refused("ARTIFACT_MISMATCH");
      const patches = check.actualMapDigest === check.expectedMapDigest ? [] : [patch(mapPath, expected)];
      if (!input.plan) apply(patches);
      return { ok: true, data: featureMapUpdateSchema.parse({ check: input.plan ? check : inspect().check, patches, changedFeatureIds: patches.length ? facts.features.map((feature) => feature.id) : [], applied: !input.plan }) };
    } catch { return refused("ARTIFACT_MISMATCH"); }
  },
  generate(input: GeneratorInputV1, context: OpsControlContextV1): Result<GeneratorPlanV1> {
    try {
      generatorInputSchema.parse(input); opsControlContextSchema.parse(context);
      if (input.kind === "connector" && (input.owner !== "sources" || input.provider !== "toy-k4a-empty") || input.kind === "tool" && (input.owner !== "ops" || input.operation !== "OpsControlRead.status") || input.kind === "skill" && input.owner !== "self-improvement" || input.kind === "migration" && input.owner !== "ops") return refused("DEPENDENCY_UNAVAILABLE");
      const referencePaths = { connector: "packages/sources/src/adapters/k4a-reference.ts", tool: "packages/self-improvement/src/reference-tools/ops-status.ts", skill: "skills/toy-control/SKILL.md", migration: "packages/ops/migrations/0001-k4a-reference.sql" };
      const sourcePath = referencePaths[input.kind];
      const source = read(sourcePath);
      const proof = referenceAdmissionEvidenceSchema.parse(JSON.parse(read("build/evidence/R0.K4a/reference-verification.json")));
      if (proof.sourceHashes[sourcePath] !== hash(source) || !proof.references.some((reference) => reference.pattern === input.kind)) return refused("ARTIFACT_MISMATCH");
      const facts = featureFactsSchema.parse(JSON.parse(read(factsPath)));
      const featureId = `generated.${input.kind}.${input.name}`;
      if (facts.features.some((feature) => feature.id === featureId)) return refused("CONFLICT");
      const camel = input.name.replaceAll("-", "_");
      let target: string;
      let content: string;
      const patches: FilePatchV1[] = [];
      if (input.kind === "connector") {
        target = `packages/sources/src/adapters/${input.name}.ts`;
        content = source.replaceAll("k4aReference", camel).replaceAll('"toy-k4a-empty"', '"' + input.name + '"');
        const publicPath = "packages/sources/src/public.ts";
        patches.push(patch(publicPath, read(publicPath) + `\nexport { ${camel}SourceAdapter, ${camel}SourceDigest } from "./adapters/${input.name}.js";\n`));
      } else if (input.kind === "tool") {
        target = `packages/self-improvement/src/reference-tools/${input.name}.ts`;
        content = source.replaceAll("opsStatusToolRegistration", camel + "ToolRegistration").replaceAll("toyOpsStatus", camel).replaceAll("toy_ops_status", input.name.replaceAll("-", "_"));
        const publicPath = "packages/self-improvement/src/public.ts";
        patches.push(patch(publicPath, read(publicPath) + `\nexport { ${camel}, ${camel}ToolRegistration } from "./reference-tools/${input.name}.js";\n`));
      } else if (input.kind === "skill") {
        target = `skills/${input.name}/SKILL.md`;
        content = source.replaceAll("toy-control", input.name);
        patches.push(patch(`skills/${input.name}/FEATURE-MAP.md`, read(mapPath)));
      } else {
        target = `packages/ops/migrations/${input.name}.sql`;
        content = source.replaceAll("k4a_reference_marker", input.name.replaceAll("-", "_") + "_marker").replaceAll("R0.K4a", featureId);
        const descriptor = { migration_id: featureId, owner: "ops", dialect: "sqlite", target_database: "private_disposable_sqlite_world", target_schema: "main", target_table: input.name.replaceAll("-", "_") + "_marker", source_path: target, source_sha256: hash(content), transactional: true, disposable_only: true, production_allowed: false, automatic_rollback: false };
        patches.push(patch(`packages/ops/migrations/${input.name}.json`, JSON.stringify(descriptor, null, 2) + "\n"));
      }
      if (existsSync(safePath(target)) || patches.some((item) => item.kind === "update" && item.path !== "packages/sources/src/public.ts" && item.path !== "packages/self-improvement/src/public.ts")) return refused("CONFLICT");
      patches.unshift(patch(target, content));
      facts.features.push({ id: featureId, description: "Generated feasibility-only " + input.kind + "; production activation remains pending assigned owner acceptance", implementation: "specified", requirementIds: ["0.17"], entry: target, owner: input.owner, publicInterface: input.kind === "connector" ? "SourceAdapterR0" : input.kind === "tool" ? "OpsControlRead.status" : input.kind === "skill" ? "EngineeringControl.generate" : "Ops migrations", paths: patches.map((item) => item.path), firstRelease: "R0", commands: ["new." + input.kind], atIds: ["AT-hermes-config-101", "AT-cli-25"] });
      const beforeInventoryDigest = hash(read(factsPath));
      const afterFacts = JSON.stringify(facts, null, 2) + "\n";
      const indexRaw = read("tests/acceptance-index.json");
      patches.push(patch(factsPath, afterFacts));
      patches.push(patch(mapPath, render(facts, hash(JSON.stringify([hash(afterFacts), hash(indexRaw), cliDeclarations])))));
      if (!input.plan) apply(patches);
      return { ok: true, data: generatorPlanSchema.parse({ kind: input.kind, name: input.name, owner: input.owner, templateDigest: hash(source), patches, featureIds: [featureId], requiredAtIds: ["AT-hermes-config-101", "AT-cli-25"], prerequisites: ["Full runtime acceptance remains assigned to R1; generated output does not activate production"], applied: !input.plan, beforeInventoryDigest, afterInventoryDigest: hash(afterFacts) }) };
    } catch { return refused("ARTIFACT_MISMATCH"); }
  },
  garden(input: GardenerInputV1, context: OpsControlContextV1): Result<GardenerReportV1> {
    if (!gardenerInputSchema.safeParse(input).success) return refused("INVALID_INPUT");
    if (input.mode !== "scan") return refused("DEPENDENCY_UNAVAILABLE");
    try {
      const root = trustedCheckoutRoot();
      const home = safePath("build/.engineering-home");
      mkdirSync(home, { recursive: true, mode: 0o700 });
      const checks: CheckViewV1[] = [];
      const deadline = performance.now() + context.timeoutMs;
      for (const script of ["scripts/check-k2.mjs", "scripts/check-foundations.mjs"]) {
        const remainingMs = Math.floor(deadline - performance.now());
        if (remainingMs <= 0) return refused("TIMEOUT");
        const child = spawnSync(process.execPath, [join(root, script)], { cwd: root, encoding: "utf8", timeout: remainingMs, maxBuffer: 2 * 1024 * 1024, env: trustedToolEnvironment() });
        if (child.error) return refused("TIMEOUT");
        const summary = kitchenGateSummarySchema.parse(JSON.parse(child.stdout));
        checks.push(...summary.checks.map((check) => finding(check.passed ? "STATIC_REJECTION_VERIFIED" : "STATIC_CHECK_FAILED", script + ":" + check.id, check.passed ? "PASS" : "FAIL", true)));
        if (child.status !== 0 && summary.verdict === "PASS") return refused("ARTIFACT_MISMATCH");
      }
      checks.push(...inspect().check.findings);
      return { ok: true, data: gardenerReportSchema.parse({ mode: "scan", findings: checks.map((check) => ({ id: hash(check.prerequisite ?? ""), check, correctionRung: 2, disposition: check.state === "PASS" ? "fixed" : "blocked", obligationId: null, incidentId: null })), patches: [], verificationRefs: [], state: checks.every((check) => check.state === "PASS") ? "PASS" : "FAIL", complete: true }) };
    } catch { return refused("ARTIFACT_MISMATCH"); }
  }
};
