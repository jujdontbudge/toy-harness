import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkViewSchema, opsErrorMessages, registeredCliAcceptanceManifestInventory, researchComponentComparisonSchema, researchComponentComparisonV2Schema, researchComponentComparisonV4Schema, researchSourcesComponentComparisonSchema, researchSourcesComponentComparisonV2Schema, modelRouteDelegationReceiptSchema, researchSkillPinSchema } from "@toy/contracts";
import type { CheckViewV1, OpsControlContextV1, RegisteredProbeInputV1, RegisteredProbeOperationV1, ResearchComponentComparisonV1, ResearchComponentComparisonV4, ResearchDocumentOverlayV1, ResearchRegisterInspectionV3, ResearchComponentInspectionV1, Result } from "@toy/contracts";
import { TestProbeControl, trustedCheckoutRoot } from "@toy/ops/public";
import { EngineeringControl } from "./engineering-control.js";

const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const completeReport = (): ResearchComponentComparisonV1 => researchComponentComparisonSchema.parse({
  scope: "obligations-scheduling", componentId: "M02", mappedRequirements: ["0.1", "0.2", "0.10"],
  options: [
    { id: "sqlite", tool: "SQLite ledger", example: "sqlite", viable: false, support: "proven", primaryEvidenceIds: ["sqlite-primary"], reliability: "Durable local transactions; shared worker boundary needs validation", maintenance: "Preserve the existing ledger through migration", resources: "One embedded database" },
    { id: "pg-boss", tool: "PostgreSQL + pg-boss", example: "postgres-pg-boss", viable: true, support: "proven", primaryEvidenceIds: ["pg-boss-primary"], reliability: "Validate domain and job rollback on one connection", maintenance: "Pin the shared database and queue schema", resources: "One shared PostgreSQL instance" },
    { id: "hermes-cron", tool: "Hermes one-shot cron", example: "hermes-one-shot-cron", viable: false, support: "proven", primaryEvidenceIds: ["hermes-primary"], reliability: "Compare missed-wake retirement with durable obligations", maintenance: "Reuse the pinned runtime", resources: "Existing Hermes process" },
    { id: "outside", tool: "Self-hosted workflow engine", example: null, viable: true, support: "proven", primaryEvidenceIds: ["outside-primary"], reliability: "Durable workflow execution with restart validation", maintenance: "Additional engine upgrades and operational ownership", resources: "Additional local services" }
  ],
  evidence: [
    { id: "sqlite-primary", url: "https://primary.example.test/sqlite", publisher: "Seeded primary SQLite report", kind: "primary", supportedOptionIds: ["sqlite"] },
    { id: "pg-boss-primary", url: "https://primary.example.test/pg-boss", publisher: "Seeded primary queue report", kind: "primary", supportedOptionIds: ["pg-boss"] },
    { id: "hermes-primary", url: "https://primary.example.test/hermes", publisher: "Seeded primary Hermes report", kind: "primary", supportedOptionIds: ["hermes-cron"] },
    { id: "outside-primary", url: "https://primary.example.test/outside", publisher: "Seeded primary independent report", kind: "primary", supportedOptionIds: ["outside"] }
  ],
  selectedOptionId: "pg-boss", unresolvedFacts: [], acceptanceIds: ["AT-obligations-74", "AT-obligations-76"],
  validationPlan: "Run the pinned shared-connection rollback, lost-claim fencing and generated-schema CLI fault probe before component admission."
});
export const componentComparisonProbe = (input: RegisteredProbeInputV1, context: OpsControlContextV1): Result<RegisteredProbeOperationV1> => {
  if (input.probeId === "AT-lifestore-45") return lifeStoreQuoteProbe(input, context);
  if (["AT-sources-188", "AT-sources-190"].includes(input.probeId)) return sourcesComponentProbe(input, context);
  if (input.probeId === "AT-self-improvement-54") return requiredComponentProbe(input, context);
  if (input.probeId === "AT-workflows-1") return workflowsPrerequisiteProbe(input, context);
  if (input.probeId !== "AT-obligations-74" || input.caseId !== undefined) return { ok: false, error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false } };
  const manifest = registeredCliAcceptanceManifestInventory.find(entry => entry.id === input.probeId);
  const cases = ["missing-primary-evidence", "unsupported-choice", "missing-acceptance-link", "complete-outside-comparison"];
  if (!manifest || manifest.scenarioId !== "research.component-comparison" || JSON.stringify(manifest.mandatoryCases.map(entry => entry.id)) !== JSON.stringify(cases)) return { ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } };
  const baseline = EngineeringControl.checkResearch({ release: "R0" }, context);
  if (!baseline.ok) return baseline;
  const indexedReport = baseline.data.reports.find(report => report.key === "TS" && report.originalDigest !== null);
  const indexedComponent = baseline.data.components.find(component => component.id === "M02" && component.reportKeys.includes("TS"));
  if (!indexedReport?.originalDigest || !indexedComponent) return { ok: false, error: { module: "ops", code: "ARTIFACT_MISMATCH", message: opsErrorMessages.ARTIFACT_MISMATCH, retryable: false } };
  const checks: CheckViewV1[] = [];
  for (const caseId of cases) {
    const report = completeReport();
    if (caseId === "missing-primary-evidence") report.evidence = report.evidence.filter(source => source.id !== "pg-boss-primary");
    if (caseId === "unsupported-choice") report.selectedOptionId = "uncompared-tool";
    if (caseId === "missing-acceptance-link") report.acceptanceIds = [];
    const markdown = "# Seeded external report\n\n## Scheduling, reminders, and follow-ups\n\n```ResearchComponentComparisonV1\n" + JSON.stringify(report) + "\n```\n";
    const inspection = EngineeringControl.checkResearch({ release: "R0" }, context, [{ reportKey: indexedReport.key, originalDigest: indexedReport.originalDigest, contentDigest: digest(markdown), markdown }]);
    if (!inspection.ok) return inspection;
    const observed = inspection.data.componentComparisons.find(comparison => comparison.componentId === indexedComponent.id);
    const archive = inspection.data.reports.find(entry => entry.key === indexedReport.key);
    if (!observed || !archive) return { ok: false, error: { module: "ops", code: "ARTIFACT_MISMATCH", message: opsErrorMessages.ARTIFACT_MISMATCH, retryable: false } };
    const expectedFinding = caseId === "missing-primary-evidence" ? "PRIMARY_EVIDENCE_MISSING" : caseId === "unsupported-choice" ? "CHOICE_UNSUPPORTED" : caseId === "missing-acceptance-link" ? "ACCEPTANCE_LINK_MISSING" : null;
    const passed = expectedFinding === null
      ? observed.state === "PASS" && observed.findings.length === 0 && observed.selectedTool === "PostgreSQL + pg-boss" && observed.validationPlan === report.validationPlan
      : observed.state === "BLOCKED" && observed.findings.includes(expectedFinding);
    const archiveBound = archive.path === indexedReport.path && archive.originalDigest === indexedReport.originalDigest && archive.digest === digest(markdown) && archive.origin === "seeded_document";
    checks.push(checkViewSchema.parse({
      id: "research.component-comparison", owner: "self-improvement", state: passed && archiveBound ? "PASS" : "FAIL", checkedAt: new Date().toISOString(), reasonCode: passed && archiveBound ? "COMPONENT_COMPARISON_DIAGNOSTIC_PASS" : "COMPONENT_COMPARISON_DIAGNOSTIC_FAIL",
      prerequisite: JSON.stringify({ caseId, externalResearch: "seeded_archived_report", actualUid: process.getuid?.() ?? null, archive: { key: archive.key, path: archive.path, originalDigest: archive.originalDigest, contentDigest: archive.digest, origin: archive.origin }, result: observed, registerAdmission: inspection.data.admission, liveProviderSends: 0, wholeATComplete: false }),
      nextCommandId: "probe.show", links: { recordRefs: [], observations: [], artifactDigests: [digest(markdown), digest(JSON.stringify(report)), digest(readFileSync(new URL("./component-comparison-probe.js", import.meta.url))), digest(readFileSync(new URL("./engineering-control.js", import.meta.url)))] }
    }));
  }
  return TestProbeControl.run(input, context, checks);
};
const workflowsPrerequisiteProbe = (input: RegisteredProbeInputV1, context: OpsControlContextV1): Result<RegisteredProbeOperationV1> => {
  if (input.caseId !== undefined) return { ok: false, error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false } };
  const cases = ["m11-incomplete-comparison"];
  const manifest = registeredCliAcceptanceManifestInventory.find(entry => entry.id === input.probeId);
  if (!manifest || manifest.scenarioId !== "research.component-comparison" || JSON.stringify(manifest.mandatoryCases.map(entry => entry.id)) !== JSON.stringify(cases)) return { ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } };
  const baseline = EngineeringControl.checkResearch({ release: "R0" }, context);
  if (!baseline.ok) return baseline;
  const component = baseline.data.components.find(entry => entry.id === "M11");
  const absent = baseline.data.componentDecisions.find(entry => entry.componentId === "M11");
  const planningArchive = baseline.data.reports.find(entry => entry.key === "PF");
  const outcomeArchive = baseline.data.reports.find(entry => entry.key === "AF");
  const reportKeys = ["PF", "AF"];
  if (!component || !absent || absent.comparisonDigest !== null || component.reportKeys.length !== reportKeys.length || !reportKeys.every(key => component.reportKeys.includes(key)) || !planningArchive?.originalDigest || !planningArchive.digest || !outcomeArchive?.originalDigest || !outcomeArchive.digest) return { ok: false, error: { module: "ops", code: "ARTIFACT_MISMATCH", message: opsErrorMessages.ARTIFACT_MISMATCH, retryable: false } };
  const template = completeReport();
  const report = researchComponentComparisonV2Schema.parse({
    ...template,
    scope: "required-component",
    componentId: component.id,
    mappedRequirements: absent.missingRequirementIds,
    options: [{ id: "workflow-option", tool: "Unspecified workflow option", example: "unspecified", viable: true, support: "proven", primaryEvidenceIds: [], reliability: "", maintenance: "", resources: "" }],
    evidence: [],
    selectedOptionId: "workflow-option",
    unresolvedFacts: [],
    acceptanceIds: ["AT-workflows-1"],
    validationPlan: "",
    releaseGate: component.releaseGate,
    validations: []
  });
  const markdown = "# Seeded M11 workflow prerequisite report\n\n```ResearchComponentComparisonV2\n" + JSON.stringify(report) + "\n```\n";
  const contentDigest = digest(markdown);
  const inspection = EngineeringControl.checkResearch({ release: "R0" }, context, [{ reportKey: planningArchive.key, originalDigest: planningArchive.originalDigest, contentDigest, markdown }]);
  if (!inspection.ok) return inspection;
  const observed = inspection.data.componentDecisions.find(entry => entry.componentId === "M11");
  const inspectedComponent = inspection.data.components.find(entry => entry.id === "M11");
  const inspectedPlanningArchive = inspection.data.reports.find(entry => entry.key === "PF");
  const inspectedOutcomeArchive = inspection.data.reports.find(entry => entry.key === "AF");
  if (!observed || !inspectedComponent || !inspectedPlanningArchive || !inspectedOutcomeArchive) return { ok: false, error: { module: "ops", code: "ARTIFACT_MISMATCH", message: opsErrorMessages.ARTIFACT_MISMATCH, retryable: false } };
  const expectedFindings = ["REQUIRED_OPTIONS_MISSING", "PRIMARY_EVIDENCE_MISSING", "TRADEOFFS_MISSING", "VALIDATION_PLAN_MISSING", "VALIDATION_ID_MISSING"];
  const exact = (actual: readonly string[], expected: readonly string[]): boolean => JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
  const registerBlocked = inspection.data.admission === "BLOCKED" && inspection.data.findings.some(finding => finding.componentId === "M11" && finding.code === "COMPONENT_COMPARISON_BLOCKED");
  const archiveBound = inspectedComponent.reportKeys.length === reportKeys.length && reportKeys.every(key => inspectedComponent.reportKeys.includes(key))
    && inspectedPlanningArchive.path === planningArchive.path && inspectedPlanningArchive.originalDigest === planningArchive.originalDigest && inspectedPlanningArchive.digest === contentDigest && inspectedPlanningArchive.origin === "seeded_document"
    && inspectedOutcomeArchive.path === outcomeArchive.path && inspectedOutcomeArchive.originalDigest === outcomeArchive.originalDigest && inspectedOutcomeArchive.digest === outcomeArchive.digest && inspectedOutcomeArchive.origin === "planning_archive";
  const passed = observed.state === "BLOCKED" && exact(observed.findings, expectedFindings) && observed.missingRequirementIds.length === 0
    && exact(observed.missingSourceIds, reportKeys) && exact(observed.missingValidationIds, ["G0:R0:M11"])
    && observed.comparisonDigest === digest(JSON.stringify(report)) && registerBlocked && archiveBound;
  const prerequisite = JSON.stringify({
    caseId: cases[0],
    actualUid: process.getuid?.() ?? null,
    register: { path: inspection.data.registerPath, digest: inspection.data.registerDigest, component: { id: inspectedComponent.id, sourceLine: inspectedComponent.sourceLine, rowDigest: inspectedComponent.rowDigest, reportKeys: inspectedComponent.reportKeys }, admission: inspection.data.admission },
    decision: { componentId: observed.componentId, state: observed.state, findings: observed.findings, missingRequirementIds: observed.missingRequirementIds, missingSourceIds: observed.missingSourceIds, missingValidationIds: observed.missingValidationIds },
    archives: [
      { key: inspectedPlanningArchive.key, path: inspectedPlanningArchive.path, originalDigest: inspectedPlanningArchive.originalDigest, contentDigest: inspectedPlanningArchive.digest, origin: inspectedPlanningArchive.origin },
      { key: inspectedOutcomeArchive.key, path: inspectedOutcomeArchive.path, originalDigest: inspectedOutcomeArchive.originalDigest, contentDigest: inspectedOutcomeArchive.digest, origin: inspectedOutcomeArchive.origin }
    ],
    registerBlocked,
    liveProviderSends: 0,
    candidateWriteReadOnlyInputsProven: false,
    atWorkflows2Proven: false,
    protectedAuthenticatedProof: false,
    wholeATComplete: false
  });
  const bounded = Buffer.byteLength(prerequisite, "utf8") < 2000;
  const state = passed && bounded ? "PASS" : "FAIL";
  return TestProbeControl.run(input, context, [checkViewSchema.parse({
    id: "research.component-comparison", owner: "self-improvement", state, checkedAt: new Date().toISOString(), reasonCode: state === "PASS" ? "WORKFLOW_M11_PREREQUISITE_PASS" : "WORKFLOW_M11_PREREQUISITE_FAIL",
    prerequisite, nextCommandId: "probe.show", links: { recordRefs: [], observations: [], artifactDigests: [digest(markdown), digest(JSON.stringify(report)), digest(readFileSync(new URL("./component-comparison-probe.js", import.meta.url))), digest(readFileSync(new URL("./engineering-control.js", import.meta.url)))] }
  })]);
};
const lifeStoreCases = ["positive-all-required-quotes", "missing-component", "missing-requirement-quote", "unsupported-choice", "missing-version", "wrong-version", "wrong-digest", "wrong-primary-quote", "wrong-requirement-quote", "missing-validation"] as const;
type LifeStoreReport = ResearchRegisterInspectionV3["reports"][number];
const lifeStoreError = (): Result<RegisteredProbeOperationV1> => ({ ok: false, error: { module: "ops", code: "ARTIFACT_MISMATCH", message: opsErrorMessages.ARTIFACT_MISMATCH, retryable: false } });
const lifeStoreRecord = (component: ResearchComponentInspectionV1, mappedRequirements: readonly string[], requirementQuotes: ResearchComponentComparisonV4["requirementQuotes"]): ResearchComponentComparisonV4 => {
  const sourceIds = component.reportKeys.length > 0 ? component.reportKeys : ["fixture-primary:" + component.id];
  const evidence = sourceIds.map(id => ({ id, url: "https://fixture.invalid/" + id, publisher: "Seeded external primary report", kind: "primary" as const, supportedOptionIds: ["postgres", "outside"] }));
  const sourceContentParts = ["version: v1\n"];
  const quotes: ResearchComponentComparisonV4["primarySource"]["quotes"] = [];
  let byteLength = Buffer.byteLength(sourceContentParts[0] ?? "", "utf8");
  for (const id of sourceIds) {
    const quote = "Seeded primary evidence for " + component.id + " from " + id + ".";
    const prefix = id + ": ";
    const byteStart = byteLength + Buffer.byteLength(prefix, "utf8");
    const byteEnd = byteStart + Buffer.byteLength(quote, "utf8");
    sourceContentParts.push(prefix + quote + "\n");
    quotes.push({ evidenceId: id, quote, byteStart, byteEnd });
    byteLength += Buffer.byteLength(prefix + quote + "\n", "utf8");
  }
  const sourceContent = sourceContentParts.join("");
  const sourceBytes = Buffer.from(sourceContent, "utf8");
  return researchComponentComparisonV4Schema.parse({
    scope: "required-research-component", componentId: component.id, mappedRequirements: [...mappedRequirements],
    options: [
      { id: "postgres", tool: "PostgreSQL-backed fixture option", example: "postgres-pg-boss", viable: true, support: "proven", primaryEvidenceIds: sourceIds, reliability: "Validate the source revision against an independent readback.", maintenance: "Keep this seeded fixture outside live provider routes.", resources: "Use the existing local evidence adapter." },
      { id: "outside", tool: "Independent local fixture option", example: null, viable: true, support: "proven", primaryEvidenceIds: sourceIds, reliability: "Compare an independent local source path.", maintenance: "Keep its fixture separate from the selected option.", resources: "Reuse the current fake external-document seam." }
    ],
    evidence, selectedOptionId: "outside", unresolvedFacts: [], acceptanceIds: ["AT-lifestore-45"],
    validationPlan: "Compare the complete source and requirement quote readback through EngineeringControl.checkResearch.", releaseGate: component.releaseGate,
    validations: [{ id: "G0:R0:" + component.id, support: "proven", sourceIds, testIds: ["AT-lifestore-45"] }],
    executionReceipt: null,
    primarySource: { sourceVersion: "v1", sourceDigest: digest(sourceBytes), sourceContent, versionByteStart: Buffer.byteLength("version: ", "utf8"), versionByteEnd: Buffer.byteLength("version: v1", "utf8"), quotes },
    requirementQuotes: [...requirementQuotes]
  });
};
const lifeStoreDocuments = (reports: readonly LifeStoreReport[], components: readonly ResearchComponentInspectionV1[], records: ReadonlyMap<string, ResearchComponentComparisonV4>, omittedComponentId?: string): ResearchDocumentOverlayV1[] => {
  const archived = reports.filter((report): report is LifeStoreReport & { originalDigest: string } => report.originalDigest !== null);
  const recordsByReport = new Map<string, ResearchComponentComparisonV4[]>();
  for (const report of archived) recordsByReport.set(report.key, []);
  for (const component of components) {
    if (component.id === omittedComponentId) continue;
    const record = records.get(component.id);
    const reportKey = component.reportKeys.find(key => recordsByReport.has(key)) ?? (component.reportKeys.length === 0 && recordsByReport.has("MEM") ? "MEM" : undefined);
    if (!record || !reportKey) continue;
    recordsByReport.get(reportKey)?.push(record);
  }
  return archived.map(report => {
    const markdown = "# Seeded external Life Store report\n\n" + (recordsByReport.get(report.key) ?? []).map(record => "```ResearchComponentComparisonV4\n" + JSON.stringify(record) + "\n```\n").join("\n");
    return { reportKey: report.key, originalDigest: report.originalDigest, contentDigest: digest(markdown), markdown };
  });
};
const lifeStoreQuoteProbe = (input: RegisteredProbeInputV1, context: OpsControlContextV1): Result<RegisteredProbeOperationV1> => {
  if (input.caseId !== undefined) return { ok: false, error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false } };
  const manifest = registeredCliAcceptanceManifestInventory.find(entry => entry.id === input.probeId);
  if (!manifest || manifest.scenarioId !== "research.component-comparison" || JSON.stringify(manifest.mandatoryCases.map(entry => entry.id)) !== JSON.stringify(lifeStoreCases)) return { ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } };
  const baseline = EngineeringControl.checkResearch({ release: "R0" }, context);
  if (!baseline.ok) return baseline;
  const candidateRecords = new Map<string, ResearchComponentComparisonV4>();
  for (const component of baseline.data.components) candidateRecords.set(component.id, lifeStoreRecord(component, [], []));
  const candidateDocuments = lifeStoreDocuments(baseline.data.reports, baseline.data.components, candidateRecords);
  const candidateReadback = EngineeringControl.checkResearch({ release: "R0" }, context, candidateDocuments);
  if (!candidateReadback.ok) return candidateReadback;
  const componentDecisions = new Map(candidateReadback.data.componentDecisions.map(decision => [decision.componentId, decision]));
  const scopedComponents = baseline.data.components.filter(component => {
    const decision = componentDecisions.get(component.id);
    return decision !== undefined && decision.comparisonDigest !== null;
  }).sort((left, right) => left.id.localeCompare(right.id));
  if (scopedComponents.length !== 118) return TestProbeControl.run(input, context, [checkViewSchema.parse({ id: "research.component-comparison", owner: "self-improvement", state: "FAIL", checkedAt: new Date().toISOString(), reasonCode: "LIFESTORE_SCOPE_BINDING_FAILED", prerequisite: JSON.stringify({ phase: "candidate-scope", expectedComponentCount: 118, componentCount: scopedComponents.length, boundComponentIds: scopedComponents.map(component => component.id), wholeATComplete: false }), nextCommandId: "probe.show", links: { recordRefs: [], observations: [], artifactDigests: [digest(JSON.stringify(candidateDocuments)), digest(readFileSync(new URL("./component-comparison-probe.js", import.meta.url)))] } })]);
  const requirementIds = [...new Set(scopedComponents.flatMap(component => componentDecisions.get(component.id)?.missingRequirementIds ?? []))].sort();
  const canonicalQuotes = EngineeringControl.canonicalRequirementQuotes(requirementIds, context);
  if (!canonicalQuotes.ok) return canonicalQuotes;
  const quoteById = new Map(canonicalQuotes.data.map(quote => [quote.requirementId, quote]));
  const candidateRequirementIds = new Map(scopedComponents.map(component => [component.id, componentDecisions.get(component.id)?.missingRequirementIds ?? []]));
  const target = scopedComponents[0];
  if (!target) return lifeStoreError();
  const targetRequirementId = candidateRequirementIds.get(target.id)?.[0];
  if (!targetRequirementId) return lifeStoreError();
  const checks: CheckViewV1[] = [];
  for (const caseId of lifeStoreCases) {
    const records = new Map<string, ResearchComponentComparisonV4>();
    for (const component of scopedComponents) {
      const ids = candidateRequirementIds.get(component.id) ?? [];
      const quotes = ids.flatMap(id => {
        const quote = quoteById.get(id);
        return quote ? [quote] : [];
      });
      if (quotes.length !== ids.length) return lifeStoreError();
      records.set(component.id, lifeStoreRecord(component, ids, quotes));
    }
    const targetRecord = records.get(target.id);
    if (!targetRecord) return lifeStoreError();
    if (caseId === "missing-requirement-quote") targetRecord.requirementQuotes = targetRecord.requirementQuotes.filter(quote => quote.requirementId !== targetRequirementId);
    if (caseId === "unsupported-choice") {
      const option = targetRecord.options.find(entry => entry.id === "outside");
      if (!option) return lifeStoreError();
      option.support = "unsupported";
    }
    if (caseId === "missing-version") {
      targetRecord.primarySource.sourceVersion = null;
      targetRecord.primarySource.versionByteStart = null;
      targetRecord.primarySource.versionByteEnd = null;
    }
    if (caseId === "wrong-version") targetRecord.primarySource.sourceVersion = "v9";
    if (caseId === "wrong-digest") targetRecord.primarySource.sourceDigest = "0".repeat(64);
    if (caseId === "wrong-primary-quote") {
      const quote = targetRecord.primarySource.quotes[0];
      if (!quote) return lifeStoreError();
      quote.quote += " changed";
    }
    if (caseId === "wrong-requirement-quote") {
      const quote = targetRecord.requirementQuotes.find(entry => entry.requirementId === targetRequirementId);
      if (!quote) return lifeStoreError();
      quote.quote += " changed";
    }
    if (caseId === "missing-validation") targetRecord.validations = [];
    const documents = lifeStoreDocuments(baseline.data.reports, baseline.data.components, records, caseId === "missing-component" ? target.id : undefined);
    const inspection = EngineeringControl.checkResearch({ release: "R0" }, context, documents);
    if (!inspection.ok) return inspection;
    const decisions = new Map(inspection.data.componentDecisions.map(decision => [decision.componentId, decision]));
    const affected = decisions.get(target.id);
    if (!affected) return lifeStoreError();
    const quotedComponents = scopedComponents.flatMap(component => {
      const decision = decisions.get(component.id);
      return decision !== undefined && decision.comparisonDigest !== null ? [decision] : [];
    });
    const quoteFailures = quotedComponents.filter(decision => decision.missingRequirementIds.length > 0 || decision.missingSourceIds.some(id => id.startsWith("PRIMARY_SOURCE:")));
    const allDecisionsBlocked = scopedComponents.every(component => decisions.get(component.id)?.state === "BLOCKED");
    const routeMissingCount = quotedComponents.filter(decision => decision.missingValidationIds.includes("ROUTE:R0:" + decision.componentId)).length;
    const skillMissingCount = quotedComponents.filter(decision => decision.missingValidationIds.includes("SKILL:R0:" + decision.componentId)).length;
    const affectedRequirementIds = affected.missingRequirementIds;
    const affectedSourceIds = affected.missingSourceIds.filter(id => id.startsWith("PRIMARY_SOURCE:"));
    const affectedValidationIds = affected.missingValidationIds;
    const archiveBound = documents.every(document => {
      const report = inspection.data.reports.find(entry => entry.key === document.reportKey);
      return report !== undefined && report.origin === "seeded_document" && report.originalDigest === document.originalDigest && report.digest === document.contentDigest;
    });
    const requirementAnchors = scopedComponents.flatMap(component => records.get(component.id)?.requirementQuotes.map(quote => [component.id, quote.requirementId, quote.sourceDigest, quote.byteStart, quote.byteEnd]) ?? []);
    requirementAnchors.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const requirementDigest = digest(JSON.stringify(requirementAnchors));
    const sourceDigests = scopedComponents.map(component => [component.id, records.get(component.id)?.primarySource.sourceDigest ?? null]);
    sourceDigests.sort((left, right) => String(left[0]).localeCompare(String(right[0])));
    const sourceDigest = digest(JSON.stringify(sourceDigests));
    const localPass = caseId === "positive-all-required-quotes"
      ? quoteFailures.length === 0 && quotedComponents.length === scopedComponents.length
      : caseId === "missing-component"
        ? affected.comparisonDigest === null && affected.findings.includes("DECISION_MISSING") && quotedComponents.length === scopedComponents.length - 1
        : caseId === "missing-requirement-quote"
          ? affected.missingRequirementIds.includes(targetRequirementId)
          : caseId === "unsupported-choice"
            ? affected.findings.includes("CHOICE_UNSUPPORTED") && affected.missingRequirementIds.length === 0 && affectedSourceIds.length === 0
            : caseId === "missing-version" || caseId === "wrong-version"
              ? affectedSourceIds.includes("PRIMARY_SOURCE:VERSION")
              : caseId === "wrong-digest"
                ? affectedSourceIds.includes("PRIMARY_SOURCE:DIGEST")
                : caseId === "wrong-primary-quote"
                  ? affectedSourceIds.some(id => id.startsWith("PRIMARY_SOURCE:QUOTE:"))
                  : caseId === "wrong-requirement-quote"
                    ? affected.missingRequirementIds.includes(targetRequirementId)
                    : affected.missingValidationIds.includes("G0:R0:" + target.id);
    const expectedQuoteFailureCount = ["missing-requirement-quote", "missing-version", "wrong-version", "wrong-digest", "wrong-primary-quote", "wrong-requirement-quote"].includes(caseId) ? 1 : 0;
    const passed = localPass && quoteFailures.length === expectedQuoteFailureCount && allDecisionsBlocked && archiveBound && inspection.data.admission === "BLOCKED" && inspection.data.wholeATsPassed.length === 0 && !inspection.data.acceptanceComplete;
    const details = { caseId, componentCount: scopedComponents.length, quotedComponents: quotedComponents.length, requirementQuoteCount: scopedComponents.reduce((count, component) => count + (records.get(component.id)?.requirementQuotes.length ?? 0), 0), quoteFailureCount: quoteFailures.length, affectedComponentId: target.id, findings: affected.findings, selectedOptionId: affected.selectedOptionId, requirementIds: affectedRequirementIds, sourceIds: affected.missingSourceIds, validationIds: affectedValidationIds, routeMissingCount, skillMissingCount, requirementDigest, sourceDigest, archiveBound, registerAdmission: inspection.data.admission, wholeDecisionState: "BLOCKED", wholeATsPassedCount: inspection.data.wholeATsPassed.length, liveProviderSends: 0, wholeATComplete: false, acceptanceComplete: false };
    const prerequisite = JSON.stringify(details);
    if (prerequisite.length > 2000) return lifeStoreError();
    checks.push(checkViewSchema.parse({ id: "research.component-comparison", owner: "self-improvement", state: passed ? "PASS" : "FAIL", checkedAt: new Date().toISOString(), reasonCode: passed ? "LIFESTORE_QUOTE_DIAGNOSTIC_PASS" : "LIFESTORE_QUOTE_DIAGNOSTIC_FAIL", prerequisite, nextCommandId: "probe.show", links: { recordRefs: [], observations: [], artifactDigests: [digest(JSON.stringify(documents)), digest(readFileSync(new URL("./component-comparison-probe.js", import.meta.url))), digest(readFileSync(new URL("./engineering-control.js", import.meta.url)))] } }));
  }
  return TestProbeControl.run(input, context, checks);
};
const requiredComponentProbe = (input: RegisteredProbeInputV1, context: OpsControlContextV1): Result<RegisteredProbeOperationV1> => {
  if (input.caseId !== undefined) return { ok: false, error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false } };
  const cases = ["required-component-absent", "required-component-unsupported", "required-component-incomplete-ids", "required-component-complete-outside-selected"];
  const manifest = registeredCliAcceptanceManifestInventory.find(entry => entry.id === input.probeId);
  if (!manifest || manifest.scenarioId !== "research.component-comparison" || JSON.stringify(manifest.mandatoryCases.map(entry => entry.id)) !== JSON.stringify(cases)) return { ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } };
  const baseline = EngineeringControl.checkResearch({ release: "R0" }, context);
  if (!baseline.ok) return baseline;
  const archive = baseline.data.reports.find(entry => entry.key === "TS" && entry.originalDigest !== null);
  const component = baseline.data.components.find(entry => entry.id === "M02" && entry.reportKeys.includes("TS"));
  const absent = baseline.data.componentDecisions.find(entry => entry.componentId === "M02");
  if (!archive?.originalDigest || !component || !absent || absent.comparisonDigest !== null || !absent.missingRequirementIds.includes("0.10")) return { ok: false, error: { module: "ops", code: "ARTIFACT_MISMATCH", message: opsErrorMessages.ARTIFACT_MISMATCH, retryable: false } };
  const validationId = "G0:R0:" + component.id;
  const checks: CheckViewV1[] = [];
  for (const caseId of cases) {
    const legacy = completeReport();
    const report = researchComponentComparisonV2Schema.parse({ ...legacy, scope: "required-component", mappedRequirements: absent.missingRequirementIds, selectedOptionId: "outside", releaseGate: component.releaseGate, evidence: [...legacy.evidence, ...component.reportKeys.map(id => ({ id, url: "https://primary.example.test/" + id, publisher: "Seeded indexed primary report", kind: "primary", supportedOptionIds: legacy.options.map(option => option.id) }))], validations: [{ id: validationId, support: "proven", sourceIds: component.reportKeys, testIds: legacy.acceptanceIds }] });
    if (caseId === "required-component-unsupported") {
      const selected = report.options.find(option => option.id === "outside");
      const validation = report.validations[0];
      if (!selected || !validation) return { ok: false, error: { module: "ops", code: "ARTIFACT_MISMATCH", message: opsErrorMessages.ARTIFACT_MISMATCH, retryable: false } };
      selected.support = "unsupported";
      report.evidence = report.evidence.filter(source => source.id !== "TS");
      validation.support = "unsupported";
    }
    if (caseId === "required-component-incomplete-ids") {
      report.mappedRequirements = report.mappedRequirements.filter(id => id !== "0.10");
      report.evidence = report.evidence.filter(source => source.id !== "TS");
      report.validations = [];
    }
    const markdown = "# Seeded external report\n\n" + (caseId === "required-component-absent" ? "No decision record supplied.\n" : "```ResearchComponentComparisonV2\n" + JSON.stringify(report) + "\n```\n");
    const inspection = EngineeringControl.checkResearch({ release: "R0" }, context, [{ reportKey: archive.key, originalDigest: archive.originalDigest, contentDigest: digest(markdown), markdown }]);
    if (!inspection.ok) return inspection;
    const observed = inspection.data.componentDecisions.find(entry => entry.componentId === component.id);
    const bound = inspection.data.reports.find(entry => entry.key === archive.key);
    if (!observed || !bound) return { ok: false, error: { module: "ops", code: "ARTIFACT_MISMATCH", message: opsErrorMessages.ARTIFACT_MISMATCH, retryable: false } };
    const exact = (actual: readonly string[], expected: readonly string[]): boolean => JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
    const passed = caseId === "required-component-absent"
      ? observed.state === "BLOCKED" && observed.comparisonDigest === null && observed.findings.includes("DECISION_MISSING") && exact(observed.missingRequirementIds, absent.missingRequirementIds) && exact(observed.missingSourceIds, component.reportKeys) && exact(observed.missingValidationIds, [validationId])
      : caseId === "required-component-unsupported"
        ? observed.state === "BLOCKED" && observed.findings.includes("CHOICE_UNSUPPORTED") && observed.selectedOptionId === "outside" && exact(observed.missingSourceIds, ["TS"]) && exact(observed.missingValidationIds, [validationId])
        : caseId === "required-component-incomplete-ids"
          ? observed.state === "BLOCKED" && exact(observed.missingRequirementIds, ["0.10"]) && exact(observed.missingSourceIds, ["TS"]) && exact(observed.missingValidationIds, [validationId])
          : observed.state === "PASS" && observed.findings.length === 0 && observed.selectedOptionId === "outside" && report.options.some(option => option.id === observed.selectedOptionId && option.example === null) && observed.missingRequirementIds.length + observed.missingSourceIds.length + observed.missingValidationIds.length === 0;
    const archiveBound = bound.path === archive.path && bound.originalDigest === archive.originalDigest && bound.digest === digest(markdown) && bound.origin === "seeded_document";
    checks.push(checkViewSchema.parse({ id: "research.component-comparison", owner: "self-improvement", state: passed && archiveBound ? "PASS" : "FAIL", checkedAt: new Date().toISOString(), reasonCode: passed && archiveBound ? "REQUIRED_COMPONENT_DIAGNOSTIC_PASS" : "REQUIRED_COMPONENT_DIAGNOSTIC_FAIL", prerequisite: JSON.stringify({ caseId, actualUid: process.getuid?.() ?? null, archive: { key: bound.key, path: bound.path, originalDigest: bound.originalDigest, contentDigest: bound.digest, origin: bound.origin }, result: observed, registerAdmission: inspection.data.admission, liveProviderSends: 0, wholeATComplete: false }), nextCommandId: "probe.show", links: { recordRefs: [], observations: [], artifactDigests: [digest(markdown), digest(readFileSync(new URL("./component-comparison-probe.js", import.meta.url))), digest(readFileSync(new URL("./engineering-control.js", import.meta.url)))] } }));
  }
  return TestProbeControl.run(input, context, checks);
};
const fixedResearchReceipt = () => {
  const pin = researchSkillPinSchema.parse(JSON.parse(readFileSync(join(trustedCheckoutRoot(), "behavior/research-skill.json"), "utf8")));
  return modelRouteDelegationReceiptSchema.parse({ requestId: randomUUID(), purpose: "research", executionBackend: "codex_exec", state: "observed", reasonCode: "DELEGATION_ROUTE_OBSERVED", skill: { repository: pin.repository, sourcePath: pin.sourcePath, sourceCommit: pin.sourceCommit, contentDigest: pin.contentDigest, loadedDigest: digest(readFileSync(join(trustedCheckoutRoot(), "evidence/skills/mattpocock-research/SKILL.md"))), semanticVersion: pin.semanticVersion, resources: pin.resources }, invocation: { requested: { role: "research", arm: "original", provider: "siwc_responses", settings: { model: "gpt-6.1-sol", effort: "medium", serviceTier: "priority" }, policyDigest: digest(readFileSync(join(trustedCheckoutRoot(), "behavior/models.yaml"))), localOutputReservationTokens: 4096, outputLimitKind: "estimate", providerOutputCap: null, paidFallbackPermitted: false }, observed: { model: "gpt-6.1-sol", effort: "medium", serviceTier: "priority" }, terminal: "completed", completion: "complete", usage: { inputTokens: 17, outputTokens: 8, reasoningTokens: 3 }, usageState: "known", reservationTokens: 0, outputStarted: true, reasonCode: null, paidFallbackAttempted: false }, taskDigest: digest("Fixed external research task"), requestDigest: digest("Fixed external Codex request"), nativeExecutionVerified: false, acceptanceComplete: false });
};
const sourcesComponentProbe = (input: RegisteredProbeInputV1, context: OpsControlContextV1): Result<RegisteredProbeOperationV1> => {
  if (input.caseId !== undefined) return { ok: false, error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false } };
  const research = input.probeId === "AT-sources-190";
  const cases = research ? ["missing-route-receipt", "wrong-observed-model", "wrong-observed-reasoning", "wrong-observed-tier", "missing-research-skill", "wrong-skill-revision", "wrong-loaded-skill-digest", "missing-outside-option", "unsupported-outside-option", "complete-research-receipt"] : ["missing-primary-evidence", "missing-compared-alternatives", "missing-reliability-rationale", "missing-account-validation-plan", "missing-region-validation-plan", "missing-sources-requirement", "complete-linked-sources-decision"];
  const manifest = registeredCliAcceptanceManifestInventory.find(entry => entry.id === input.probeId);
  if (!manifest || manifest.scenarioId !== "research.component-comparison" || JSON.stringify(manifest.mandatoryCases.map(entry => entry.id)) !== JSON.stringify(cases)) return { ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } };
  const baseline = EngineeringControl.checkResearch({ release: "R0" }, context);
  if (!baseline.ok) return baseline;
  const archive = baseline.data.reports.find(entry => entry.key === "DC" && entry.originalDigest !== null);
  const component = baseline.data.components.find(entry => entry.id === "D01" && entry.reportKeys.includes("DC"));
  const absent = baseline.data.componentDecisions.find(entry => entry.componentId === component?.id);
  if (!archive?.originalDigest || !component || !absent || absent.comparisonDigest !== null || !absent.missingRequirementIds.includes("0.9")) return { ok: false, error: { module: "ops", code: "ARTIFACT_MISMATCH", message: opsErrorMessages.ARTIFACT_MISMATCH, retryable: false } };
  const validationId = "G0:R0:" + component.id;
  const checks: CheckViewV1[] = [];
  for (const caseId of cases) {
    const base = researchSourcesComponentComparisonSchema.parse({
      scope: "sources-component", componentId: component.id, mappedRequirements: absent.missingRequirementIds,
      options: [
        { id: "gmail-api", tool: "Supported Gmail API read adapter", example: "gmail-api", viable: true, support: "proven", primaryEvidenceIds: ["DC"], reliability: "History checkpoints and bounded full-resync", maintenance: "Pin discovery schema and adapter", resources: "Shared local process and store" },
        { id: "imap", tool: "IMAP read adapter", example: "imap", viable: false, support: "proven", primaryEvidenceIds: ["DC"], reliability: "Limited label and history coverage", maintenance: "Separate protocol maintenance", resources: "Additional local connection state" }
      ],
      evidence: [{ id: "DC", url: "https://primary.example.test/gmail", publisher: "Seeded primary Sources report", kind: "primary", supportedOptionIds: ["gmail-api", "imap"] }],
      selectedOptionId: "gmail-api", unresolvedFacts: [{ optionId: "imap", fact: "Account-specific IMAP limits remain unvalidated" }],
      acceptanceIds: ["AT-sources-188"], validationPlan: "Validate the pinned read adapter in an owned fixture before activation.", releaseGate: component.releaseGate,
      validations: [{ id: validationId, support: "proven", sourceIds: component.reportKeys, testIds: ["AT-sources-188"] }],
      accountValidationPlan: "Verify the selected account and least-privilege read grant against the pinned adapter before activation.",
      regionValidationPlan: "Verify the selected route and provider policy for the account region; unsupported regions remain unavailable."
    });
    const report = research ? researchSourcesComponentComparisonV2Schema.parse({ ...base, scope: "sources-research-component", executionReceipt: fixedResearchReceipt() }) : base;
    if (report.scope === "sources-research-component") {
      report.acceptanceIds = ["AT-sources-190"];
      for (const validation of report.validations) validation.testIds = ["AT-sources-190"];
      report.options.push({ id: "outside", tool: "Independent self-hosted connector route", example: null, viable: true, support: "proven", primaryEvidenceIds: ["DC"], reliability: "Validate durable checkpoints and readback", maintenance: "Pin and own the local integration", resources: "Additional local adapter state" });
      for (const source of report.evidence) source.supportedOptionIds.push("outside");
      if (caseId === "missing-route-receipt") report.executionReceipt = null;
      if (caseId === "missing-research-skill" && report.executionReceipt) { report.executionReceipt.state = "refused"; report.executionReceipt.reasonCode = "RESEARCH_SKILL_UNAVAILABLE"; report.executionReceipt.skill = null; report.executionReceipt.invocation = null; }
      const skill = report.executionReceipt?.skill;
      if (skill && caseId === "wrong-skill-revision") skill.sourceCommit = "0".repeat(40);
      if (skill && caseId === "wrong-loaded-skill-digest") { skill.contentDigest = "0".repeat(64); skill.loadedDigest = "0".repeat(64); }
      const invocation = report.executionReceipt?.invocation;
      if (report.executionReceipt && invocation?.observed && caseId.startsWith("wrong-observed-")) {
        if (caseId === "wrong-observed-model") invocation.observed.model = "gpt-6-luna";
        if (caseId === "wrong-observed-reasoning") invocation.observed.effort = "max";
        if (caseId === "wrong-observed-tier") invocation.observed.serviceTier = "default";
        report.executionReceipt.state = "refused"; report.executionReceipt.reasonCode = "DELEGATION_ROUTE_REFUSED";
        invocation.terminal = "failed"; invocation.completion = "pending"; invocation.usage = null; invocation.usageState = "uncertain"; invocation.reservationTokens = 4096; invocation.outputStarted = false; invocation.reasonCode = "route_mismatch";
      }
      if (caseId === "missing-outside-option") report.options = report.options.filter(option => option.example !== null);
      if (caseId === "unsupported-outside-option") for (const option of report.options) if (option.example === null) option.support = "unsupported";
    }
    const selected = report.options.find(option => option.id === report.selectedOptionId);
    if (!selected) return { ok: false, error: { module: "ops", code: "ARTIFACT_MISMATCH", message: opsErrorMessages.ARTIFACT_MISMATCH, retryable: false } };
    if (caseId === "missing-primary-evidence") report.evidence = [];
    if (caseId === "missing-compared-alternatives") report.options = [selected];
    if (caseId === "missing-reliability-rationale") selected.reliability = "";
    if (caseId === "missing-account-validation-plan") report.accountValidationPlan = " \n";
    if (caseId === "missing-region-validation-plan") report.regionValidationPlan = "";
    if (caseId === "missing-sources-requirement") report.mappedRequirements = report.mappedRequirements.filter(id => id !== "0.9");
    const markdown = "# Seeded external Sources report\n\n```" + (research ? "ResearchSourcesComponentComparisonV2" : "ResearchSourcesComponentComparisonV1") + "\n" + JSON.stringify(report) + "\n```\n";
    const inspection = EngineeringControl.checkResearch({ release: "R0" }, context, [{ reportKey: archive.key, originalDigest: archive.originalDigest, contentDigest: digest(markdown), markdown }]);
    if (!inspection.ok) return inspection;
    const observed = inspection.data.componentDecisions.find(entry => entry.componentId === component.id);
    const bound = inspection.data.reports.find(entry => entry.key === archive.key);
    if (!observed || !bound) return { ok: false, error: { module: "ops", code: "ARTIFACT_MISMATCH", message: opsErrorMessages.ARTIFACT_MISMATCH, retryable: false } };
    const expectedFinding = research ? caseId.includes("outside-option") ? "OUTSIDE_OPTION_MISSING" : caseId === "complete-research-receipt" ? null : "VALIDATION_ID_MISSING" : caseId === "missing-primary-evidence" ? "PRIMARY_EVIDENCE_MISSING" : caseId === "missing-compared-alternatives" ? "REQUIRED_OPTIONS_MISSING" : caseId === "missing-reliability-rationale" ? "TRADEOFFS_MISSING" : caseId === "missing-sources-requirement" ? "MAPPED_REQUIREMENTS_MISSING" : caseId === "complete-linked-sources-decision" ? null : "VALIDATION_PLAN_MISSING";
    const missingPlan = research ? caseId.includes("skill") ? "SKILL:R0:D01" : caseId.includes("route") || caseId.startsWith("wrong-observed-") ? "ROUTE:R0:D01" : null : caseId === "missing-account-validation-plan" ? "ACCOUNT:R0:D01" : caseId === "missing-region-validation-plan" ? "REGION:R0:D01" : null;
    const passed = observed.comparisonDigest === digest(JSON.stringify(report)) && JSON.stringify(observed.unresolvedFacts) === JSON.stringify(report.unresolvedFacts) && (expectedFinding === null
      ? observed.state === "PASS" && observed.findings.length === 0 && observed.selectedOptionId === report.selectedOptionId && observed.missingRequirementIds.length + observed.missingSourceIds.length + observed.missingValidationIds.length === 0
      : observed.state === "BLOCKED" && observed.findings.includes(expectedFinding) && (missingPlan === null || (research ? observed.missingValidationIds.includes(missingPlan) : JSON.stringify(observed.missingValidationIds) === JSON.stringify([missingPlan]))) && (caseId !== "missing-sources-requirement" || JSON.stringify(observed.missingRequirementIds) === JSON.stringify(["0.9"])));
    const archiveBound = bound.path === archive.path && bound.originalDigest === archive.originalDigest && bound.digest === digest(markdown) && bound.origin === "seeded_document";
    checks.push(checkViewSchema.parse({ id: "research.component-comparison", owner: "self-improvement", state: passed && archiveBound ? "PASS" : "FAIL", checkedAt: new Date().toISOString(), reasonCode: passed && archiveBound ? "SOURCES_DECISION_DIAGNOSTIC_PASS" : "SOURCES_DECISION_DIAGNOSTIC_FAIL", prerequisite: JSON.stringify({ caseId, actualUid: process.getuid?.() ?? null, archive: { key: bound.key, path: bound.path, originalDigest: bound.originalDigest, contentDigest: bound.digest, origin: bound.origin }, result: observed, execution: report.scope === "sources-research-component" ? { receiptDigest: report.executionReceipt ? digest(JSON.stringify(report.executionReceipt)) : null, observed: report.executionReceipt?.invocation?.observed ?? null, sourceCommit: report.executionReceipt?.skill?.sourceCommit ?? null, loadedDigest: report.executionReceipt?.skill?.loadedDigest ?? null, nativeExecutionVerified: false } : null, registerAdmission: inspection.data.admission, liveProviderSends: 0, wholeATComplete: false }), nextCommandId: "probe.show", links: { recordRefs: [], observations: [], artifactDigests: [digest(markdown), digest(readFileSync(new URL("./component-comparison-probe.js", import.meta.url))), digest(readFileSync(new URL("./engineering-control.js", import.meta.url)))] } }));
  }
  return TestProbeControl.run(input, context, checks);
};
