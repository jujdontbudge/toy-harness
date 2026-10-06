import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { checkViewSchema, opsErrorMessages, registeredCliAcceptanceManifestInventory, researchComponentComparisonSchema, researchComponentComparisonV2Schema } from "@toy/contracts";
import type { CheckViewV1, OpsControlContextV1, RegisteredProbeInputV1, RegisteredProbeOperationV1, ResearchComponentComparisonV1, Result } from "@toy/contracts";
import { TestProbeControl } from "@toy/ops/public";
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
  if (input.probeId === "AT-self-improvement-54") return requiredComponentProbe(input, context);
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
