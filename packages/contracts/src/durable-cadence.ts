import { z } from "zod";
import { cadenceSlotStateSchema, digestSchema, instantSchema, revisionSchema, uint64Schema, uuidSchema } from "./primitives.js";
import { recordRefSchema } from "./control-evidence.js";
import type { CapacityTrialJournalApi, CapacityTrialSlotV1 } from "./capacity-trial.js";
import type { Result } from "./ops.js";
import type { UUID } from "./primitives.js";

export const cadenceSlotRefV1Schema = z.strictObject({ jobKey: z.string(), slotAt: instantSchema });
export const experimentalSlotSweepV1Schema = z.strictObject({ armId: uuidSchema, index: z.int().min(0).max(3359) });
export const cadenceSlotV1Schema = z.strictObject({
  jobKey: z.string(), slotAt: instantSchema, state: cadenceSlotStateSchema,
  runId: uuidSchema.nullable(), reviewId: uuidSchema.nullable(), reason: z.string().nullable(),
  startedAt: instantSchema.nullable(), inferenceDoneAt: instantSchema.nullable(), reviewedAt: instantSchema.nullable(), updatedAt: instantSchema
});
export const cadenceProjectionQueryV1Schema = z.strictObject({ jobKey: z.string().nullable(), from: instantSchema, to: instantSchema })
  .refine(query => Date.parse(query.from) < Date.parse(query.to));
export const cadenceProjectionV1Schema = z.strictObject({
  slots: z.array(cadenceSlotV1Schema), counts: z.record(cadenceSlotStateSchema, uint64Schema),
  acceptedAiReviewed: uint64Schema, swept: uint64Schema
});
export const runRefV1Schema = z.strictObject({
  runId: uuidSchema, principalId: uuidSchema, profile: z.literal("toy"), sessionId: z.string(),
  taskId: z.string().nullable(), turnId: z.string().nullable(), contractId: uuidSchema,
  contractVersion: z.int().nonnegative(), generation: revisionSchema
});
export const admissionInputV1Schema = z.strictObject({
  principalId: uuidSchema, profile: z.literal("toy"), surface: z.string().min(1),
  admissionKey: z.string().min(1), payloadHash: digestSchema, sessionId: z.string().min(1),
  taskId: z.string().nullable(), turnId: z.string().nullable(), contractId: uuidSchema,
  contractVersion: z.int().nonnegative(), generation: revisionSchema, releaseHash: digestSchema,
  budgetGroupId: uuidSchema, scheduledSlot: cadenceSlotRefV1Schema
});
export const criterionResultV1Schema = z.strictObject({
  criterionId: z.string(), state: z.enum(["passed", "failed", "unknown", "not_applicable"]),
  evidenceIds: z.array(uuidSchema), explanation: z.string()
});
export const remainingActionV1Schema = z.strictObject({
  id: z.string(), criterionIds: z.array(z.string()), description: z.string(),
  capabilityId: z.string().nullable(), authorityClass: z.string(), executableNow: z.boolean(), dependencyId: uuidSchema.nullable()
});
export const reviewVerdictSchema = z.enum(["complete", "continue", "waiting", "blocked", "failed"]);
export const reviewV1Schema = z.strictObject({
  id: uuidSchema, run: runRefV1Schema, processingState: z.literal("reviewed"), verdict: reviewVerdictSchema,
  criterionResults: z.array(criterionResultV1Schema), remainingActions: z.array(remainingActionV1Schema),
  dependencyIds: z.array(uuidSchema), incidentIds: z.array(uuidSchema), evidenceHighWater: revisionSchema,
  rubricHash: digestSchema, judgePromptHash: digestSchema, releaseHash: digestSchema, reason: z.string(),
  stopDisposition: z.enum(["finish", "continue", "human_step", "wait", "recover", "cancelled"]),
  humanReason: z.enum(["physical_interaction", "authority_approval", "costly_ambiguity"]).nullable(),
  patternMatches: z.array(z.string()), lookupAuditRef: recordRefSchema, conversationSnapshotHash: digestSchema,
  judgeCallId: uuidSchema.nullable(), noProgressCount: z.int().nonnegative(), reviewedAt: instantSchema
});
export const reviewResultV1Schema = z.union([
  z.strictObject({ state: z.literal("reviewed"), review: reviewV1Schema }),
  z.strictObject({
    state: z.literal("pending"), run: runRefV1Schema,
    reason: z.enum(["awaiting_terminal", "awaiting_evidence", "judge_unavailable", "judge_invalid", "quota", "superseded", "control_unavailable"]),
    retryAt: instantSchema.nullable()
  })
]);
export const admissionReadbackV1Schema = z.strictObject({
  run: runRefV1Schema, payloadHash: digestSchema, scheduledSlot: cadenceSlotRefV1Schema.nullable(),
  slotState: cadenceSlotStateSchema.nullable(), pendingWork: z.boolean()
});
export const cadenceRoleTableSchema = z.enum(["cadence_slot", "run", "review"]);
export const cadenceRolePrivilegeV1Schema = z.strictObject({ select: z.boolean(), insert: z.boolean(), update: z.boolean(), delete: z.boolean() });
export const cadenceRoleDenialV1Schema = z.strictObject({
  table: cadenceRoleTableSchema, operation: z.enum(["INSERT", "UPDATE", "DELETE"]), sqlState: z.literal("42501")
});
export const cadenceRoleProofV1Schema = z.strictObject({
  ownerEffectiveRole: z.string(), readerEffectiveRole: z.string(), readerCanSelectProjection: z.boolean(),
  ownerPrivileges: z.record(cadenceRoleTableSchema, cadenceRolePrivilegeV1Schema),
  readerPrivileges: z.record(cadenceRoleTableSchema, cadenceRolePrivilegeV1Schema),
  readerWriteDenials: z.array(cadenceRoleDenialV1Schema).length(9)
});
export const cadenceSourceFileV1Schema = z.strictObject({ path: z.string().min(1).max(500), contents: z.string().max(2000000) });
export const cadenceSourceGateInputV1Schema = z.strictObject({ files: z.array(cadenceSourceFileV1Schema).min(1).max(1000) });
export const cadenceSourceGateResultV1Schema = z.strictObject({
  accepted: z.boolean(), reasonCodes: z.array(z.enum(["CADENCE_ENUM_MISMATCH", "CADENCE_OWNER_WRITE_MISSING", "CADENCE_COMPETING_WRITER", "SOURCE_INVENTORY_EMPTY"])),
  writerFiles: z.array(z.string()), expectedStates: z.array(z.string()), sqlStates: z.array(z.string())
});

