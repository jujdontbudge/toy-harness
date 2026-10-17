import { z } from "zod";
import { digestSchema, instantSchema, uuidSchema } from "./primitives.js";
import { modelRouteSelectionSchema } from "./model-route.js";

const accountRefSchema = z.string().min(1).max(200);
const percentSchema = z.number().min(0).max(100);
const upperPercentSchema = z.number().nonnegative();
export const modelQuotaWindowSchema = z.strictObject({
  bucketId: z.string().min(1).max(200), durationMinutes: z.int().positive(), usedPercent: percentSchema,
  resetAt: instantSchema
});
export const modelQuotaObservationSchema = z.strictObject({
  id: uuidSchema, provider: z.literal("siwc_responses"), accountRef: accountRefSchema,
  reportedAt: instantSchema, sourceAuthorized: z.boolean(), schemaValid: z.boolean(),
  status: z.enum(["available", "unavailable", "exhausted"]), windows: z.array(modelQuotaWindowSchema).max(100),
  bodyRef: z.string().min(1).max(500)
});
export const modelAdmissionWorkSchema = z.union([
  z.strictObject({ class: z.literal("foreground"), authenticatedRequestId: uuidSchema }),
  z.strictObject({ class: z.literal("foreground-judge"), authenticatedRequestId: uuidSchema, parentCallId: uuidSchema }),
  z.strictObject({ class: z.enum(["event", "quiet-tick", "repair", "replay", "continuation", "child", "research", "judge", "auxiliary"]) })
]);
export const modelAdmissionLedgerSchema = z.strictObject({
  accountRef: accountRefSchema, utcDay: z.iso.date(), policyDigest: digestSchema,
  ready: z.boolean(), restoredUnreconciled: z.boolean(), providerLeaseActive: z.boolean(),
  foregroundWaiting: z.boolean(), fallbackJobsReserved: z.int().nonnegative(),
  unreflectedFiveHourUpperPercent: upperPercentSchema.nullable(), unreflectedWeeklyUpperPercent: upperPercentSchema.nullable()
});
export const modelAdmissionInputSchema = z.strictObject({
  now: instantSchema, accountRef: accountRefSchema, requested: modelRouteSelectionSchema,
  work: modelAdmissionWorkSchema, ledger: modelAdmissionLedgerSchema, observation: modelQuotaObservationSchema.nullable(),
  expectedFiveHourUpperPercent: upperPercentSchema.nullable(), expectedWeeklyUpperPercent: upperPercentSchema.nullable()
});
export const modelAdmissionDecisionSchema = z.strictObject({
  eligible: z.boolean(), mode: z.enum(["foreground", "measured", "fixed-count", "unavailable"]),
  reason: z.enum(["ELIGIBLE", "ACCOUNTING_UNAVAILABLE", "POLICY_CHANGED", "PROVIDER_BUSY", "FOREGROUND_WAITING", "RESTORE_UNRECONCILED", "QUOTA_EXHAUSTED", "FIVE_HOUR_THRESHOLD", "WEEKLY_THRESHOLD", "OPTIONAL_WORK_PAUSED", "DAILY_JOB_CEILING", "RESERVATION_UNKNOWN", "RESERVATION_THRESHOLD"]),
  retryAt: instantSchema.nullable(), quotaSnapshotId: uuidSchema.nullable(),
  foregroundInputAccepted: z.literal(true), providerSendPermitIssued: z.literal(false), paidFallbackPermitted: z.literal(false)
});
export type ModelQuotaWindowV1 = z.infer<typeof modelQuotaWindowSchema>;
export type ModelQuotaObservationV1 = z.infer<typeof modelQuotaObservationSchema>;
export type ModelAdmissionWorkV1 = z.infer<typeof modelAdmissionWorkSchema>;
export type ModelAdmissionLedgerV1 = z.infer<typeof modelAdmissionLedgerSchema>;
export type ModelAdmissionInputV1 = z.infer<typeof modelAdmissionInputSchema>;
export type ModelAdmissionDecisionV1 = z.infer<typeof modelAdmissionDecisionSchema>;
export const modelAdmissionSchemaInventory = {
  ModelQuotaWindowV1: modelQuotaWindowSchema, ModelQuotaObservationV1: modelQuotaObservationSchema,
  ModelAdmissionWorkV1: modelAdmissionWorkSchema, ModelAdmissionLedgerV1: modelAdmissionLedgerSchema,
  ModelAdmissionInputV1: modelAdmissionInputSchema, ModelAdmissionDecisionV1: modelAdmissionDecisionSchema
};
