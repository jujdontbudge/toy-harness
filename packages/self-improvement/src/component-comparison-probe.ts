import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { checkViewSchema, opsErrorMessages, registeredCliAcceptanceManifestInventory, researchComponentComparisonSchema } from "@toy/contracts";
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
