import { z } from "zod";
import { digestSchema, instantSchema, uint64Schema, uuidSchema } from "./primitives.js";
import { observationEvidenceRefSchema } from "./control-evidence.js";

export const focusSessionSchema = z.strictObject({
  id: uuidSchema, focusGeneration: uuidSchema, revision: uint64Schema, commitmentId: uuidSchema,
  objective: z.string().min(1), startsAt: instantSchema, endsAt: instantSchema,
  state: z.enum(["scheduled", "active", "paused", "ended", "cancelled"]), ruleSetId: uuidSchema, policyHash: digestSchema
});
export const ingestReceiptSchema = z.strictObject({
  receiptId: uuidSchema, deviceId: uuidSchema, streamId: uuidSchema, committedThroughSeq: uint64Schema,
  committedEventIds: z.array(uuidSchema), observationRefs: z.array(observationEvidenceRefSchema),
  committedWatermark: uint64Schema, serverTime: instantSchema, nextUploadAfterMs: z.number().nonnegative()
});
export type FocusSession = z.infer<typeof focusSessionSchema>;
export type IngestReceipt = z.infer<typeof ingestReceiptSchema>;
export const activityFocusSchemaInventory = { FocusSession: focusSessionSchema, IngestReceipt: ingestReceiptSchema };
