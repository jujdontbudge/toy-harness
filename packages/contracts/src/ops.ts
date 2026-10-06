import { z } from "zod";
import { cadenceSlotStateSchema, digestSchema, instantSchema, releaseSchema, revisionSchema, uint64Schema, uuidSchema } from "./primitives.js";
import { acceptanceStateSchema, capabilityViewSchema, checkViewSchema, evidenceLinksSchema, recordRefSchema, secretReadinessSchema } from "./control-evidence.js";
import { serviceIdSchema } from "./ops-registry.js";
import { sourceStatusSchema } from "./sources.js";
import { attentionSnapshotSchema } from "./attention.js";
import { releaseStatusSchema } from "./publisher.js";
import { cliEnvironmentSchema } from "./cli-declarations.js";

export const serviceStatusSchema = z.strictObject({
  id: serviceIdSchema, state: z.enum(["ready", "degraded", "starting", "parked", "unavailable", "unknown"]),
  launchdDomain: z.string().min(1).max(100), launchdLabel: z.string().min(1).max(160), uid: z.int().nonnegative(),
  pid: z.int().positive().nullable(), bootId: uuidSchema, releaseId: digestSchema.nullable(), checkedAt: instantSchema,
  lastProgressAt: instantSchema.nullable(), reasonCode: z.string().max(2000).nullable()
});
export const backupDestinationStatusSchema = z.strictObject({
  destination: z.enum(["external", "b2"]), lastCompleteSetId: uuidSchema.nullable(), lastCompleteAt: instantSchema.nullable(),
  criticalStateAgeSeconds: z.number().nonnegative().nullable(), fullStateAgeSeconds: z.number().nonnegative().nullable(),
  lastVerifiedRestoreAt: instantSchema.nullable(), state: z.enum(["healthy", "stale", "missing", "blocked", "unknown"])
});
export const quotaWindowSchema = z.strictObject({
  limitId: z.string().min(1).max(160), label: z.string().min(1).max(200), windowDurationMins: z.number().positive().nullable(),
  usedPercent: z.number().nonnegative().nullable(), resetsAt: instantSchema.nullable()
});
export const subscriptionStatusSchema = z.strictObject({
  provider: z.enum(["openai", "anthropic"]), source: z.string().max(2000), fetchedAt: instantSchema.nullable(),
  state: z.enum(["known", "stale", "unavailable"]), windows: z.array(quotaWindowSchema),
  paidUsageAllowed: z.literal(false), noOverageVerifiedAt: instantSchema.nullable()
});
export const opsStatusSchema = z.strictObject({
  generatedAt: instantSchema, services: z.array(serviceStatusSchema), backups: z.array(backupDestinationStatusSchema),
  subscriptions: z.array(subscriptionStatusSchema), currentRelease: digestSchema.nullable(), rollbackRelease: digestSchema.nullable(),
  diskAvailableBytes: revisionSchema, memoryPressure: z.enum(["normal", "warning", "critical", "unknown"]),
  reviewSlots: z.strictObject({ periodStart: instantSchema, scheduled: z.int().nonnegative(), admitted: z.int().nonnegative(),
    inferenceDone: z.int().nonnegative(), reviewed: z.int().nonnegative(), deferred: z.int().nonnegative(), missed: z.int().nonnegative() }),
  incidentIds: z.array(uuidSchema)
});
export const quotaAdmissionViewSchema = z.strictObject({
  subscriptions: z.array(subscriptionStatusSchema), checkedAt: instantSchema, laneBusy: z.boolean(),
  reservedCalls: uint64Schema, unknownCalls: uint64Schema, autonomousAllowed: z.boolean(), optionalEvaluationAllowed: z.boolean(),
  pauseReason: z.string().max(2000).nullable(), fallbackJobCount: uint64Schema.nullable(), paidUsageAllowed: z.literal(false)
});
export const cadencePeriodSchema = z.strictObject({
  from: instantSchema, to: instantSchema, clock: z.enum(["real", "exact_cadence", "projected_behavior", "fake_model"]),
  armId: uuidSchema.nullable(), experimental: z.boolean(), nominalSlots: uint64Schema,
  counts: z.record(cadenceSlotStateSchema, uint64Schema), complete: z.boolean()
});
export const cadenceCoverageSchema = z.strictObject({
  policyDigest: digestSchema, requiredAiEverySeconds: z.literal(180), periods: z.array(cadencePeriodSchema), pendingRunRefs: z.array(recordRefSchema)
});
export const doctorReportSchema = z.strictObject({
  requiredRelease: releaseSchema, deep: z.boolean(), checks: z.array(checkViewSchema), verdict: acceptanceStateSchema,
  complete: z.boolean(), links: evidenceLinksSchema
});
export const controlStatusInputSchema = z.strictObject({ release: releaseSchema.optional() });
export const doctorInputSchema = z.strictObject({ release: releaseSchema.optional(), deep: z.boolean() });
export const sourceHealthSchema = z.strictObject({
  items: z.array(sourceStatusSchema), latestSyncRefs: z.array(recordRefSchema), capabilities: z.array(capabilityViewSchema),
  evaluatedAt: instantSchema, complete: z.boolean()
});
export const controlStatusSchema = z.strictObject({
  requiredRelease: releaseSchema, ops: opsStatusSchema.nullable(), probes: z.array(checkViewSchema), sources: sourceHealthSchema.nullable(),
  attention: attentionSnapshotSchema.nullable(), quota: quotaAdmissionViewSchema.nullable(), cadence: cadenceCoverageSchema.nullable(),
  release: releaseStatusSchema.nullable(), secrets: z.array(secretReadinessSchema), capabilities: z.array(capabilityViewSchema), complete: z.boolean()
});
export const opsControlContextSchema = z.strictObject({
  environment: cliEnvironmentSchema, invocationId: uuidSchema, timeoutMs: z.int().min(1000).max(120000)
});
export const operationRefSchema = z.strictObject({
  operationId: uuidSchema, state: z.enum(["queued", "running", "succeeded", "failed", "blocked"]), acceptedAt: instantSchema
});
export const opsErrorCodeSchema = z.enum([
  "INVALID_INPUT", "UNAUTHORIZED", "CONFLICT", "DEPENDENCY_UNAVAILABLE", "MEMORY_PRESSURE", "DISK_PRESSURE",
  "SECRET_UNAVAILABLE", "SECRET_REVOKED", "BACKUP_DESTINATION_MISSING", "BACKUP_INCOMPLETE", "INCOMPATIBLE_SCHEMA",
  "ARTIFACT_MISMATCH", "ATTESTATION_INVALID", "TIMEOUT"
]);
export const opsErrorMessages = {
  INVALID_INPUT: "The invocation does not match the registered command schema.",
  UNAUTHORIZED: "The calling identity is not authorized for this operation.",
  CONFLICT: "The request conflicts with the recorded operation or artifact.",
  DEPENDENCY_UNAVAILABLE: "The required installed owner or launcher is unavailable.",
  MEMORY_PRESSURE: "Measured memory admission does not permit this operation.",
  DISK_PRESSURE: "Measured disk admission does not permit this operation.",
  SECRET_UNAVAILABLE: "The required secret is unavailable to the authorized owner.",
  SECRET_REVOKED: "The required secret has been revoked.",
  BACKUP_DESTINATION_MISSING: "The registered backup destination is unavailable.",
  BACKUP_INCOMPLETE: "The required backup evidence is incomplete.",
  INCOMPATIBLE_SCHEMA: "The installed schema is incompatible with this operation.",
  ARTIFACT_MISMATCH: "The required artifact does not match its recorded identity.",
  ATTESTATION_INVALID: "The environment attestation is missing or invalid.",
  TIMEOUT: "The bounded owner operation timed out; reconcile its recorded state."
} as const satisfies Record<z.infer<typeof opsErrorCodeSchema>, string>;
export const opsErrorExitCodes = {
  INVALID_INPUT: 2, UNAUTHORIZED: 3, CONFLICT: 4, DEPENDENCY_UNAVAILABLE: 5, MEMORY_PRESSURE: 6, DISK_PRESSURE: 6,
  SECRET_UNAVAILABLE: 5, SECRET_REVOKED: 5, BACKUP_DESTINATION_MISSING: 5, BACKUP_INCOMPLETE: 5,
  INCOMPATIBLE_SCHEMA: 4, ARTIFACT_MISMATCH: 4, ATTESTATION_INVALID: 5, TIMEOUT: 7
} as const satisfies Record<z.infer<typeof opsErrorCodeSchema>, number>;
export const opsSafeMessageSchema = z.enum(Object.values(opsErrorMessages));
export const opsErrorSchema = z.strictObject({
  module: z.literal("ops"), code: opsErrorCodeSchema, retryable: z.boolean(), incidentId: uuidSchema.optional(), message: opsSafeMessageSchema,
  effectState: z.enum(["none", "confirmed", "unknown"]).optional()
});
export const opsResultSchema = <Schema extends z.ZodType>(data: Schema) => z.union([
  z.strictObject({ ok: z.literal(true), data }), z.strictObject({ ok: z.literal(false), error: opsErrorSchema })
]);
export type OpsErrorCode = z.infer<typeof opsErrorCodeSchema>;
export type OpsError = z.infer<typeof opsErrorSchema>;
export type Result<Data> = { ok: true; data: Data } | { ok: false; error: OpsError };
export type ServiceStatus = z.infer<typeof serviceStatusSchema>;
export type BackupDestinationStatus = z.infer<typeof backupDestinationStatusSchema>;
export type QuotaWindow = z.infer<typeof quotaWindowSchema>;
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;
export type OpsStatus = z.infer<typeof opsStatusSchema>;
export type QuotaAdmissionViewV1 = z.infer<typeof quotaAdmissionViewSchema>;
export type CadenceSlotState = z.infer<typeof cadenceSlotStateSchema>;
export type CadencePeriodV1 = z.infer<typeof cadencePeriodSchema>;
export type CadenceCoverageV1 = z.infer<typeof cadenceCoverageSchema>;
export type DoctorReportV1 = z.infer<typeof doctorReportSchema>;
export type ControlStatusInputV1 = z.infer<typeof controlStatusInputSchema>;
export type DoctorInputV1 = z.infer<typeof doctorInputSchema>;
export type SourceHealthV1 = z.infer<typeof sourceHealthSchema>;
export type ControlStatusV1 = z.infer<typeof controlStatusSchema>;
export type OpsControlContextV1 = z.infer<typeof opsControlContextSchema>;
export type OperationRef = z.infer<typeof operationRefSchema>;
export const opsSchemaInventory = {
  ServiceStatus: serviceStatusSchema, BackupDestinationStatus: backupDestinationStatusSchema, QuotaWindow: quotaWindowSchema,
  SubscriptionStatus: subscriptionStatusSchema, OpsStatus: opsStatusSchema, QuotaAdmissionViewV1: quotaAdmissionViewSchema,
  CadenceSlotState: cadenceSlotStateSchema, CadencePeriodV1: cadencePeriodSchema, CadenceCoverageV1: cadenceCoverageSchema,
  DoctorReportV1: doctorReportSchema, ControlStatusInputV1: controlStatusInputSchema, DoctorInputV1: doctorInputSchema,
  SourceHealthV1: sourceHealthSchema, ControlStatusV1: controlStatusSchema, OpsControlContextV1: opsControlContextSchema,
  OperationRef: operationRefSchema, OpsErrorCode: opsErrorCodeSchema, OpsSafeMessage: opsSafeMessageSchema, OpsError: opsErrorSchema
};
