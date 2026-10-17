import { z } from "zod";
import { instantSchema } from "./primitives.js";
import { evidenceLinksSchema } from "./control-evidence.js";

export const nativeReleasePrerequisiteIdSchema = z.enum([
  "osHardware", "appleMembership", "distributionSigning", "nativeAppEntitlements", "shareEntitlements",
  "pushEntitlements", "alarmEntitlements", "familyControlsEntitlements", "familyControlsPermission", "coldTurkeyPro", "porcupineLicenseAndModel"
]);
export const nativeReleasePrerequisiteSchema = z.strictObject({
  state: z.enum(["unknown", "absent", "unverified", "verified"]), checkedAt: instantSchema, links: evidenceLinksSchema
});
export const nativeReleaseEligibilityInputSchema = z.strictObject({
  observedAt: instantSchema,
  prerequisites: z.strictObject({
    osHardware: nativeReleasePrerequisiteSchema, appleMembership: nativeReleasePrerequisiteSchema,
    distributionSigning: nativeReleasePrerequisiteSchema, nativeAppEntitlements: nativeReleasePrerequisiteSchema,
    shareEntitlements: nativeReleasePrerequisiteSchema, pushEntitlements: nativeReleasePrerequisiteSchema,
    alarmEntitlements: nativeReleasePrerequisiteSchema, familyControlsEntitlements: nativeReleasePrerequisiteSchema,
    familyControlsPermission: nativeReleasePrerequisiteSchema,
    coldTurkeyPro: nativeReleasePrerequisiteSchema, porcupineLicenseAndModel: nativeReleasePrerequisiteSchema
  })
});
export const nativeReleaseCapabilityDispositionSchema = z.strictObject({
  state: z.enum(["deferred", "eligible-for-testing"]), missingPrerequisites: z.array(nativeReleasePrerequisiteIdSchema)
});
export const nativeReleaseEligibilityDecisionSchema = z.strictObject({
  observedAt: instantSchema,
  capabilities: z.strictObject({
    nativeApp: nativeReleaseCapabilityDispositionSchema, shareExtension: nativeReleaseCapabilityDispositionSchema,
    pushNotifications: nativeReleaseCapabilityDispositionSchema, alarmKit: nativeReleaseCapabilityDispositionSchema,
    familyControls: nativeReleaseCapabilityDispositionSchema, appBlocking: nativeReleaseCapabilityDispositionSchema,
    wakeWord: nativeReleaseCapabilityDispositionSchema
  }),
  deliveryBranch: z.enum(["web-pwa-plus-discord", "native-candidate-plus-web-and-discord"]),
  purchaseAssumed: z.literal(false), weeklyFreeProvisioningCounted: z.literal(false), liveActivationAdmitted: z.literal(false)
});
export type NativeReleasePrerequisiteIdV1 = z.infer<typeof nativeReleasePrerequisiteIdSchema>;
export type NativeReleasePrerequisiteV1 = z.infer<typeof nativeReleasePrerequisiteSchema>;
export type NativeReleaseEligibilityInputV1 = z.infer<typeof nativeReleaseEligibilityInputSchema>;
export type NativeReleaseCapabilityDispositionV1 = z.infer<typeof nativeReleaseCapabilityDispositionSchema>;
export type NativeReleaseEligibilityDecisionV1 = z.infer<typeof nativeReleaseEligibilityDecisionSchema>;
export const nativeReleaseEligibilitySchemaInventory = {
  NativeReleasePrerequisiteIdV1: nativeReleasePrerequisiteIdSchema,
  NativeReleasePrerequisiteV1: nativeReleasePrerequisiteSchema,
  NativeReleaseEligibilityInputV1: nativeReleaseEligibilityInputSchema,
  NativeReleaseCapabilityDispositionV1: nativeReleaseCapabilityDispositionSchema,
  NativeReleaseEligibilityDecisionV1: nativeReleaseEligibilityDecisionSchema
};
