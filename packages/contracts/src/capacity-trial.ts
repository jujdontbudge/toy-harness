import { z } from "zod";
import { cadenceSlotStateSchema, digestSchema, instantSchema, uuidSchema } from "./primitives.js";
import type { Result } from "./ops.js";

export const capacityTrialArmSchema = z.strictObject({
  armId: uuidSchema, requestId: uuidSchema, jobKey: z.literal("capacity.full-review"),
  anchor: instantSchema, designation: z.enum(["original", "experimental"]),
  aiEverySeconds: z.union([z.literal(180), z.literal(900)]), clock: z.literal("fake_model"),
  policyDigest: digestSchema, configurationDigest: digestSchema, routeDigest: digestSchema,
  hostDigest: digestSchema, workloadDigest: digestSchema
}).refine(arm => arm.designation !== "original" || arm.aiEverySeconds === 180);
export const capacityTrialSlotSchema = z.strictObject({
  armId: uuidSchema, index: z.int().min(0).max(3359), slotAt: instantSchema,
  state: cadenceSlotStateSchema, reason: z.string().min(1).max(200).nullable(),
  updatedAt: instantSchema
});
export const capacityTrialDeferralSchema = z.strictObject({
  armId: uuidSchema, index: z.int().min(0).max(3359),
  state: z.enum(["deferred_quota", "deferred_auth", "deferred_network", "deferred_busy", "failed"]),
  reason: z.string().min(1).max(200).regex(/^[A-Z][A-Z0-9_]*$/)
});
export const capacityTrialReportSchema = z.strictObject({
  arm: capacityTrialArmSchema, endsAt: instantSchema, denominator: z.literal(3360),
  cadenceSeconds: z.literal(180), totalSlots: z.int().min(0).max(3360), sequenceIntact: z.boolean(),
  firstSlotAt: instantSchema.nullable(), lastSlotAt: instantSchema.nullable(),
  counts: z.record(cadenceSlotStateSchema, z.int().min(0).max(3360)),
  reasons: z.array(z.strictObject({ reason: z.string().min(1).max(200), count: z.int().min(1).max(3360) })).max(3360),
  acceptanceComplete: z.literal(false), fullCadenceVerdict: z.literal("NOT_EVALUATED")
});
export type CapacityTrialArmV1 = z.infer<typeof capacityTrialArmSchema>;
export type CapacityTrialSlotV1 = z.infer<typeof capacityTrialSlotSchema>;
export type CapacityTrialDeferralV1 = z.infer<typeof capacityTrialDeferralSchema>;
export type CapacityTrialReportV1 = z.infer<typeof capacityTrialReportSchema>;
export type CapacityTrialJournalApi = {
  startArm: (input: CapacityTrialArmV1) => Result<CapacityTrialReportV1>;
  deferSlot: (input: CapacityTrialDeferralV1) => Result<CapacityTrialSlotV1>;
  reconcileArm: (armId: string) => Result<CapacityTrialReportV1>;
  reportArm: (armId: string) => Result<CapacityTrialReportV1>;
  slot: (armId: string, index: number) => Result<CapacityTrialSlotV1>;
};
export const capacityTrialSchemaInventory = {
  CapacityTrialArmV1: capacityTrialArmSchema, CapacityTrialSlotV1: capacityTrialSlotSchema,
  CapacityTrialDeferralV1: capacityTrialDeferralSchema, CapacityTrialReportV1: capacityTrialReportSchema
};
