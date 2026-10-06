import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { checkViewSchema, capacityTrialArmSchema, opsErrorMessages } from "@toy/contracts";
import type { CapacityTrialArmV1, CheckViewV1, OpsControlContextV1, OpsError, RegisteredProbeInputV1, RegisteredProbeOperationV1, Result } from "@toy/contracts";
import { TestClockControl, TestProbeControl } from "@toy/ops/public";
import { CapacityTrialJournal } from "./capacity-trial.js";

class TrialProbeRefusal extends Error {
  constructor(readonly error: OpsError) { super("CAPACITY_TRIAL_OWNER_REFUSED"); }
}
const take = <Data>(result: Result<Data>): Data => {
  if (!result.ok) throw new TrialProbeRefusal(result.error);
  return result.data;
};
const hash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
export const capacityTrialProbe = async (input: RegisteredProbeInputV1, context: OpsControlContextV1): Promise<Result<RegisteredProbeOperationV1>> => {
  if (input.caseId !== "capacity-trial" || !["AT-ops-47", "AT-self-improvement-59", "AT-self-improvement-60", "AT-RESEARCH-REGISTER-6"].includes(input.probeId)) return { ok: false, error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false } };
  const checks: CheckViewV1[] = [];
  const diagnostic = (name: string, passed: boolean, evidence: unknown): void => {
    checks.push(checkViewSchema.parse({
      id: "capacity.trial-journal", owner: "self-improvement", state: passed ? "PASS" : "FAIL", checkedAt: new Date().toISOString(),
      reasonCode: passed ? "REAL_TRIAL_JOURNAL_DIAGNOSTIC_PASS" : "REAL_TRIAL_JOURNAL_DIAGNOSTIC_FAIL",
      prerequisite: JSON.stringify({ name, evidence, clock: "fake_model", actualUid: process.getuid?.() ?? null, liveProviderSends: 0, liveTrialStarted: false, wholeATComplete: false }),
      nextCommandId: "probe.show", links: { recordRefs: [], observations: [], artifactDigests: [hash(readFileSync(new URL("./capacity-trial-probe.js", import.meta.url)))] }
    }));
  };
  try {
    const anchor = take(TestClockControl.get(context)).virtualWall;
    const endsAt = new Date(Date.parse(anchor) + 604800000).toISOString();
    const arm: CapacityTrialArmV1 = capacityTrialArmSchema.parse({
      armId: randomUUID(), requestId: randomUUID(), jobKey: "capacity.full-review", anchor, designation: "original", aiEverySeconds: 180, clock: "fake_model",
      policyDigest: hash("fixed-original-policy"), configurationDigest: hash("fixed-original-configuration"), routeDigest: hash("fixed-no-send-route"), hostDigest: hash("owned-fixture-host"), workloadDigest: hash("fixed-no-model-workload")
    });
    const first = await CapacityTrialJournal.withTest(context, owner => {
      const report = take(owner.startArm(arm));
      const firstSlot = take(owner.slot(arm.armId, 0));
      const lastSlot = take(owner.slot(arm.armId, 3359));
      diagnostic("complete-anchored-original-denominator", report.totalSlots === 3360 && report.sequenceIntact && report.counts.scheduled === 3360 && report.endsAt === endsAt && firstSlot.slotAt === anchor && lastSlot.slotAt === new Date(Date.parse(endsAt) - 180000).toISOString(), { report, firstSlot, lastSlot });
      const repeated = take(owner.startArm(arm));
      diagnostic("same-bindings-idempotent", JSON.stringify(repeated) === JSON.stringify(report), repeated);
      const changed = owner.startArm({ ...arm, policyDigest: hash("conflicting-policy") });
      diagnostic("arm-rebinding-refused", !changed.ok && changed.error.code === "CONFLICT" && JSON.stringify(take(owner.reportArm(arm.armId))) === JSON.stringify(report), { refused: !changed.ok });
      const reused = owner.startArm({ ...arm, armId: randomUUID() });
      diagnostic("request-rebinding-refused", !reused.ok && reused.error.code === "CONFLICT", { refused: !reused.ok });
      const overlap = owner.startArm({ ...arm, armId: randomUUID(), requestId: randomUUID() });
      diagnostic("overlapping-arm-refused", !overlap.ok && JSON.stringify(take(owner.reportArm(arm.armId))) === JSON.stringify(report), { refused: !overlap.ok });
      const reducedOriginal = owner.startArm({ ...arm, aiEverySeconds: 900 });
      diagnostic("original-cadence-cannot-be-reduced", !reducedOriginal.ok, { refused: !reducedOriginal.ok });
      const deferred = take(owner.deferSlot({ armId: arm.armId, index: 0, state: "deferred_quota", reason: "WEEKLY_THRESHOLD" }));
      const repeatedDeferral = take(owner.deferSlot({ armId: arm.armId, index: 0, state: "deferred_quota", reason: "WEEKLY_THRESHOLD" }));
      diagnostic("quota-deferral-retained", deferred.state === "deferred_quota" && deferred.reason === "WEEKLY_THRESHOLD" && JSON.stringify(deferred) === JSON.stringify(repeatedDeferral), deferred);
      take(TestClockControl.advance({ requestId: randomUUID(), by: "PT180S", waitMs: 0 }, context));
      take(owner.deferSlot({ armId: arm.armId, index: 1, state: "failed", reason: "MODEL_UNAVAILABLE" }));
      take(TestClockControl.advance({ requestId: randomUUID(), by: "PT360S", waitMs: 0 }, context));
      const boundary = take(owner.reconcileArm(arm.armId));
      const missed = take(owner.slot(arm.armId, 2));
      diagnostic("expired-opportunity-remains-missed", boundary.counts.missed === 1 && boundary.counts.deferred_quota === 1 && boundary.counts.failed === 1 && boundary.counts.scheduled === 3357 && missed.reason === "SLOT_BOUNDARY_PASSED", { report: boundary, missed });
      const late = owner.deferSlot({ armId: arm.armId, index: 2, state: "deferred_auth", reason: "LATE_AUTH" });
      diagnostic("past-outcome-replacement-refused", !late.ok && JSON.stringify(take(owner.slot(arm.armId, 2))) === JSON.stringify(missed), { refused: !late.ok });
      diagnostic("reconciliation-idempotent", JSON.stringify(take(owner.reconcileArm(arm.armId))) === JSON.stringify(boundary), boundary);
      return { ok: true, data: boundary };
    }, value => checks.push(value));
    const checkpoint = take(first);
    const restarted = await CapacityTrialJournal.withTest(context, owner => {
      const readback = take(owner.reportArm(arm.armId));
      diagnostic("real-postgres-restart-preserves-slots", JSON.stringify(readback) === JSON.stringify(checkpoint), readback);
      take(TestClockControl.advance({ requestId: randomUUID(), by: "PT604260S", waitMs: 0 }, context));
      const original = take(owner.reconcileArm(arm.armId));
      diagnostic("simulated-week-does-not-prove-ai-coverage", original.totalSlots === 3360 && original.counts.missed === 3358 && original.counts.deferred_quota === 1 && original.counts.failed === 1 && original.counts.reviewed === 0 && original.counts.swept === 0 && !original.acceptanceComplete && original.fullCadenceVerdict === "NOT_EVALUATED", original);
      const experimentalInput = capacityTrialArmSchema.parse({ ...arm, armId: randomUUID(), requestId: randomUUID(), anchor: endsAt, designation: "experimental", aiEverySeconds: 900, configurationDigest: hash("fixed-reduced-configuration") });
      const experimentalStart = owner.startArm(experimentalInput);
      if (!experimentalStart.ok) {
        diagnostic("experimental-arm-start-refused", false, { errorCode: experimentalStart.error.code, expectedAnchor: endsAt, actualClock: take(TestClockControl.get(context)).virtualWall, input: experimentalInput });
        return experimentalStart;
      }
      const experimental = experimentalStart.data;
      const experimentalReadback = take(owner.reportArm(experimental.arm.armId));
      diagnostic("experimental-arm-has-separate-denominator", experimentalReadback.arm.designation === "experimental" && experimentalReadback.totalSlots === 3360 && experimentalReadback.counts.scheduled === 3360, experimentalReadback);
      const originalAfterExperimental = take(owner.reportArm(arm.armId));
      diagnostic("original-arm-unchanged-after-experimental-start", JSON.stringify(originalAfterExperimental) === JSON.stringify(original), originalAfterExperimental);
      return { ok: true, data: undefined };
    }, value => checks.push(value));
    take(restarted);
  } catch (error) { diagnostic("public-trial-journal-refused", false, { errorCode: error instanceof TrialProbeRefusal ? error.error.code : "ATTESTATION_INVALID", rawErrorPublished: false }); }
  return TestProbeControl.run(input, context, checks);
};
