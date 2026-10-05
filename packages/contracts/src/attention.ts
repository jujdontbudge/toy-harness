import { z } from "zod";
import { digestSchema, instantSchema, revisionSchema, uuidSchema } from "./primitives.js";
import { checkViewSchema, evidenceLinksSchema, observationEvidenceRefSchema, recordRefSchema } from "./control-evidence.js";

export const quietStateSchema = z.enum(["awake", "asleep"]);
export const quietReasonSchema = z.enum(["explicit", "focus", "initial_default"]);
export const quietSourceSchema = z.enum(["user_gn", "user_gm", "user_sleep_control", "sleep_focus", "focus_snapshot", "wearable_confirmation"]);
export const attentionItemStateSchema = z.enum(["active", "snoozed", "waiting_help", "closed"]);
export const attentionPurposeSchema = z.enum(["next_action", "approval_needed", "event_prepare", "event_depart", "event_attend", "deadline", "stuck_rescue", "completion", "incident"]);
export const attentionUrgencySchema = z.enum(["routine", "important", "hard_deadline"]);
export const attentionChannelSchema = z.enum(["discord", "web_push", "expo_push", "app_foreground"]);
export const attentionManualLatchSchema = z.strictObject({
  state: quietStateSchema.nullable(), source: quietSourceSchema.extract(["user_gn", "user_gm", "user_sleep_control"]).nullable(),
  eventId: uuidSchema.nullable(), observedAt: instantSchema.nullable(), explicitUntil: instantSchema.nullable()
});
export const attentionFocusViewSchema = z.strictObject({
  state: quietStateSchema.nullable(), observedAt: instantSchema.nullable(), cycleId: uuidSchema.nullable(),
  manualOverrideCycleId: uuidSchema.nullable()
});
export const attentionGateEventViewSchema = z.strictObject({
  eventId: uuidSchema, state: quietStateSchema, source: quietSourceSchema.exclude(["wearable_confirmation"]),
  observedAt: instantSchema, receivedAt: instantSchema, quietEpoch: revisionSchema,
  disposition: z.enum(["applied", "duplicate", "historical_only", "stale"]), receiptRef: recordRefSchema
});
export const attentionWearableConfirmationSchema = z.strictObject({
  eventId: uuidSchema, state: quietStateSchema, from: instantSchema, to: instantSchema, recordedAt: instantSchema,
  disposition: z.literal("confirmation_only"), observations: z.array(observationEvidenceRefSchema).min(1)
});
export const attentionLocalCancellationSchema = z.strictObject({
  state: z.enum(["not_applicable", "pending", "confirmed"]), quietEpoch: revisionSchema, planGeneration: revisionSchema,
  pendingPlanRefs: z.array(recordRefSchema), confirmedPlanRefs: z.array(recordRefSchema), residualOfflineRisk: z.boolean(),
  checkedAt: instantSchema
});
export const attentionItemViewSchema = z.strictObject({
  id: uuidSchema, commitmentId: uuidSchema, commitmentRevision: revisionSchema, generation: revisionSchema, revision: revisionSchema,
  state: attentionItemStateSchema, purpose: attentionPurposeSchema, urgency: attentionUrgencySchema, requiresResponse: z.boolean(),
  title: z.string().min(1).max(120).nullable(), nextAction: z.string().min(1).max(180).nullable(),
  contentVisibility: z.enum(["permitted", "redacted", "unavailable"]), deadlineAt: instantSchema.nullable(),
  deadlineTimezone: z.string().min(1).max(100).nullable(), snoozedUntil: instantSchema.nullable(), snoozeCrossesDeadline: z.boolean(),
  helpRequestId: uuidSchema.nullable(), helpCheckAt: instantSchema.nullable(), nextAttentionAt: instantSchema.nullable(),
  attentionGeneration: revisionSchema, closedReason: z.enum(["done", "dropped", "no_longer_actionable", "informational_delivered"]).nullable(),
  closedAt: instantSchema.nullable(), createdAt: instantSchema, updatedAt: instantSchema, links: evidenceLinksSchema
});
export const attentionLocalPlanViewSchema = z.strictObject({
  id: uuidSchema, itemId: uuidSchema, itemRevision: revisionSchema, commitmentId: uuidSchema, commitmentRevision: revisionSchema,
  deadlineAt: instantSchema, fireAt: z.array(instantSchema).max(100), expiresAt: instantSchema, generation: revisionSchema, quietEpoch: revisionSchema,
  mode: z.enum(["local_notification", "alarmkit"]), desiredState: z.enum(["armed", "canceled"]),
  deviceState: z.enum(["pending", "armed", "cancellation_pending", "canceled", "permission_denied", "unsupported", "error", "expired"]),
  lastDeviceReceiptAt: instantSchema.nullable(), reasonCode: z.string().max(2000).nullable(), links: evidenceLinksSchema
});
export const attentionItemPageSchema = z.strictObject({
  items: z.array(attentionItemViewSchema).max(100), nextCursor: z.string().min(1).max(512).nullable(), hasMore: z.boolean(),
  watermark: revisionSchema.nullable(), evaluatedAt: instantSchema
});
export const attentionLocalPlanPageSchema = z.strictObject({
  items: z.array(attentionLocalPlanViewSchema).max(100), nextCursor: z.string().min(1).max(512).nullable(), hasMore: z.boolean(),
  watermark: revisionSchema.nullable(), evaluatedAt: instantSchema
});
export const attentionChannelViewSchema = z.strictObject({
  primary: z.enum(["discord", "app"]), channels: z.array(z.strictObject({ channel: attentionChannelSchema, checks: z.array(checkViewSchema) })).max(4)
});
export const attentionSnapshotSchema = z.strictObject({
  ownerId: uuidSchema, evaluatedAt: instantSchema, policyDigest: digestSchema, policyVersion: z.string().min(1).max(100),
  quietState: quietStateSchema, quietReason: quietReasonSchema, quietEpoch: revisionSchema, quietStartedAt: instantSchema.nullable(),
  explicitLatch: attentionManualLatchSchema, focus: attentionFocusViewSchema, staleSince: instantSchema.nullable(), nextRepairAt: instantSchema.nullable(),
  lastAuthenticatedEvent: attentionGateEventViewSchema.nullable(), wearableConfirmation: attentionWearableConfirmationSchema.nullable(),
  localCancellation: attentionLocalCancellationSchema, channels: attentionChannelViewSchema,
  items: attentionItemPageSchema, localPlans: attentionLocalPlanPageSchema, complete: z.boolean()
});
export type QuietState = z.infer<typeof quietStateSchema>;
export type QuietReason = z.infer<typeof quietReasonSchema>;
export type QuietSource = z.infer<typeof quietSourceSchema>;
export type AttentionItemState = z.infer<typeof attentionItemStateSchema>;
export type AttentionPurpose = z.infer<typeof attentionPurposeSchema>;
export type AttentionUrgency = z.infer<typeof attentionUrgencySchema>;
export type AttentionChannel = z.infer<typeof attentionChannelSchema>;
export type AttentionManualLatchV1 = z.infer<typeof attentionManualLatchSchema>;
export type AttentionFocusViewV1 = z.infer<typeof attentionFocusViewSchema>;
export type AttentionGateEventViewV1 = z.infer<typeof attentionGateEventViewSchema>;
export type AttentionWearableConfirmationV1 = z.infer<typeof attentionWearableConfirmationSchema>;
export type AttentionLocalCancellationV1 = z.infer<typeof attentionLocalCancellationSchema>;
export type AttentionItemViewV1 = z.infer<typeof attentionItemViewSchema>;
export type AttentionLocalPlanViewV1 = z.infer<typeof attentionLocalPlanViewSchema>;
export type AttentionItemPageV1 = z.infer<typeof attentionItemPageSchema>;
export type AttentionLocalPlanPageV1 = z.infer<typeof attentionLocalPlanPageSchema>;
export type AttentionChannelViewV1 = z.infer<typeof attentionChannelViewSchema>;
export type AttentionSnapshot = z.infer<typeof attentionSnapshotSchema>;
export const attentionSchemaInventory = {
  QuietState: quietStateSchema, QuietReason: quietReasonSchema, QuietSource: quietSourceSchema, AttentionItemState: attentionItemStateSchema,
  AttentionPurpose: attentionPurposeSchema, AttentionUrgency: attentionUrgencySchema, AttentionChannel: attentionChannelSchema,
  AttentionManualLatchV1: attentionManualLatchSchema, AttentionFocusViewV1: attentionFocusViewSchema,
  AttentionGateEventViewV1: attentionGateEventViewSchema, AttentionWearableConfirmationV1: attentionWearableConfirmationSchema,
  AttentionLocalCancellationV1: attentionLocalCancellationSchema, AttentionItemViewV1: attentionItemViewSchema,
  AttentionLocalPlanViewV1: attentionLocalPlanViewSchema, AttentionItemPageV1: attentionItemPageSchema,
  AttentionLocalPlanPageV1: attentionLocalPlanPageSchema, AttentionChannelViewV1: attentionChannelViewSchema, AttentionSnapshot: attentionSnapshotSchema
};
