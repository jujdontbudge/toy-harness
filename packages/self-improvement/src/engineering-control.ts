import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { acceptanceIndexSchema, checkoutPathSchema, cliDeclarations, featureFactsSchema, featureMapCheckSchema, featureMapUpdateSchema, generatorInputSchema, generatorPlanSchema, gardenerInputSchema, gardenerReportSchema, kitchenGateSummarySchema, mapCheckInputSchema, mapUpdateInputSchema, opsControlContextSchema, opsErrorMessages, referenceAdmissionEvidenceSchema, researchCatalogCoverageSchema, researchComponentComparisonSchema, researchComponentComparisonCheckSchema, researchDocumentOverlaySchema, researchRegisterInspectionV2Schema, researchComponentComparisonV2Schema, researchComponentComparisonCheckV2Schema, researchSourcesComponentComparisonSchema } from "@toy/contracts";
import type { CheckViewV1, FeatureFactsV1, FilePatchV1, GeneratorInputV1, GeneratorPlanV1, FeatureMapCheckV1, FeatureMapUpdateV1, MapCheckInputV1, MapUpdateInputV1, GardenerInputV1, GardenerReportV1, OpsControlContextV1, ResearchCatalogCoverageFindingV1, ResearchCatalogMemberV1, ResearchCatalogSectionV1, ResearchInspectionFindingV1, ResearchComponentComparisonV1, ResearchComponentComparisonCheckV1, ResearchDocumentOverlayV1, ResearchRegisterInspectionV1, ResearchRegisterInspectionV2, ResearchComponentComparisonV2, ResearchComponentComparisonCheckV2, ResearchSourcesComponentComparisonV1, Result } from "@toy/contracts";
import { OpsTestStack, trustedCheckoutRoot, trustedToolEnvironment } from "@toy/ops/public";
import { modelAdmissionMigration } from "./model-admission-migration.js";
import { capacityTrialMigration } from "./capacity-trial-migration.js";

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
  if (!/^specs\/[^/]+\.md$/.test(path) && !(path.startsWith("research/") && path.endsWith(".md"))) throw new Error("RESEARCH_PATH_REFUSED");
  let current = realpathSync(planning());
  for (const part of path.split("/")) {
    current = join(current, part);
    const file = lstatSync(current);
    if (file.isSymbolicLink() || !file.isDirectory() && !file.isFile()) throw new Error("RESEARCH_PATH_REFUSED");
  }
  return readFileSync(current, "utf8");
};
const markdownTableCells = (line: string): string[] | null => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const inner = trimmed.endsWith("|") ? trimmed.slice(1, -1) : trimmed.slice(1);
  return inner.split("|");
};
const isMarkdownTableSeparator = (cells: string[]): boolean => cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
const isRequirementHeader = (cell: string): boolean => /^requirements?\b/i.test(cell.replace(/[*_~`]/g, "").trim());
const inspectResearchSpecs = (components: ResearchRegisterInspectionV1["components"], findings: ResearchInspectionFindingV1[]): ResearchRegisterInspectionV1["specReferences"] => {
  const specDirectory = join(realpathSync(planning()), "specs");
  const directory = lstatSync(specDirectory);
  if (directory.isSymbolicLink() || !directory.isDirectory()) throw new Error("RESEARCH_SPECS_UNSAFE");
  const paths = readdirSync(specDirectory).filter((name) => name.endsWith(".md")).map((name) => "specs/" + name).sort();
  if (paths.length === 0) throw new Error("RESEARCH_SPECS_MISSING");
  const inventoryIds = new Set(components.map((component) => component.id));
  return paths.map((path) => {
    const raw = readResearchFile(path);
    const lines = raw.split(/\r?\n/);
    const referenceLines = new Map<string, Set<number>>();
    const requirementMappingRows: ResearchRegisterInspectionV1["specReferences"][number]["requirementMappingRows"] = [];
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (line === undefined) continue;
      const lineNumber = lineIndex + 1;
      const lineIds = new Set<string>();
      for (const match of line.matchAll(/\b([ABNCEDM][0-9]{2})\b/g)) {
        const id = match[1];
        if (id) lineIds.add(id);
      }
      for (const id of lineIds) {
        const sourceLines = referenceLines.get(id) ?? new Set<number>();
        sourceLines.add(lineNumber);
        referenceLines.set(id, sourceLines);
      }
      const headerCells = markdownTableCells(line);
      const separatorCells = markdownTableCells(lines[lineIndex + 1] ?? "");
      const header = headerCells?.[0];
      if (!headerCells || !separatorCells || headerCells.length !== separatorCells.length || !isMarkdownTableSeparator(separatorCells) || header === undefined || !isRequirementHeader(header)) continue;
      for (let rowIndex = lineIndex + 2; rowIndex < lines.length; rowIndex += 1) {
        const row = lines[rowIndex];
        if (row === undefined) continue;
        const cells = markdownTableCells(row);
        const requirementCell = cells?.[0];
        if (!cells || isMarkdownTableSeparator(cells) || requirementCell === undefined) break;
        requirementMappingRows.push({ sourceLine: rowIndex + 1, rowDigest: hash(row), requirementCell });
      }
    }
    const componentReferences: ResearchRegisterInspectionV1["specReferences"][number]["componentReferences"] = [...referenceLines.entries()]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([id, sourceLines]) => ({ id, sourceLines: [...sourceLines].sort((left, right) => left - right) }));
    for (const reference of componentReferences) {
      if (inventoryIds.has(reference.id)) continue;
      for (const sourceLine of reference.sourceLines) findings.push({ componentId: reference.id, code: "COMPONENT_REFERENCE_UNMAPPED", sourceLine, sourcePath: path });
    }
    return { path, digest: hash(raw), componentReferences, requirementMappingRows };
  });
};
type CatalogRouteState = ResearchCatalogMemberV1["routeState"];
type CatalogCrosswalkEntry = { memberName: string; componentId: string; registerTerm: string; routeState: CatalogRouteState };
type CatalogSectionSource = ResearchCatalogSectionV1 & { bodyLines: { text: string; lineNumber: number }[] };
const crosswalkEntry = (memberName: string, componentId: string, registerTerm: string, routeState: CatalogRouteState): CatalogCrosswalkEntry => ({ memberName, componentId, registerTerm, routeState });
const catalogMemberCrosswalk: ReadonlyMap<string, ReadonlyMap<string, readonly CatalogCrosswalkEntry[]>> = new Map([
  ["9.26", new Map([
    ["raindrop.io", [crosswalkEntry("Raindrop.io", "D26", "Raindrop", "optional_pending")]],
    ["obsidian/local markdown", [crosswalkEntry("Obsidian/local Markdown", "D27", "Obsidian", "pending")]],
    ["google docs writing", [crosswalkEntry("Google Docs", "D05", "Docs", "pending")]],
    ["notion writing", [crosswalkEntry("Notion", "D44", "Notion", "pending")]],
    ["anki", [crosswalkEntry("Anki", "D28", "Anki", "optional_pending")]],
    ["pocket/instapaper/other read-later services", [crosswalkEntry("Pocket", "D29", "Pocket", "unselected"), crosswalkEntry("Instapaper", "D29", "Instapaper", "unselected"), crosswalkEntry("Other read-later services", "D29", "read-later", "unselected")]]
  ])],
  ["9.46", new Map([
    ["quickbooks online", [crosswalkEntry("QuickBooks Online", "D49", "QuickBooks", "optional_pending")]],
    ["xero", [crosswalkEntry("Xero", "D50", "Xero", "optional_pending")]],
    ["vercel", [crosswalkEntry("Vercel", "D51", "Vercel", "optional_pending")]],
    ["cloudflare/registrar", [crosswalkEntry("Cloudflare", "D52", "Cloudflare", "optional_pending"), crosswalkEntry("Registrar", "D53", "Registrar", "unselected")]],
    ["crm: hubspot/attio/etc.", [crosswalkEntry("HubSpot", "D54", "HubSpot", "optional_pending"), crosswalkEntry("Attio", "D55", "Attio", "optional_pending"), crosswalkEntry("Other CRM via etc.", "D56", "Other CRM", "unselected")]],
    ["figma", [crosswalkEntry("Figma", "D57", "Figma", "optional_pending")]],
    ["dropbox/box", [crosswalkEntry("Dropbox", "D58", "Dropbox", "optional_pending"), crosswalkEntry("Box", "D59", "Box", "optional_pending")]]
  ])],
  ["9.47", new Map([
    ["onedrive/sharepoint at uiuc", [crosswalkEntry("OneDrive", "D60", "OneDrive", "blocked"), crosswalkEntry("SharePoint", "D60", "SharePoint", "blocked")]],
    ["google tasks", [crosswalkEntry("Google Tasks", "D60", "Google Tasks", "pending")]],
    ["todoist/other task apps", [crosswalkEntry("Todoist", "D60", "Todoist", "optional_pending"), crosswalkEntry("Other task apps", "D60", "Other task apps", "unselected")]],
    ["gradescope, prairielearn, piazza, course sites", [crosswalkEntry("Gradescope", "D61", "Gradescope", "partial"), crosswalkEntry("PrairieLearn", "D61", "PrairieLearn", "partial"), crosswalkEntry("Piazza", "D61", "Piazza", "partial"), crosswalkEntry("Course sites", "D61", "course sites", "partial")]],
    ["public uiuc academic calendars", [crosswalkEntry("Public UIUC academic calendars", "D62", "academic calendars", "pending")]],
    ["travel, shipping, subscriptions, receipts", [crosswalkEntry("Travel", "D63", "Travel", "partial"), crosswalkEntry("Shipping", "D63", "shipping", "partial"), crosswalkEntry("Subscriptions", "D63", "subscriptions", "partial"), crosswalkEntry("Receipts", "D63", "receipts", "partial")]],
    ["photos", [crosswalkEntry("PhotoKit", "D64", "PhotoKit", "optional_pending"), crosswalkEntry("Google Photos", "D64", "Google Photos", "optional_pending")]],
    ["meetings/transcripts", [crosswalkEntry("Meetings/transcripts", "D65", "transcripts", "partial")]],
    ["apple app privacy report", [crosswalkEntry("Apple App Privacy Report", "D65", "App Privacy Report", "optional_pending")]],
    ["personal local documents", [crosswalkEntry("Personal local documents", "D65", "personal documents", "pending")]]
  ])]
]);
const sourceSections = (raw: string, findings: ResearchCatalogCoverageFindingV1[]): Map<string, CatalogSectionSource> => {
  const lines = raw.split(/\r?\n/);
  const headers: { index: number; number: number; title: string }[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const match = /^### 9\.([0-9]{1,2})\s+(.+?)\s*$/.exec(line);
    const number = Number(match?.[1]);
    if (match && number >= 1 && number <= 48) headers.push({ index, number, title: match[2] ?? "" });
  }
  const sections = new Map<string, CatalogSectionSource>();
  for (let headerIndex = 0; headerIndex < headers.length; headerIndex += 1) {
    const header = headers[headerIndex];
    if (!header) continue;
    const section = "9." + header.number;
    if (sections.has(section)) {
      findings.push({ code: "SECTION_DUPLICATE", section, memberName: null, sourceLine: header.index + 1, componentId: null, registerSourceLine: null, detail: "Sources catalog section number occurs more than once" });
      continue;
    }
    const nextSourceSection = headers[headerIndex + 1]?.index ?? lines.length;
    let end = nextSourceSection;
    for (let index = header.index + 1; index < nextSourceSection; index += 1) {
      const line = lines[index] ?? "";
      if (/^## (?:10|[1-9][0-9])\./.test(line)) { end = index; break; }
    }
    const sectionLines = lines.slice(header.index, end);
    sections.set(section, {
      section,
      sourceLine: header.index + 1,
      title: header.title,
      sectionDigest: hash(sectionLines.join("\n")),
      componentIds: [],
      bodyLines: sectionLines.map((text, offset) => ({ text, lineNumber: header.index + offset + 1 }))
    });
  }
  return sections;
};
const sectionReferences = (consumingSpecs: string): string[] => [...consumingSpecs.matchAll(/\bS\s+§9\.([0-9]{1,2})\b/g)].map((match) => "9." + (match[1] ?? ""));
const cleanMarkdownCell = (value: string): string => value.replaceAll("**", "").replaceAll("__", "").replaceAll("`", "").replaceAll("*", "").trim();
const tableMemberRows = (section: CatalogSectionSource): { label: string; sourceText: string; sourceLine: number }[] => {
  const result: { label: string; sourceText: string; sourceLine: number }[] = [];
  for (let index = 0; index + 1 < section.bodyLines.length; index += 1) {
    const header = section.bodyLines[index];
    const separator = section.bodyLines[index + 1];
    if (!header || !separator) continue;
    const headerCells = markdownTableCells(header.text);
    const separatorCells = markdownTableCells(separator.text);
    const firstHeader = headerCells?.[0];
    if (!headerCells || !separatorCells || headerCells.length !== separatorCells.length || !isMarkdownTableSeparator(separatorCells) || !firstHeader || !["Connector", "Source"].includes(cleanMarkdownCell(firstHeader))) continue;
    for (let rowIndex = index + 2; rowIndex < section.bodyLines.length; rowIndex += 1) {
      const row = section.bodyLines[rowIndex];
      if (!row) continue;
      const cells = markdownTableCells(row.text);
      if (!cells || isMarkdownTableSeparator(cells)) break;
      const label = cleanMarkdownCell(cells[0] ?? "");
      if (label) result.push({ label, sourceText: row.text, sourceLine: row.lineNumber });
    }
  }
  return result;
};
const componentRouteState = (componentId: string): CatalogRouteState => {
  if (componentId === "D66") return "superseded";
  if (["D02", "D03", "D13"].includes(componentId)) return "blocked";
  if (["D06", "D08", "D61", "D63", "D65"].includes(componentId)) return "partial";
  if (["D29", "D53", "D56"].includes(componentId)) return "unselected";
  if (["D22", "D23", "D25", "D26", "D28", "D31", "D33", "D34", "D35", "D36", "D38", "D39", "D41", "D49", "D50", "D51", "D52", "D54", "D55", "D57", "D58", "D59", "D64"].includes(componentId)) return "optional_pending";
  return "pending";
};
const registerDisplayName = (component: ResearchRegisterInspectionV1["components"][number]): string => component.componentAndPin.replace(/^\*\*D[0-9]{2}\s*/, "").split("**")[0]?.trim() ?? component.id;
const normalizedWords = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const inspectSourcesCatalog = (components: ResearchRegisterInspectionV1["components"]): ResearchRegisterInspectionV1["sourcesCatalogCoverage"] => {
  const catalogPath = "specs/sources.md";
  const contractPath = "specs/CONTRACTS.md";
  const catalogRaw = readResearchFile(catalogPath);
  const contractRaw = readResearchFile(contractPath);
  const registerComponents = new Map(components.filter((component) => /^D[0-9]{2}$/.test(component.id)).map((component) => [component.id, component]));
  const coverageFindings: ResearchCatalogCoverageFindingV1[] = [];
  const addFinding = (findingValue: ResearchCatalogCoverageFindingV1): void => { coverageFindings.push(findingValue); };
  const sections = sourceSections(catalogRaw, coverageFindings);
  const sectionsByComponent = new Map<string, string[]>();
  for (const expectedNumber of Array.from({ length: 66 }, (_, index) => index + 1)) {
    const expectedId = "D" + String(expectedNumber).padStart(2, "0");
    if (!registerComponents.has(expectedId)) addFinding({ code: "REGISTER_COMPONENT_MISSING", section: null, memberName: expectedId, sourceLine: null, componentId: expectedId, registerSourceLine: null, detail: "Required Sources component row is absent from D01–D66 inventory" });
  }
  for (const component of registerComponents.values()) {
    const componentNumber = Number(component.id.slice(1));
    if (componentNumber < 1 || componentNumber > 66) addFinding({ code: "REGISTER_COMPONENT_OUT_OF_RANGE", section: null, memberName: registerDisplayName(component), sourceLine: null, componentId: component.id, registerSourceLine: component.sourceLine, detail: "Sources inventory component falls outside the D01–D66 catalog range" });
    const references = sectionReferences(component.consumingSpecs);
    if (references.length === 0) addFinding({ code: "REGISTER_SECTION_MISSING", section: null, memberName: registerDisplayName(component), sourceLine: null, componentId: component.id, registerSourceLine: component.sourceLine, detail: "Canonical Sources component has no exact S §9.N consuming-spec reference" });
    for (const section of references) {
      const linked = sectionsByComponent.get(component.id) ?? [];
      if (!linked.includes(section)) linked.push(section);
      sectionsByComponent.set(component.id, linked);
    }
  }
  for (const expectedNumber of Array.from({ length: 48 }, (_, index) => index + 1)) {
    const section = "9." + expectedNumber;
    if (!sections.has(section)) addFinding({ code: "SECTION_MISSING", section, memberName: null, sourceLine: null, componentId: null, registerSourceLine: null, detail: "Sources catalog section is absent" });
  }
  for (const sourceSection of sections.values()) {
    const componentIds = [...registerComponents.values()].filter((component) => sectionReferences(component.consumingSpecs).includes(sourceSection.section)).map((component) => component.id).sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));
    sourceSection.componentIds = componentIds;
    if (componentIds.length === 0) addFinding({ code: "SECTION_UNMAPPED", section: sourceSection.section, memberName: null, sourceLine: sourceSection.sourceLine, componentId: null, registerSourceLine: null, detail: "No canonical D01–D66 consuming-spec row points to this Sources section" });
  }
  const contractLines = contractRaw.split(/\r?\n/);
  const supersessionIndex = contractLines.findIndex((line) => line.includes("Composio") && line.includes("Dropped") && line.includes("toy new connector"));
  const supersessionText = contractLines[supersessionIndex] ?? null;
  const supersessionLine = supersessionIndex < 0 ? null : supersessionIndex + 1;
  const supersessionDigest = supersessionText === null ? null : hash(supersessionText);
  if (supersessionLine === null || supersessionDigest === null) addFinding({ code: "SUPERSESSION_DECISION_MISSING", section: null, memberName: "Composio", sourceLine: null, componentId: "D66", registerSourceLine: registerComponents.get("D66")?.sourceLine ?? null, detail: "Authoritative CONTRACTS.md local-connectors amendment was not found" });
  const members: ResearchCatalogMemberV1[] = [];
  for (const component of registerComponents.values()) {
    const references = sectionsByComponent.get(component.id) ?? [];
    for (const sectionId of references) {
      const sourceSection = sections.get(sectionId);
      if (!sourceSection) continue;
      const sourceText = sourceSection.bodyLines[0]?.text ?? "";
      members.push({ section: sectionId, memberKind: "canonical_component", memberName: registerDisplayName(component), sourceLine: sourceSection.sourceLine, sourceText, sourceDigest: hash(sourceText), componentId: component.id, registerSourceLine: component.sourceLine, registerRowDigest: component.rowDigest, relationship: "canonical_consuming_spec", routeState: componentRouteState(component.id), routeEvidence: component.id === "D66" ? supersessionText ?? "Authoritative supersession evidence missing" : component.releaseGate, activationVerified: false });
    }
  }
  let longTailRowsMapped = true;
  for (const sectionId of ["9.26", "9.46", "9.47"]) {
    const section = sections.get(sectionId);
    if (!section) { longTailRowsMapped = false; continue; }
    const aliases = catalogMemberCrosswalk.get(sectionId);
    const actualRows = tableMemberRows(section);
    const actualLabels = new Set(actualRows.map((row) => row.label.toLowerCase()));
    for (const expectedLabel of aliases?.keys() ?? []) {
      if (actualLabels.has(expectedLabel)) continue;
      longTailRowsMapped = false;
      addFinding({ code: "LONG_TAIL_MEMBER_UNMAPPED", section: sectionId, memberName: expectedLabel, sourceLine: section.sourceLine, componentId: null, registerSourceLine: null, detail: "Canonical audit crosswalk label no longer matches a catalog table row" });
    }
    for (const row of actualRows) {
      const entries = aliases?.get(row.label.toLowerCase());
      if (!entries) {
        longTailRowsMapped = false;
        members.push({ section: sectionId, memberKind: "named_provider", memberName: row.label, sourceLine: row.sourceLine, sourceText: row.sourceText, sourceDigest: hash(row.sourceText), componentId: null, registerSourceLine: null, registerRowDigest: null, relationship: "unmapped", routeState: "unselected", routeEvidence: "No canonical component crosswalk covers this catalog table member", activationVerified: false });
        addFinding({ code: "LONG_TAIL_MEMBER_UNMAPPED", section: sectionId, memberName: row.label, sourceLine: row.sourceLine, componentId: null, registerSourceLine: null, detail: "Named Sources catalog table member has no D01–D66 crosswalk" });
        continue;
      }
      for (const entry of entries) {
        const component = registerComponents.get(entry.componentId);
        const matched = component !== undefined && normalizedWords(component.componentAndPin).includes(normalizedWords(entry.registerTerm));
        if (!component) {
          longTailRowsMapped = false;
          addFinding({ code: "LONG_TAIL_MEMBER_UNMAPPED", section: sectionId, memberName: entry.memberName, sourceLine: row.sourceLine, componentId: entry.componentId, registerSourceLine: null, detail: "Crosswalk component does not exist in canonical register" });
        } else if (!matched) {
          addFinding({ code: "CATALOG_MEMBER_DETAIL_OPEN", section: sectionId, memberName: entry.memberName, sourceLine: row.sourceLine, componentId: component.id, registerSourceLine: component.sourceLine, detail: "Catalog category is mapped to its section component, but that register description does not name the member independently" });
        }
        members.push({ section: sectionId, memberKind: "named_provider", memberName: entry.memberName, sourceLine: row.sourceLine, sourceText: row.sourceText, sourceDigest: hash(row.sourceText), componentId: component?.id ?? null, registerSourceLine: component?.sourceLine ?? null, registerRowDigest: component?.rowDigest ?? null, relationship: sectionId === "9.26" && ["D05", "D44"].includes(entry.componentId) ? "canonical_cross_reference" : "explicit_catalog_crosswalk", routeState: entry.routeState, routeEvidence: component?.releaseGate ?? "No canonical register release gate", activationVerified: false });
      }
    }
  }
  const composioMentions = sections.get("9.46")?.bodyLines.filter((line) => /\bComposio\b/.test(line.text)) ?? [];
  const composioComponent = registerComponents.get("D66");
  for (const mention of composioMentions) members.push({ section: "9.46", memberKind: "named_provider", memberName: "Composio legacy-adapter mention", sourceLine: mention.lineNumber, sourceText: mention.text, sourceDigest: hash(mention.text), componentId: composioComponent?.id ?? "D66", registerSourceLine: composioComponent?.sourceLine ?? null, registerRowDigest: composioComponent?.rowDigest ?? null, relationship: "superseded_catalog_reference", routeState: "superseded", routeEvidence: supersessionText ?? "Authoritative supersession evidence missing", activationVerified: false });
  if (composioMentions.length === 0) addFinding({ code: "SUPERSESSION_DECISION_MISSING", section: "9.46", memberName: "Composio", sourceLine: sections.get("9.46")?.sourceLine ?? null, componentId: "D66", registerSourceLine: composioComponent?.sourceLine ?? null, detail: "Expected legacy Composio cross-reference was not found in §9.46" });
  if (supersessionLine !== null && composioComponent && /conditional/i.test(composioComponent.releaseGate)) addFinding({ code: "SUPERSESSION_REGISTER_CONFLICT", section: "9.48", memberName: "Composio", sourceLine: sections.get("9.48")?.sourceLine ?? null, componentId: "D66", registerSourceLine: composioComponent.sourceLine, detail: "CONTRACTS.md line " + supersessionLine + " supersedes the D66 conditional release text; coverage reports D66 as superseded" });
  const sectionSetComplete = sections.size === 48 && Array.from({ length: 48 }, (_, index) => index + 1).every((number) => sections.has("9." + number));
  const everyRegisterSourceMaps = [...registerComponents.keys()].every((componentId) => (sectionsByComponent.get(componentId) ?? []).some((section) => sections.has(section)));
  const sectionMappingComplete = sectionSetComplete && everyRegisterSourceMaps && [...sections.values()].every((section) => section.componentIds.length > 0) && !coverageFindings.some((item) => ["SECTION_MISSING", "SECTION_DUPLICATE", "SECTION_UNMAPPED", "REGISTER_SECTION_MISSING"].includes(item.code));
  const expectedComponentsComplete = Array.from({ length: 66 }, (_, index) => "D" + String(index + 1).padStart(2, "0")).every((componentId) => registerComponents.has(componentId));
  const representedComponents = new Set(members.filter((member) => member.memberKind === "canonical_component").map((member) => member.componentId));
  const everyComponentHasCatalogMember = [...registerComponents.keys()].every((componentId) => representedComponents.has(componentId));
  const memberMappingComplete = expectedComponentsComplete && registerComponents.size === 66 && everyComponentHasCatalogMember && longTailRowsMapped && !coverageFindings.some((item) => ["LONG_TAIL_MEMBER_UNMAPPED", "REGISTER_COMPONENT_OUT_OF_RANGE"].includes(item.code));
  const registerRouteConsistent = !coverageFindings.some((item) => ["SUPERSESSION_REGISTER_CONFLICT", "SUPERSESSION_DECISION_MISSING"].includes(item.code));
  return researchCatalogCoverageSchema.parse({ catalogPath, catalogDigest: hash(catalogRaw), contractPath, contractDigest: hash(contractRaw), supersessionLine, supersessionText, supersessionDigest, sections: [...sections.values()].map(section => ({ section: section.section, sourceLine: section.sourceLine, title: section.title, sectionDigest: section.sectionDigest, componentIds: section.componentIds })).sort((left, right) => Number(left.section.slice(2)) - Number(right.section.slice(2))), members, findings: coverageFindings, sectionMappingComplete, memberMappingComplete, registerRouteConsistent, activationVerified: false });
};
const compareComponent = (input: ResearchComponentComparisonV1): ResearchComponentComparisonCheckV1 => {
  researchComponentComparisonSchema.parse(input);
  const findings: ResearchComponentComparisonCheckV1["findings"] = [];
  const add = (code: ResearchComponentComparisonCheckV1["findings"][number]): void => { if (!findings.includes(code)) findings.push(code); };
  const options = new Map(input.options.map(option => [option.id, option]));
  const evidence = new Map(input.evidence.map(source => [source.id, source]));
  if (options.size !== input.options.length || evidence.size !== input.evidence.length) add("DUPLICATE_REFERENCE");
  if (!["0.1", "0.2", "0.10"].every(id => input.mappedRequirements.includes(id))) add("MAPPED_REQUIREMENTS_MISSING");
  for (const example of ["sqlite", "postgres-pg-boss", "hermes-one-shot-cron"] as const) {
    if (!input.options.some(option => option.example === example)) add("REQUIRED_OPTIONS_MISSING");
  }
  if (!input.options.some(option => option.example === null && option.viable && option.support === "proven")) add("OUTSIDE_OPTION_MISSING");
  for (const option of input.options) {
    if (!option.reliability.trim() || !option.maintenance.trim() || !option.resources.trim()) add("TRADEOFFS_MISSING");
    if (option.support !== "proven") continue;
    if (option.primaryEvidenceIds.length === 0 || option.primaryEvidenceIds.some(id => {
      const source = evidence.get(id);
      return !source || source.kind !== "primary" || !source.supportedOptionIds.includes(option.id);
    })) add("PRIMARY_EVIDENCE_MISSING");
  }
  const selected = options.get(input.selectedOptionId);
  if (!selected || !selected.viable || selected.support !== "proven") add("CHOICE_UNSUPPORTED");
  const acceptance = acceptanceIndexSchema.parse(JSON.parse(read("tests/acceptance-index.json"))).acceptance;
  if (input.acceptanceIds.length === 0 || input.acceptanceIds.some(id => !acceptance.some(entry => entry.id === id && entry.source === "specs/obligations.md"))) add("ACCEPTANCE_LINK_MISSING");
  if (!input.validationPlan.trim()) add("VALIDATION_PLAN_MISSING");
  if (input.unresolvedFacts.some(fact => fact.optionId === null || fact.optionId === input.selectedOptionId)) add("SELECTED_FACT_UNRESOLVED");
  return researchComponentComparisonCheckSchema.parse({ componentId: input.componentId, comparisonDigest: hash(JSON.stringify(input)), state: findings.length ? "BLOCKED" : "PASS", findings, selectedTool: selected?.tool ?? null, validationPlan: input.validationPlan, unresolvedFacts: input.unresolvedFacts, scope: "component_comparison", researchAttestationVerified: false, acceptanceComplete: false });
};
const inspectComponentComparisons = (reports: ResearchRegisterInspectionV1["reports"], components: ResearchRegisterInspectionV1["components"], findings: ResearchInspectionFindingV1[], documents: ReadonlyMap<string, ResearchDocumentOverlayV1>): ResearchComponentComparisonCheckV1[] => {
  const comparisons = new Map<string, ResearchComponentComparisonCheckV1>();
  for (const report of reports) {
    if (report.digest === null) continue;
    const original = readResearchFile(report.path);
    if (hash(original) !== report.originalDigest) throw new Error("RESEARCH_REPORT_CHANGED");
    const raw = documents.get(report.key)?.markdown ?? original;
    if (hash(raw) !== report.digest) throw new Error("RESEARCH_DOCUMENT_CHANGED");
    for (const match of raw.matchAll(/^```ResearchComponentComparisonV1\r?\n([\s\S]*?)^```[ \t]*$/gm)) {
      const sourceLine = raw.slice(0, match.index).split(/\r?\n/).length;
      try {
        const input = researchComponentComparisonSchema.parse(JSON.parse(match[1] ?? ""));
        const component = components.find(row => row.id === input.componentId && row.reportKeys.includes(report.key));
        if (!component || comparisons.has(input.componentId)) throw new Error("COMPARISON_BINDING_INVALID");
        const result = compareComponent(input);
        comparisons.set(input.componentId, result);
        if (result.state !== "PASS") findings.push({ componentId: input.componentId, code: "COMPONENT_COMPARISON_BLOCKED", sourceLine, sourcePath: report.path });
      } catch { findings.push({ componentId: null, code: "COMPONENT_COMPARISON_INVALID", sourceLine, sourcePath: report.path }); }
    }
  }
  for (const component of components.filter(row => ["A08", "A09", "M02"].includes(row.id))) {
    if (!comparisons.has(component.id)) findings.push({ componentId: component.id, code: "COMPONENT_COMPARISON_MISSING", sourceLine: component.sourceLine });
  }
  return [...comparisons.values()];
};
const inspectComponentDecisions = (reports: ResearchRegisterInspectionV1["reports"], components: ResearchRegisterInspectionV1["components"], findings: ResearchInspectionFindingV1[], documents: ReadonlyMap<string, ResearchDocumentOverlayV1>, requirementIds: readonly string[], release: string): ResearchComponentComparisonCheckV2[] => {
  const decisions = new Map<string, ResearchComponentComparisonV2 | ResearchSourcesComponentComparisonV1>();
  for (const report of reports) {
    if (report.digest === null) continue;
    const original = readResearchFile(report.path);
    const raw = documents.get(report.key)?.markdown ?? original;
    if (hash(original) !== report.originalDigest || hash(raw) !== report.digest) throw new Error("RESEARCH_DOCUMENT_CHANGED");
    for (const match of raw.matchAll(/^```(ResearchComponentComparisonV2|ResearchSourcesComponentComparisonV1)\r?\n([\s\S]*?)^```[ \t]*$/gm)) {
      const sourceLine = raw.slice(0, match.index).split(/\r?\n/).length;
      try {
        const schema = match[1] === "ResearchSourcesComponentComparisonV1" ? researchSourcesComponentComparisonSchema : researchComponentComparisonV2Schema;
        const record = schema.parse(JSON.parse(match[2] ?? ""));
        if (!components.some(component => component.id === record.componentId && component.reportKeys.includes(report.key)) || decisions.has(record.componentId)) throw new Error("COMPARISON_BINDING_INVALID");
        decisions.set(record.componentId, record);
      } catch { findings.push({ componentId: null, code: "COMPONENT_COMPARISON_INVALID", sourceLine, sourcePath: report.path }); }
    }
  }
  const acceptance = acceptanceIndexSchema.parse(JSON.parse(read("tests/acceptance-index.json"))).acceptance;
  const acceptanceIds = new Set(acceptance.map(entry => entry.id));
  return components.map(component => {
    const record = decisions.get(component.id);
    const codes: ResearchComponentComparisonCheckV2["findings"] = [];
    const add = (code: ResearchComponentComparisonCheckV2["findings"][number]): void => { if (!codes.includes(code)) codes.push(code); };
    const validationId = "G0:" + release + ":" + component.id;
    const options = new Map(record?.options.map(option => [option.id, option]) ?? []);
    const sources = new Map(record?.evidence.map(source => [source.id, source]) ?? []);
    const selected = record ? options.get(record.selectedOptionId) : undefined;
    const sourceSupports = (id: string, optionId: string): boolean => {
      const source = sources.get(id);
      return source?.kind === "primary" && source.supportedOptionIds.includes(optionId);
    };
    const sourcesComponent = component.id.startsWith("D");
    const expectedRequirements = sourcesComponent ? [...new Set([...requirementIds, "0.9"])] : requirementIds;
    const missingRequirementIds = expectedRequirements.filter(id => !record?.mappedRequirements.includes(id));
    const missingSourceIds = new Set(component.reportKeys.filter(id => !selected || !sourceSupports(id, selected.id)));
    if (component.reportKeys.length === 0) missingSourceIds.add("REGISTER:" + component.id);
    const missingValidationIds = new Set<string>();
    if (sourcesComponent) {
      if (record?.scope !== "sources-component" || !record.accountValidationPlan.trim()) missingValidationIds.add("ACCOUNT:" + release + ":" + component.id);
      if (record?.scope !== "sources-component" || !record.regionValidationPlan.trim()) missingValidationIds.add("REGION:" + release + ":" + component.id);
      if (missingValidationIds.size) add("VALIDATION_PLAN_MISSING");
    }
    if (!record) add("DECISION_MISSING");
    if (missingRequirementIds.length) add("MAPPED_REQUIREMENTS_MISSING");
    if (!record || options.size < 2) add("REQUIRED_OPTIONS_MISSING");
    if (!selected || !selected.viable || selected.support !== "proven") add("CHOICE_UNSUPPORTED");
    for (const option of record?.options ?? []) {
      if (!option.reliability.trim() || !option.maintenance.trim() || !option.resources.trim()) add("TRADEOFFS_MISSING");
      if (option.support !== "proven") continue;
      if (option.primaryEvidenceIds.length === 0) add("PRIMARY_EVIDENCE_MISSING");
      for (const id of option.primaryEvidenceIds) if (!sourceSupports(id, option.id)) missingSourceIds.add(id);
    }
    if (missingSourceIds.size) add("PRIMARY_EVIDENCE_MISSING");
    if (!record || record.releaseGate !== component.releaseGate || !/\[R[0-5]\b/.test(record.releaseGate)) add("RELEASE_GATE_MISSING");
    if (!record?.validationPlan.trim()) add("VALIDATION_PLAN_MISSING");
    const validation = record?.validations.find(entry => entry.id === validationId);
    if (!validation || validation.support !== "proven" || validation.sourceIds.length === 0 || validation.testIds.length === 0) missingValidationIds.add(validationId);
    for (const id of validation?.sourceIds ?? []) if (!selected || !sourceSupports(id, selected.id)) { missingSourceIds.add(id); missingValidationIds.add(validationId); }
    for (const id of validation?.testIds ?? []) if (!acceptanceIds.has(id) || !record?.acceptanceIds.includes(id)) { missingValidationIds.add(id); missingValidationIds.add(validationId); }
    if (!record?.acceptanceIds.length || record.acceptanceIds.some(id => !acceptanceIds.has(id))) add("ACCEPTANCE_LINK_MISSING");
    if (missingValidationIds.size) add("VALIDATION_ID_MISSING");
    if (missingSourceIds.size) add("PRIMARY_EVIDENCE_MISSING");
    if (record && (options.size !== record.options.length || sources.size !== record.evidence.length || new Set(record.validations.map(entry => entry.id)).size !== record.validations.length)) add("DUPLICATE_REFERENCE");
    if (record?.unresolvedFacts.some(fact => fact.optionId === null || fact.optionId === record.selectedOptionId)) add("SELECTED_FACT_UNRESOLVED");
    if (codes.length) findings.push({ componentId: component.id, code: record ? "COMPONENT_COMPARISON_BLOCKED" : "COMPONENT_COMPARISON_MISSING", sourceLine: component.sourceLine });
    return researchComponentComparisonCheckV2Schema.parse({ componentId: component.id, comparisonDigest: record ? hash(JSON.stringify(record)) : null, state: codes.length ? "BLOCKED" : "PASS", findings: codes, selectedOptionId: record?.selectedOptionId ?? null, selectedTool: selected?.tool ?? null, validationPlan: record?.validationPlan ?? "", unresolvedFacts: record?.unresolvedFacts ?? [], missingRequirementIds, missingSourceIds: [...missingSourceIds], missingValidationIds: [...missingValidationIds], scope: "component_comparison", researchAttestationVerified: false, acceptanceComplete: false });
  });
};
const inspectResearch = (input: MapCheckInputV1, testDocuments: readonly ResearchDocumentOverlayV1[]): ResearchRegisterInspectionV2 => {
  const documents = new Map(testDocuments.map(document => [document.reportKey, document]));
  if (documents.size !== testDocuments.length) throw new Error("RESEARCH_DOCUMENT_DUPLICATE");
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
    let originalDigest: string | null = null;
    try { originalDigest = hash(readResearchFile(path)); } catch { originalDigest = null; }
    const document = documents.get(key);
    if (document && (document.originalDigest !== originalDigest || document.contentDigest !== hash(document.markdown))) throw new Error("RESEARCH_DOCUMENT_BINDING_INVALID");
    reports.push({ key, path, listedSections, digest: document?.contentDigest ?? originalDigest, originalDigest, origin: document ? "seeded_document" : "planning_archive" });
  }
  if (reports.length === 0) throw new Error("REGISTER_REPORTS_MISSING");
  if ([...documents.keys()].some(key => !reportKeys.has(key))) throw new Error("RESEARCH_DOCUMENT_KEY_UNKNOWN");
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
  const componentComparisons = inspectComponentComparisons(reports, components, findings, documents);
  const specReferences = inspectResearchSpecs(components, findings);
  const sourcesCatalogCoverage = inspectSourcesCatalog(components);
  const globalMapping = /README maps ([^\n]+?) to all specs/.exec(raw)?.[1];
  const requirementIds = [...new Set(globalMapping?.match(/\b[0-9]+\.[0-9]+\b/g) ?? [])];
  if (requirementIds.length === 0) throw new Error("REGISTER_GLOBAL_REQUIREMENTS_MISSING");
  const componentDecisions = inspectComponentDecisions(reports, components, findings, documents, requirementIds, input.release ?? "R0");
  return researchRegisterInspectionV2Schema.parse({ componentDecisions, requestedRelease: input.release, registerPath, registerDigest: hash(raw), components, componentComparisons, reports, specReferences, sourcesCatalogCoverage, dependencyClosureVerified: false, findings, wholeATsPassed: [], scope: "register_inventory", admission: "BLOCKED", acceptanceComplete: false });
};

export const EngineeringControl = {
  checkResearch(input: MapCheckInputV1, context: OpsControlContextV1, testDocuments: readonly ResearchDocumentOverlayV1[] = []): Result<ResearchRegisterInspectionV2> {
    if (!mapCheckInputSchema.safeParse(input).success || !opsControlContextSchema.safeParse(context).success || testDocuments.length > 100 || testDocuments.some(document => !researchDocumentOverlaySchema.safeParse(document).success)) return refused("INVALID_INPUT");
    if (testDocuments.length > 0) {
      const owned = OpsTestStack.inspect(context);
      if (!owned.ok) return owned;
    }
    try { return { ok: true, data: inspectResearch(input, testDocuments) }; } catch { return refused("ARTIFACT_MISMATCH"); }
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
      const accountingMigration = input.kind === "migration" && input.owner === "self-improvement" && input.name === "model-admission";
      const capacityMigration = input.kind === "migration" && input.owner === "self-improvement" && input.name === "capacity-trial";
      const postgresMigration = accountingMigration || capacityMigration;
      if (input.kind === "connector" && (input.owner !== "sources" || input.provider !== "toy-k4a-empty") || input.kind === "tool" && (input.owner !== "ops" || input.operation !== "OpsControlRead.status") || input.kind === "skill" && input.owner !== "self-improvement" || input.kind === "migration" && input.owner !== "ops" && !postgresMigration) return refused("DEPENDENCY_UNAVAILABLE");
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
        target = `packages/${input.owner}/migrations/${input.name}.sql`;
        content = capacityMigration ? capacityTrialMigration : accountingMigration ? modelAdmissionMigration : source.replaceAll("k4a_reference_marker", input.name.replaceAll("-", "_") + "_marker").replaceAll("R0.K4a", featureId);
        const descriptor = postgresMigration
          ? { migration_id: featureId, owner: input.owner, dialect: "postgresql", target_database: "toy", target_schema: "toy_si", target_tables: capacityMigration ? ["capacity_trial_arm", "cadence_slot"] : ["budget_group", "model_call", "quota_snapshot"], source_path: target, source_sha256: hash(content), transactional: true, disposable_only: true, production_allowed: false, automatic_rollback: false, runtime_verified: false }
          : { migration_id: featureId, owner: "ops", dialect: "sqlite", target_database: "private_disposable_sqlite_world", target_schema: "main", target_table: input.name.replaceAll("-", "_") + "_marker", source_path: target, source_sha256: hash(content), transactional: true, disposable_only: true, production_allowed: false, automatic_rollback: false };
        patches.push(patch(`packages/${input.owner}/migrations/${input.name}.json`, JSON.stringify(descriptor, null, 2) + "\n"));
      }
      if (existsSync(safePath(target)) || patches.some((item) => item.kind === "update" && item.path !== "packages/sources/src/public.ts" && item.path !== "packages/self-improvement/src/public.ts")) return refused("CONFLICT");
      patches.unshift(patch(target, content));
      facts.features.push({ id: featureId, description: "Generated feasibility-only " + input.kind + "; production activation remains pending assigned owner acceptance", implementation: "specified", requirementIds: postgresMigration ? ["spec:ops", "spec:self-improvement"] : ["0.17"], entry: target, owner: input.owner, publicInterface: input.kind === "connector" ? "SourceAdapterR0" : input.kind === "tool" ? "OpsControlRead.status" : input.kind === "skill" ? "EngineeringControl.generate" : capacityMigration ? "CapacityTrialJournal migrations" : accountingMigration ? "ModelAdmission migrations" : "Ops migrations", paths: patches.map((item) => item.path), firstRelease: "R0", commands: ["new." + input.kind], atIds: capacityMigration ? ["AT-hermes-config-101", "AT-cli-25", "AT-ops-47"] : accountingMigration ? ["AT-hermes-config-101", "AT-cli-25", "AT-ops-51"] : ["AT-hermes-config-101", "AT-cli-25"] });
      const beforeInventoryDigest = hash(read(factsPath));
      const afterFacts = JSON.stringify(facts, null, 2) + "\n";
      const indexRaw = read("tests/acceptance-index.json");
      patches.push(patch(factsPath, afterFacts));
      patches.push(patch(mapPath, render(facts, hash(JSON.stringify([hash(afterFacts), hash(indexRaw), cliDeclarations])))));
      if (!input.plan) apply(patches);
      return { ok: true, data: generatorPlanSchema.parse({ kind: input.kind, name: input.name, owner: input.owner, templateDigest: hash(capacityMigration ? capacityTrialMigration : accountingMigration ? modelAdmissionMigration : source), patches, featureIds: [featureId], requiredAtIds: capacityMigration ? ["AT-hermes-config-101", "AT-cli-25", "AT-ops-47"] : accountingMigration ? ["AT-hermes-config-101", "AT-cli-25", "AT-ops-51"] : ["AT-hermes-config-101", "AT-cli-25"], prerequisites: [postgresMigration ? "Canonical PostgreSQL schema is source preparation only; real database execution, owner role grants and assigned owner runtime acceptance remain pending" : "Full runtime acceptance remains assigned to R1; generated output does not activate production"], applied: !input.plan, beforeInventoryDigest, afterInventoryDigest: hash(afterFacts) }) };
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
