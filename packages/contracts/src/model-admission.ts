import { z } from "zod";
import { digestSchema, instantSchema, uint64Schema, uuidSchema } from "./primitives.js";
import { modelRouteSelectionSchema, modelRouteUsageSchema } from "./model-route.js";
import type { Result } from "./ops.js";

const accountRefSchema = z.string().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]+(?![\s\S])/);
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
const signedCounterSchema = z.string().max(19).regex(/^(0|[1-9][0-9]*)(?![\s\S])/).refine(value => BigInt(value) <= 9223372036854775807n);
export const modelAdmissionRequestSchema = z.strictObject({
  callKey: z.string().regex(/^[A-Za-z0-9._:-]{1,240}(?![\s\S])/), budgetGroupId: uuidSchema,
  rootContractId: uuidSchema, runId: uuidSchema.nullable(), generation: signedCounterSchema,
  parentCallId: uuidSchema.nullable(), attempt: z.int().positive(), accountRef: accountRefSchema,
  requested: modelRouteSelectionSchema, work: modelAdmissionWorkSchema, reservedInputTokens: z.int().nonnegative(),
  expectedFiveHourUpperPercent: upperPercentSchema.nullable(), expectedWeeklyUpperPercent: upperPercentSchema.nullable()
});
export const modelAdmissionRecordSchema = z.strictObject({
  id: uuidSchema, callKey: modelAdmissionRequestSchema.shape.callKey, requestHash: digestSchema,
  budgetGroupId: uuidSchema, accountRef: accountRefSchema, utcDay: z.iso.date(),
  runId: uuidSchema.nullable(), generation: signedCounterSchema,
  requested: modelRouteSelectionSchema, work: modelAdmissionWorkSchema,
  state: z.enum(["reserved", "sending", "denied", "uncertain", "settled"]),
  reservationCharged: z.boolean(), leaseActive: z.boolean(), nativeSendCount: z.union([z.literal(0), z.literal(1)]),
  nativeTerminalAcknowledged: z.boolean(), decision: modelAdmissionDecisionSchema,
  expectedFiveHourUpperPercent: upperPercentSchema.nullable(), expectedWeeklyUpperPercent: upperPercentSchema.nullable(),
  usage: modelRouteUsageSchema.nullable(), reportedTotalTokens: uint64Schema.nullable(),
  startedAt: instantSchema, endedAt: instantSchema.nullable()
});
export const modelAdmissionStoreViewSchema = z.strictObject({
  ledger: modelAdmissionLedgerSchema, observation: modelQuotaObservationSchema.nullable(), record: modelAdmissionRecordSchema.nullable(),
  budgetBinding: z.strictObject({rootContractId: uuidSchema, accountRef: accountRefSchema, policyDigest: digestSchema,
    state: z.enum(["open", "closed", "restored_unreconciled"])}).nullable()
});
export const modelAdmissionSettlementSchema = z.union([
  z.strictObject({ callId: uuidSchema, nativeTerminalAcknowledged: z.boolean(), usage: modelRouteUsageSchema, reportedTotalTokens: signedCounterSchema }),
  z.strictObject({ callId: uuidSchema, nativeTerminalAcknowledged: z.boolean(), usage: z.null(), reportedTotalTokens: z.null() })
]);
export const modelAdmissionConnectionSchema = z.strictObject({
  socketDirectory: z.string().min(2).max(4096).regex(/^\//).refine(value => !/[\u0000-\u001f\u007f]/.test(value) && !value.split("/").some(part => part === "." || part === "..")),
  database: z.string().regex(/^[a-z_][a-z0-9_]{0,62}(?![\s\S])/),
  peerRole: z.string().regex(/^[a-z_][a-z0-9_]{0,62}(?![\s\S])/), clientDigest: digestSchema
});
export const modelAdmissionRuntimeSchema = z.strictObject({ connection: modelAdmissionConnectionSchema, policyDigest: digestSchema });
export const modelAdmissionClaimSchema = z.strictObject({ claimed: z.boolean(), record: modelAdmissionRecordSchema, providerSendPermitIssued: z.literal(false) });
export type ModelQuotaWindowV1 = z.infer<typeof modelQuotaWindowSchema>;
export type ModelQuotaObservationV1 = z.infer<typeof modelQuotaObservationSchema>;
export type ModelAdmissionWorkV1 = z.infer<typeof modelAdmissionWorkSchema>;
export type ModelAdmissionLedgerV1 = z.infer<typeof modelAdmissionLedgerSchema>;
export type ModelAdmissionInputV1 = z.infer<typeof modelAdmissionInputSchema>;
export type ModelAdmissionDecisionV1 = z.infer<typeof modelAdmissionDecisionSchema>;
export type ModelAdmissionRequestV1 = z.infer<typeof modelAdmissionRequestSchema>;
export type ModelAdmissionRecordV1 = z.infer<typeof modelAdmissionRecordSchema>;
export type ModelAdmissionStoreViewV1 = z.infer<typeof modelAdmissionStoreViewSchema>;
export type ModelAdmissionSettlementV1 = z.infer<typeof modelAdmissionSettlementSchema>;
export type ModelAdmissionConnectionV1 = z.infer<typeof modelAdmissionConnectionSchema>;
export type ModelAdmissionRuntimeV1 = z.infer<typeof modelAdmissionRuntimeSchema>;
export type ModelAdmissionClaimV1 = z.infer<typeof modelAdmissionClaimSchema>;
export type ModelAdmissionApi = {
  reserve: (request: ModelAdmissionRequestV1) => Result<ModelAdmissionRecordV1>;
  claimSend: (callId: string) => Result<ModelAdmissionClaimV1>;
  settle: (settlement: ModelAdmissionSettlementV1) => Result<ModelAdmissionRecordV1>;
  observe: (observation: ModelQuotaObservationV1) => Result<ModelQuotaObservationV1>;
  inspect: (accountRef: string) => Result<ModelAdmissionStoreViewV1>;
  inspectPending: (accountRef: string) => Result<readonly ModelAdmissionRecordV1[]>;
  resumePending: (accountRef: string, callKey: string) => Result<ModelAdmissionRecordV1>;
};
export const modelAdmissionSchemaInventory = {
  ModelQuotaWindowV1: modelQuotaWindowSchema, ModelQuotaObservationV1: modelQuotaObservationSchema,
  ModelAdmissionWorkV1: modelAdmissionWorkSchema, ModelAdmissionLedgerV1: modelAdmissionLedgerSchema,
  ModelAdmissionInputV1: modelAdmissionInputSchema, ModelAdmissionDecisionV1: modelAdmissionDecisionSchema,
  ModelAdmissionRequestV1: modelAdmissionRequestSchema, ModelAdmissionRecordV1: modelAdmissionRecordSchema,
  ModelAdmissionStoreViewV1: modelAdmissionStoreViewSchema, ModelAdmissionSettlementV1: modelAdmissionSettlementSchema,
  ModelAdmissionConnectionV1: modelAdmissionConnectionSchema, ModelAdmissionRuntimeV1: modelAdmissionRuntimeSchema,
  ModelAdmissionClaimV1: modelAdmissionClaimSchema
};
