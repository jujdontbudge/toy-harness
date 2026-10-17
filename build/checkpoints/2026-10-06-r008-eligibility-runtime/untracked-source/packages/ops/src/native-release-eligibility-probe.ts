import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { checkViewSchema, nativeReleaseEligibilityInputSchema, nativeReleasePrerequisiteIdSchema, opsErrorMessages, registeredProbeInputSchema } from "@toy/contracts";
import type { CheckViewV1, NativeReleaseEligibilityDecisionV1, NativeReleaseEligibilityInputV1, NativeReleasePrerequisiteV1, OpsControlContextV1, RegisteredProbeInputV1, RegisteredProbeOperationV1, Result } from "@toy/contracts";
import { FixtureProbe, fixtureStackInspect } from "./fixture-stack.js";
import { NativeReleaseEligibilityPolicy } from "./native-release-eligibility.js";

const checkedAt = "2026-10-06T00:00:00.000Z";
const artifactDigest = (): string => createHash("sha256").update(readFileSync(new URL("./native-release-eligibility-probe.js", import.meta.url))).digest("hex");
const inventory = (state: NativeReleasePrerequisiteV1["state"], withEvidence: boolean): NativeReleaseEligibilityInputV1 => {
  const assessment: NativeReleasePrerequisiteV1 = { state, checkedAt, links: { recordRefs: [], observations: [], artifactDigests: withEvidence ? [artifactDigest()] : [] } };
  return nativeReleaseEligibilityInputSchema.parse({ observedAt: checkedAt, prerequisites: {
    osHardware: assessment, appleMembership: assessment, distributionSigning: assessment, nativeAppEntitlements: assessment,
    shareEntitlements: assessment, pushEntitlements: assessment, alarmEntitlements: assessment,
    familyControlsEntitlements: assessment, familyControlsPermission: assessment,
    coldTurkeyPro: assessment, porcupineLicenseAndModel: assessment
  } });
};
const nativeDeferred = (decision: NativeReleaseEligibilityDecisionV1): boolean => [
  decision.capabilities.nativeApp, decision.capabilities.shareExtension, decision.capabilities.pushNotifications,
  decision.capabilities.alarmKit, decision.capabilities.familyControls
].every(capability => capability.state === "deferred");
const allDeferred = (decision: NativeReleaseEligibilityDecisionV1): boolean => Object.values(decision.capabilities).every(capability => capability.state === "deferred");
const fixtureCheck = (scenario: string, input: NativeReleaseEligibilityInputV1, expected: (decision: NativeReleaseEligibilityDecisionV1) => boolean): CheckViewV1 => {
  const decision = NativeReleaseEligibilityPolicy.evaluate(input);
  const noSpend = decision.purchaseAssumed === false && decision.weeklyFreeProvisioningCounted === false && decision.liveActivationAdmitted === false;
  const evidence = {
    fixture: "fixed-external-prerequisite-inventory", scenario,
    states: Object.fromEntries(nativeReleasePrerequisiteIdSchema.options.map(id => [id, input.prerequisites[id].state])),
    emptyEvidenceCount: nativeReleasePrerequisiteIdSchema.options.filter(id => input.prerequisites[id].links.artifactDigests.length === 0).length,
    futureEvidence: nativeReleasePrerequisiteIdSchema.options.filter(id => input.prerequisites[id].checkedAt > input.observedAt),
    decision
  };
  return checkViewSchema.parse({ id: "release.native-eligibility", owner: "ops", state: noSpend && expected(decision) ? "PASS" : "FAIL", checkedAt: new Date().toISOString(),
    reasonCode: noSpend && expected(decision) ? "NO_SPEND_ELIGIBILITY_FIXTURE_PASS" : "NO_SPEND_ELIGIBILITY_FIXTURE_FAIL",
    prerequisite: JSON.stringify(evidence), nextCommandId: "probe.show", links: { recordRefs: [], observations: [], artifactDigests: [artifactDigest()] } });
};

export const NativeReleaseEligibilityProbe = {
  run(input: RegisteredProbeInputV1, context: OpsControlContextV1): Result<RegisteredProbeOperationV1> {
    const invalid: Result<RegisteredProbeOperationV1> = { ok: false, error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false } };
    if (!registeredProbeInputSchema.safeParse(input).success || input.caseId !== "native-release-eligibility" || !["AT-ops-81", "AT-client-apps-49", "AT-activity-focus-64"].includes(input.probeId)) return invalid;
    const owned = fixtureStackInspect(context);
    if (!owned.ok) return owned;
    const snapshot = owned.data.result;
    if (!snapshot?.ready || snapshot.clock !== "fake" || snapshot.model !== "fake") return invalid;
    try {
      const verified = inventory("verified", true);
      const membershipAbsent = { ...verified, prerequisites: { ...verified.prerequisites, appleMembership: { ...verified.prerequisites.appleMembership, state: "absent" } } } satisfies NativeReleaseEligibilityInputV1;
      const licencesAbsent = { ...verified, prerequisites: { ...verified.prerequisites, coldTurkeyPro: { ...verified.prerequisites.coldTurkeyPro, state: "absent" }, porcupineLicenseAndModel: { ...verified.prerequisites.porcupineLicenseAndModel, state: "absent" } } } satisfies NativeReleaseEligibilityInputV1;
      const unknown = inventory("unknown", false);
      const membershipOnly = { ...unknown, prerequisites: { ...unknown.prerequisites, appleMembership: verified.prerequisites.appleMembership } };
      const futureSigning = { ...verified, prerequisites: { ...verified.prerequisites, distributionSigning: { ...verified.prerequisites.distributionSigning, checkedAt: "2026-10-07T00:00:00.000Z" } } };
      const permissionUnknown = { ...verified, prerequisites: { ...verified.prerequisites, familyControlsPermission: unknown.prerequisites.familyControlsPermission } };
      const checks = [
        fixtureCheck("unknown-inventory", unknown, decision => allDeferred(decision) && decision.deliveryBranch === "web-pwa-plus-discord"),
        fixtureCheck("absent-membership", membershipAbsent, decision => nativeDeferred(decision) && decision.deliveryBranch === "web-pwa-plus-discord"),
        fixtureCheck("absent-licences", licencesAbsent, decision => nativeDeferred(decision) && decision.deliveryBranch === "web-pwa-plus-discord" && decision.capabilities.appBlocking.state === "deferred" && decision.capabilities.wakeWord.state === "deferred"),
        fixtureCheck("membership-does-not-prove-entitlements", membershipOnly, allDeferred),
        fixtureCheck("verified-label-without-evidence", inventory("verified", false), allDeferred),
        fixtureCheck("future-signing-evidence", futureSigning, nativeDeferred),
        fixtureCheck("family-controls-permission-required", permissionUnknown, decision => decision.capabilities.familyControls.state === "deferred" && decision.capabilities.familyControls.missingPrerequisites.includes("familyControlsPermission")),
        fixtureCheck("verified-fixture-only", verified, decision => Object.values(decision.capabilities).every(capability => capability.state === "eligible-for-testing") && decision.deliveryBranch === "native-candidate-plus-web-and-discord")
      ];
      return FixtureProbe.run(input, context, checks);
    } catch { return { ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } }; }
  }
};