export type CadenceSlotRefV1 = z.infer<typeof cadenceSlotRefV1Schema>;
export type ExperimentalSlotSweepV1 = z.infer<typeof experimentalSlotSweepV1Schema>;
export type CadenceSlotV1 = z.infer<typeof cadenceSlotV1Schema>;
export type CadenceProjectionQueryV1 = z.infer<typeof cadenceProjectionQueryV1Schema>;
export type CadenceProjectionV1 = z.infer<typeof cadenceProjectionV1Schema>;
export type RunRefV1 = z.infer<typeof runRefV1Schema>;
export type AdmissionInputV1 = z.infer<typeof admissionInputV1Schema>;
export type ReviewV1 = z.infer<typeof reviewV1Schema>;
export type ReviewResultV1 = z.infer<typeof reviewResultV1Schema>;
export type AdmissionReadbackV1 = z.infer<typeof admissionReadbackV1Schema>;
export type CadenceRoleTableV1 = z.infer<typeof cadenceRoleTableSchema>;
export type CadenceRolePrivilegeV1 = z.infer<typeof cadenceRolePrivilegeV1Schema>;
export type CadenceRoleDenialV1 = z.infer<typeof cadenceRoleDenialV1Schema>;
export type CadenceRoleProofV1 = z.infer<typeof cadenceRoleProofV1Schema>;
export type CadenceSourceFileV1 = z.infer<typeof cadenceSourceFileV1Schema>;
export type CadenceSourceGateInputV1 = z.infer<typeof cadenceSourceGateInputV1Schema>;
export type CadenceSourceGateResultV1 = z.infer<typeof cadenceSourceGateResultV1Schema>;
export type CadenceProjectionReader = {
  readSlots: (query: CadenceProjectionQueryV1) => Result<CadenceSlotV1[]>;
};
export type DurableCadenceTestApi = CapacityTrialJournalApi & {
  sweepExperimentalSlot: (input: ExperimentalSlotSweepV1) => Result<CapacityTrialSlotV1>;
  admitScheduled: (input: AdmissionInputV1) => Result<RunRefV1>;
  reviewResult: (runId: UUID) => Result<ReviewResultV1>;
  readSlots: (query: CadenceProjectionQueryV1) => Result<CadenceSlotV1[]>;
  readProjection: (query: CadenceProjectionQueryV1) => Result<CadenceProjectionV1>;
  roleProof: () => Result<CadenceRoleProofV1>;
  reviewCount: () => Result<CadenceProjectionV1["acceptedAiReviewed"]>;
  sourceSnapshot: () => Result<CadenceSourceGateInputV1>;
  sourceGate: (input?: CadenceSourceGateInputV1) => Result<CadenceSourceGateResultV1>;
};
export const durableCadenceSchemaInventory = {
  CadenceSlotRefV1: cadenceSlotRefV1Schema, ExperimentalSlotSweepV1: experimentalSlotSweepV1Schema,
  CadenceSlotV1: cadenceSlotV1Schema, CadenceProjectionQueryV1: cadenceProjectionQueryV1Schema,
  CadenceProjectionV1: cadenceProjectionV1Schema, RunRefV1: runRefV1Schema, AdmissionInputV1: admissionInputV1Schema,
  CriterionResultV1: criterionResultV1Schema, RemainingActionV1: remainingActionV1Schema, ReviewV1: reviewV1Schema,
  ReviewResultV1: reviewResultV1Schema, AdmissionReadbackV1: admissionReadbackV1Schema, CadenceRoleProofV1: cadenceRoleProofV1Schema,
  CadenceSourceFileV1: cadenceSourceFileV1Schema, CadenceSourceGateInputV1: cadenceSourceGateInputV1Schema,
  CadenceSourceGateResultV1: cadenceSourceGateResultV1Schema
};
