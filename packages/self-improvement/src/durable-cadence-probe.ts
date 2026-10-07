import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cadenceSourceGateInputV1Schema, capacityTrialArmSchema, checkViewSchema, durableCadenceCheckInventory, opsErrorMessages,
  registeredCliAcceptanceManifestInventory
} from "@toy/contracts";
import type {
  CadenceSourceGateInputV1, CheckViewV1, OpsControlContextV1, OpsError, RegisteredProbeInputV1,
  RegisteredProbeOperationV1, Result
} from "@toy/contracts";
import { OpsTestStack, TestClockControl, TestProbeControl, trustedCheckoutRoot } from "@toy/ops/public";
import { DurableCadenceOwner } from "./durable-cadence.js";

const probeIds = ["AT-hermes-config-69", "AT-activity-focus-86"] as const;
const caseId = "durable-cadence-owner-floor";
const phase = "durable-cadence-owner-floor";
const checkIds = durableCadenceCheckInventory.map(check => check.id);
const hash = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");

class ProbeRefusal extends Error {
  constructor(readonly error: OpsError) { super("DURABLE_CADENCE_PROBE_REFUSED"); }
}

const take = <Data>(result: Result<Data>): Data => {
  if (!result.ok) throw new ProbeRefusal(result.error);
  return result.data;
};

const invalid = (): Result<RegisteredProbeOperationV1> => ({
  ok: false,
  error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false }
});

const mutateFile = (input: CadenceSourceGateInputV1, path: string, mutate: (contents: string) => string): CadenceSourceGateInputV1 => {
  let found = false;
  const files = input.files.map(file => {
    if (file.path !== path) return file;
    found = true;
    return { ...file, contents: mutate(file.contents) };
  });
  if (!found) throw new Error("CADENCE_SOURCE_FILE_MISSING");
  return cadenceSourceGateInputV1Schema.parse({ files });
};

const appendFile = (input: CadenceSourceGateInputV1, path: string, contents: string): CadenceSourceGateInputV1 =>
  cadenceSourceGateInputV1Schema.parse({ files: [...input.files, { path, contents }] });

