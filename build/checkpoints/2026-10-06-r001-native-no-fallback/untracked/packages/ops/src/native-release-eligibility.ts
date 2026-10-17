import { nativeReleaseEligibilityDecisionSchema, nativeReleaseEligibilityInputSchema } from "@toy/contracts";
import type {
  NativeReleaseCapabilityDispositionV1,
  NativeReleaseEligibilityDecisionV1,
  NativeReleaseEligibilityInputV1,
  NativeReleasePrerequisiteIdV1
} from "@toy/contracts";

const capabilityRequirements = {
  nativeApp: ["osHardware", "appleMembership", "distributionSigning", "nativeAppEntitlements", "coldTurkeyPro"],
  shareExtension: ["osHardware", "appleMembership", "distributionSigning", "nativeAppEntitlements", "shareEntitlements", "coldTurkeyPro"],
  pushNotifications: ["osHardware", "appleMembership", "distributionSigning", "nativeAppEntitlements", "pushEntitlements", "coldTurkeyPro"],
  alarmKit: ["osHardware", "appleMembership", "distributionSigning", "nativeAppEntitlements", "alarmEntitlements", "coldTurkeyPro"],
  familyControls: ["osHardware", "appleMembership", "distributionSigning", "nativeAppEntitlements", "familyControlsEntitlements", "familyControlsPermission", "coldTurkeyPro"],
  appBlocking: ["osHardware", "coldTurkeyPro"],
  wakeWord: ["osHardware", "porcupineLicenseAndModel"]
} satisfies Record<keyof NativeReleaseEligibilityDecisionV1["capabilities"], readonly NativeReleasePrerequisiteIdV1[]>;

export const NativeReleaseEligibilityPolicy = {
  evaluate(raw: NativeReleaseEligibilityInputV1): NativeReleaseEligibilityDecisionV1 {
    const input = nativeReleaseEligibilityInputSchema.parse(raw);
    const observedAt = Date.parse(input.observedAt);
    const isVerified = (id: NativeReleasePrerequisiteIdV1): boolean => {
      const prerequisite = input.prerequisites[id];
      const hasEvidence = prerequisite.links.recordRefs.length > 0
        || prerequisite.links.observations.length > 0
        || prerequisite.links.artifactDigests.length > 0;
      return prerequisite.state === "verified" && hasEvidence && Date.parse(prerequisite.checkedAt) <= observedAt;
    };
    const disposition = (ids: readonly NativeReleasePrerequisiteIdV1[]): NativeReleaseCapabilityDispositionV1 => {
      const missingPrerequisites = ids.filter(id => !isVerified(id));
      return {
        state: missingPrerequisites.length === 0 ? "eligible-for-testing" : "deferred",
        missingPrerequisites
      };
    };
    const capabilities = {
      nativeApp: disposition(capabilityRequirements.nativeApp),
      shareExtension: disposition(capabilityRequirements.shareExtension),
      pushNotifications: disposition(capabilityRequirements.pushNotifications),
      alarmKit: disposition(capabilityRequirements.alarmKit),
      familyControls: disposition(capabilityRequirements.familyControls),
      appBlocking: disposition(capabilityRequirements.appBlocking),
      wakeWord: disposition(capabilityRequirements.wakeWord)
    };
    return nativeReleaseEligibilityDecisionSchema.parse({
      observedAt: input.observedAt,
      capabilities,
      deliveryBranch: capabilities.nativeApp.state === "eligible-for-testing"
        ? "native-candidate-plus-web-and-discord"
        : "web-pwa-plus-discord",
      purchaseAssumed: false,
      weeklyFreeProvisioningCounted: false,
      liveActivationAdmitted: false
    });
  }
};
