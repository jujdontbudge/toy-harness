import { z } from "zod";
import { observationEvidenceRefSchema, recordRefSchema } from "../../control-evidence.js";
import { instantSchema, revisionSchema, uuidSchema } from "../../primitives.js";

const versionSchema = z.literal("toy.obligations.v1");
const requestKeySchema = z.string().min(1).max(200);
const expectedRevisionSchema = revisionSchema.max(19);
const dateSchema = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
const clockSchema = z.string().regex(/^[0-9]{2}:[0-9]{2}:[0-9]{2}$/);
const localDateTimeSchema = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$/);
const timezoneSchema = z.string().min(1).max(100);
const evidenceSchema = z.array(observationEvidenceRefSchema).min(1).max(20);
const completionReceiptRefsSchema = z.array(recordRefSchema).max(20);

const uniqueArraySchema = <Schema extends z.ZodType>(schema: Schema, min: number, max: number) =>
  z.array(schema).min(min).max(max)
    .refine((values) => new Set(values).size === values.length)
    .meta({ uniqueItems: true });

const uniqueUuidArraySchema = (min: number, max: number) => uniqueArraySchema(uuidSchema, min, max);
const timeSpecSchema = z.union([
  z.strictObject({ kind: z.literal("instant"), at: instantSchema }),
  z.strictObject({
    kind: z.literal("local"), date: dateSchema, time: clockSchema, timezone: timezoneSchema,
    disambiguation: z.enum(["earlier", "later", "reject"])
  }),
  z.strictObject({
    kind: z.literal("relative"), anchor_observation_id: uuidSchema,
    amount: z.int().min(1).max(315360000),
    unit: z.enum(["seconds", "minutes", "hours", "calendar_days", "business_days"]),
    timezone: timezoneSchema, business_calendar: z.string().min(1).max(100).nullable()
  })
]);

const deadlineSchema = z.union([
  z.strictObject({ kind: z.literal("instant"), at: instantSchema, hardness: z.enum(["hard", "soft"]) }),
  z.strictObject({ kind: z.literal("date"), date: dateSchema, timezone: timezoneSchema, hardness: z.enum(["hard", "soft"]) })
]);

const dependenciesSchema = z.strictObject({ mode: z.enum(["all", "any"]), ids: uniqueUuidArraySchema(1, 32) });
const recurrenceSchema = z.strictObject({
  dtstart_local: localDateTimeSchema, timezone: timezoneSchema, rrule: z.string().min(1).max(2000),
  rdates_local: uniqueArraySchema(localDateTimeSchema, 0, 366),
  exdates_local: uniqueArraySchema(localDateTimeSchema, 0, 366),
  deadline_offset_seconds: z.int().min(0).max(315360000).nullable()
});

const intentProperties = {
  title: z.string().min(1).max(500),
  kind: z.enum(["task", "wait", "deadline", "event_prompt", "routine"]),
  owner: z.enum(["johan", "toy"]),
  next_action: z.string().min(1).max(2000).nullable(),
  priority: z.int().min(1).max(3),
  phase: z.enum(["actionable", "waiting", "deferred", "paused", "needs_clarification"]),
  next_action_at: timeSpecSchema.nullable(),
  deadline: deadlineSchema.nullable(),
  dependencies: dependenciesSchema.nullable(),
  recurrence: recurrenceSchema.nullable(),
  calendar: z.enum(["default", "off"]),
  interpretation_note: z.string().min(1).max(2000).nullable()
};

const intentSchema = z.strictObject(intentProperties);
const patchSchema = z.strictObject(intentProperties).partial()
  .refine((patch) => Object.keys(patch).length > 0)
  .meta({ minProperties: 1 });

const commonMutationShape = {
  schema_version: versionSchema,
  request_key: requestKeySchema,
  commitment_id: uuidSchema,
  expected_revision: expectedRevisionSchema
};

export const toyCaptureParametersSchema = z.union([
  z.strictObject({
    schema_version: versionSchema, request_key: requestKeySchema, mode: z.literal("create"),
    claim_key: requestKeySchema, evidence: evidenceSchema, intent: intentSchema
  }),
  z.strictObject({
    ...commonMutationShape, mode: z.literal("amend"), evidence: evidenceSchema, patch: patchSchema
  }),
  z.strictObject({
    ...commonMutationShape, mode: z.literal("attach"), claim_key: requestKeySchema, evidence: evidenceSchema
  })
]);

export const toyDueParametersSchema = z.strictObject({
  schema_version: versionSchema,
  now: instantSchema.nullable().optional(),
  view: z.enum(["due", "open", "waiting", "upcoming", "by_id", "resolved"]),
  ids: uniqueUuidArraySchema(0, 100).optional(),
  owner: z.enum(["johan", "toy", "all"]).optional(),
  through: instantSchema.nullable().optional(),
  limit: z.int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(4096).nullable().optional()
});

export const toyResolveParametersSchema = z.strictObject({
  ...commonMutationShape,
  outcome: z.enum(["done", "dropped"]),
  scope: z.enum(["item", "series"]),
  evidence: evidenceSchema,
  completion_receipt_refs: completionReceiptRefsSchema,
  reason: z.string().min(1).max(2000)
});

const deferCommonShape = {
  ...commonMutationShape,
  scope: z.enum(["item", "series"]),
  reason: z.string().min(1).max(2000),
  evidence: evidenceSchema,
  restart_action: z.string().min(1).max(2000).nullable()
};

export const toyDeferParametersSchema = z.union([
  z.strictObject({ ...deferCommonShape, mode: z.literal("until"), until: timeSpecSchema }),
  z.strictObject({ ...deferCommonShape, mode: z.literal("dependency"), dependencies: dependenciesSchema, fallback_at: timeSpecSchema })
]);

export const toySatisfyParametersSchema = z.strictObject({
  schema_version: versionSchema,
  request_key: requestKeySchema,
  dependency_id: uuidSchema,
  expected_dependency_revision: expectedRevisionSchema,
  evidence: evidenceSchema
});

export const obligationToolParameters = {
  toy_capture: toyCaptureParametersSchema,
  toy_due: toyDueParametersSchema,
  toy_resolve: toyResolveParametersSchema,
  toy_defer: toyDeferParametersSchema,
  toy_satisfy: toySatisfyParametersSchema
};

export const obligationToolSchemaInventory = {
  ToyCaptureParametersV1: toyCaptureParametersSchema,
  ToyDueParametersV1: toyDueParametersSchema,
  ToyResolveParametersV1: toyResolveParametersSchema,
  ToyDeferParametersV1: toyDeferParametersSchema,
  ToySatisfyParametersV1: toySatisfyParametersSchema
};