export const durableCadenceProbe = async (
  input: RegisteredProbeInputV1,
  context: OpsControlContextV1
): Promise<Result<RegisteredProbeOperationV1>> => {
  if (!probeIds.some(id => id === input.probeId) || (input.caseId !== undefined && input.caseId !== caseId)) return invalid();
  const manifest = registeredCliAcceptanceManifestInventory.find(entry => entry.id === input.probeId);
  const expectedManifestCase = [{ id: caseId, publicOperation: "ReplayEnvironment.runRegisteredProbe", phase }];
  if (!manifest || manifest.owner !== "self-improvement" || manifest.scenarioId !== "cadence.owner-floor"
    || JSON.stringify(manifest.mandatoryCases) !== JSON.stringify(expectedManifestCase)) {
    return { ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } };
  }
  const stack = OpsTestStack.inspect(context);
  if (!stack.ok || !stack.data.result?.ready || stack.data.result.release !== "R0"
    || stack.data.result.clock !== "fake" || stack.data.result.model !== "fake") return invalid();

  const root = trustedCheckoutRoot();
  const artifactDigests = [
    hash(readFileSync(join(root, "packages/contracts/src/durable-cadence.ts"))),
    hash(readFileSync(join(root, "packages/self-improvement/src/durable-cadence.ts"))),
    hash(readFileSync(join(root, "packages/self-improvement/src/durable-cadence-migration.ts"))),
    hash(readFileSync(join(root, "packages/obligations/src/public.ts"))),
    hash(readFileSync(new URL("./durable-cadence-probe.js", import.meta.url)))
  ];
  const checks: CheckViewV1[] = [];
  const ownerDiagnostics: CheckViewV1[] = [];
  const observed = new Set<string>();
  const record = (id: typeof checkIds[number], passed: boolean, evidence: unknown): void => {
    observed.add(id);
    checks.push(checkViewSchema.parse({
      id, owner: "self-improvement", state: passed ? "PASS" : "FAIL", checkedAt: new Date().toISOString(),
      reasonCode: passed ? "DURABLE_CADENCE_OWNER_FLOOR_PASS" : "DURABLE_CADENCE_OWNER_FLOOR_FAIL",
      prerequisite: JSON.stringify({ caseId, phase, evidence, actualUid: process.getuid?.() ?? null, liveProviderSends: 0, acceptedReviewInserted: false, wholeATComplete: false }),
      nextCommandId: "probe.show", links: { recordRefs: [], observations: [], artifactDigests }
    }));
  };

  try {
    const operation = await DurableCadenceOwner.withTest(context, owner => {
      const sourceSnapshot = take(owner.sourceSnapshot());
      const sourceGate = take(owner.sourceGate(sourceSnapshot));
      const baselineIncludesCanonicalToolSource = sourceSnapshot.files.some(file => file.path === "packages/contracts/src/obligations/v1/tool-schemas.mts");
      const reviewsBefore = take(owner.reviewCount());
      const sqlFilePath = "packages/self-improvement/migrations/capacity-trial.sql";
      const sqlFile = sourceSnapshot.files.find(file => file.path === sqlFilePath);
      if (!sqlFile) throw new Error("CADENCE_CANONICAL_SQL_MISSING");
      const missingStateInput = mutateFile(sourceSnapshot, sqlFilePath, contents => contents.replace("'swept', ", ""));
      const extraStateInput = mutateFile(sourceSnapshot, sqlFilePath, contents => contents.replace("'coalesced_after_outage'", "'coalesced_after_outage', 'noncanonical_state'"));
      const writerFragment = ["INSERT", "INTO", "toy_si.review"].join(" ");
      const competingWriterInput = appendFile(sourceSnapshot, "packages/obligations/src/cadence-shadow.ts", `const candidate = ${JSON.stringify(writerFragment)};`);
      const competingMjsWriterInput = appendFile(sourceSnapshot, "packages/obligations/src/cadence-shadow.mjs", `const candidate = ${JSON.stringify(writerFragment)};`);
      const missingState = take(owner.sourceGate(missingStateInput));
      const extraState = take(owner.sourceGate(extraStateInput));
      const competingWriter = take(owner.sourceGate(competingWriterInput));
      const competingMjsWriter = take(owner.sourceGate(competingMjsWriterInput));
      const sourceMutationsRejected = !missingState.accepted && missingState.reasonCodes.includes("CADENCE_ENUM_MISMATCH")
        && !extraState.accepted && extraState.reasonCodes.includes("CADENCE_ENUM_MISMATCH")
        && !competingWriter.accepted && competingWriter.reasonCodes.includes("CADENCE_COMPETING_WRITER")
        && !competingMjsWriter.accepted && competingMjsWriter.reasonCodes.includes("CADENCE_COMPETING_WRITER");
      record("cadence.source-gate", sourceGate.accepted && sourceMutationsRejected && baselineIncludesCanonicalToolSource, {
        baselineAccepted: sourceGate.accepted, baselineWriterFiles: sourceGate.writerFiles,
        missingStateRejected: !missingState.accepted, extraStateRejected: !extraState.accepted,
        competingWriterRejected: !competingWriter.accepted, competingMjsWriterRejected: !competingMjsWriter.accepted,
        baselineIncludesCanonicalToolSource, sourceMutationsAreInMemory: true
      });
      record("cadence.contract-enum", sourceGate.accepted && sourceGate.expectedStates.length === 12
        && JSON.stringify(sourceGate.expectedStates) === JSON.stringify(sourceGate.sqlStates), {
        expectedStates: sourceGate.expectedStates, sqlStates: sourceGate.sqlStates
      });

      const initialClock = take(TestClockControl.get(context));
      const cleanAnchor = new Date(Date.parse(initialClock.virtualWall) + 604800000).toISOString();
      const clearedPriorWindow = take(TestClockControl.advance({ requestId: randomUUID(), by: "P7D", waitMs: 0 }, context));
      if (clearedPriorWindow.result?.after.virtualWall !== cleanAnchor) throw new Error("CADENCE_CLOCK_ADVANCE_MISMATCH");
      const arm = capacityTrialArmSchema.parse({
        armId: randomUUID(), requestId: randomUUID(), jobKey: "capacity.full-review", anchor: cleanAnchor,
        designation: "original", aiEverySeconds: 180, clock: "fake_model", policyDigest: hash("fixed-original-policy"),
        configurationDigest: hash("fixed-original-configuration"), routeDigest: hash("fixed-no-send-route"),
        hostDigest: hash("owned-fixture-host"), workloadDigest: hash("fixed-no-model-workload")
      });
      const originalReport = take(owner.startArm(arm));
      const originalSweep = owner.sweepExperimentalSlot({ armId: arm.armId, index: 1 });
      const originalSlot = take(owner.slot(arm.armId, 1));
      const originalProtected = !originalSweep.ok && originalSweep.error.code === "CONFLICT"
        && originalSlot.state === "scheduled" && originalSlot.reason === null;
      const experimentalAnchor = new Date(Date.parse(cleanAnchor) + 604800000).toISOString();
      const weekAdvance = take(TestClockControl.advance({ requestId: randomUUID(), by: "P7D", waitMs: 0 }, context));
      if (weekAdvance.result?.after.virtualWall !== experimentalAnchor) throw new Error("CADENCE_EXPERIMENTAL_ANCHOR_MISMATCH");
      const experimental = capacityTrialArmSchema.parse({
        ...arm, armId: randomUUID(), requestId: randomUUID(), anchor: experimentalAnchor, designation: "experimental",
        aiEverySeconds: 900, configurationDigest: hash("fixed-reduced-configuration")
      });
      const experimentalReport = take(owner.startArm(experimental));
      const requiredAiSweep = owner.sweepExperimentalSlot({ armId: experimental.armId, index: 0 });
      const requiredAiSlot = take(owner.slot(experimental.armId, 0));
      const requiredAiProtected = !requiredAiSweep.ok && requiredAiSweep.error.code === "CONFLICT"
        && requiredAiSlot.state === "scheduled" && requiredAiSlot.reason === null;
      const sweptSlot = take(owner.sweepExperimentalSlot({ armId: experimental.armId, index: 1 }));

      const admission = take(owner.admitScheduled({
        principalId: randomUUID(), profile: "toy", surface: "activity-focus-floor", admissionKey: randomUUID(),
        payloadHash: hash("durable-cadence-owner-floor-payload"), sessionId: randomUUID(), taskId: null, turnId: null,
        contractId: randomUUID(), contractVersion: 1, generation: "1", releaseHash: hash("durable-cadence-owner-floor-release"),
        budgetGroupId: randomUUID(), scheduledSlot: { jobKey: `gate.owner-floor.${randomUUID()}`, slotAt: experimentalAnchor }
      }));
      const pending = take(owner.reviewResult(admission.runId));
      const admissionWritten = pending.state === "pending" && pending.reason === "awaiting_terminal"
        && pending.run.runId === admission.runId && pending.run.profile === "toy";

      const roleProof = take(owner.roleProof());
      const readerPrivilegesEmpty = [roleProof.readerPrivileges.cadence_slot, roleProof.readerPrivileges.run, roleProof.readerPrivileges.review]
        .every(value => value.select === false && value.insert === false && value.update === false && value.delete === false);
      const ownerCanWriteAsRequired = roleProof.ownerPrivileges.cadence_slot.select && roleProof.ownerPrivileges.cadence_slot.insert
        && roleProof.ownerPrivileges.cadence_slot.update && !roleProof.ownerPrivileges.cadence_slot.delete
        && roleProof.ownerPrivileges.run.select && roleProof.ownerPrivileges.run.insert
        && !roleProof.ownerPrivileges.run.update && !roleProof.ownerPrivileges.run.delete
        && roleProof.ownerPrivileges.review.select && roleProof.ownerPrivileges.review.insert
        && !roleProof.ownerPrivileges.review.update && !roleProof.ownerPrivileges.review.delete;
      const exactDenials = roleProof.readerWriteDenials.length === 9
        && new Set(roleProof.readerWriteDenials.map(denial => `${denial.table}:${denial.operation}`)).size === 9
        && roleProof.readerWriteDenials.every(denial => denial.sqlState === "42501");
      record("cadence.reader-write-denials", roleProof.ownerEffectiveRole === "toy_si_durable_owner"
        && roleProof.readerEffectiveRole === "toy_si_obligations_reader" && roleProof.readerCanSelectProjection
        && ownerCanWriteAsRequired && readerPrivilegesEmpty && exactDenials, roleProof);

      const query = {
        jobKey: null, from: experimentalAnchor,
        to: new Date(Date.parse(experimentalAnchor) + 360000).toISOString()
      };
      const projection = take(owner.readProjection(query));
      const experimentalTrialRows = projection.slots.filter(slot => slot.jobKey === experimental.jobKey);
      const originalTrialProjection = take(owner.readProjection({
        jobKey: arm.jobKey, from: cleanAnchor, to: new Date(Date.parse(cleanAnchor) + 360000).toISOString()
      }));
      const originalTrialRows = originalTrialProjection.slots.filter(slot => slot.jobKey === arm.jobKey);
      const noArmAiReferences = [...experimentalTrialRows, ...originalTrialRows].length === 4
        && [...experimentalTrialRows, ...originalTrialRows].every(slot => slot.runId === null && slot.reviewId === null
          && slot.startedAt === null && slot.inferenceDoneAt === null && slot.reviewedAt === null);
      const projectionReadback = projection.slots.some(slot => slot.state === "swept" && slot.jobKey === experimental.jobKey)
        && projection.slots.some(slot => slot.state === "running" && slot.runId === admission.runId)
        && projection.counts.swept === "1" && projection.counts.running === "1"
        && projection.counts.reviewed === "0" && projection.acceptedAiReviewed === "0" && noArmAiReferences;
      record("cadence.owner-run-pending", admissionWritten && noArmAiReferences && originalProtected && requiredAiProtected
        && sweptSlot.state === "swept" && originalReport.totalSlots === 3360 && experimentalReport.totalSlots === 3360, {
        runRef: admission, pendingResult: pending, originalArmSlots: originalReport.totalSlots,
        experimentalArmSlots: experimentalReport.totalSlots, originalSweepRejected: originalProtected,
        aiRequiredSweepRejected: requiredAiProtected, sweptState: sweptSlot.state,
        fakeArmProjectionRowsUnlinked: noArmAiReferences
      });
      record("cadence.obligations-readonly-projection", projectionReadback, {
        counts: projection.counts, acceptedAiReviewed: projection.acceptedAiReviewed, swept: projection.swept,
        rows: [...projection.slots, ...originalTrialRows].map(slot => ({
          jobKey: slot.jobKey, slotAt: slot.slotAt, state: slot.state, runId: slot.runId, reviewId: slot.reviewId,
          startedAt: slot.startedAt, inferenceDoneAt: slot.inferenceDoneAt, reviewedAt: slot.reviewedAt
        })),
        role: roleProof.readerEffectiveRole, readThroughProjectionView: true
      });
      const closeTrialWindow = take(TestClockControl.advance({ requestId: randomUUID(), by: "P7D", waitMs: 0 }, context));
      const trialWindowClosed = closeTrialWindow.result?.after.virtualWall === new Date(Date.parse(experimentalAnchor) + 604800000).toISOString();
      const reviewsAfter = take(owner.reviewCount());
      record("cadence.coverage-distinction", projection.swept === "1" && projection.acceptedAiReviewed === "0"
        && projection.counts.reviewed === "0" && pending.state === "pending" && trialWindowClosed
        && reviewsBefore === "0" && reviewsAfter === "0", {
        swept: projection.swept, acceptedAiReviewed: projection.acceptedAiReviewed,
        reviewed: projection.counts.reviewed, pendingReview: pending.state === "pending",
        acceptedReviewRowsBefore: reviewsBefore, acceptedReviewRowsAfter: reviewsAfter, trialWindowClosed
      });
      return { ok: true, data: undefined };
    }, check => ownerDiagnostics.push(check));
    if (!operation.ok) throw new ProbeRefusal(operation.error);
  } catch (error) {
    const ownerReasons = ownerDiagnostics.map(check => ({ id: check.id, reasonCode: check.reasonCode }));
    const evidence = error instanceof ProbeRefusal ? { errorCode: error.error.code, ownerReasons, rawErrorPublished: false }
      : { errorCode: "ATTESTATION_INVALID", ownerReasons, rawErrorPublished: false };
    for (const id of checkIds) if (!observed.has(id)) record(id, false, evidence);
  }

  for (const id of checkIds) if (!observed.has(id)) record(id, false, { reason: "GATE_NOT_EXERCISED" });
  return TestProbeControl.run(input, context, checks);
};
