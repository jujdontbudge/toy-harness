import { z } from "zod";
import { digestSchema, instantSchema, revisionSchema } from "./primitives.js";
import { checkViewSchema, recordRefSchema } from "./control-evidence.js";

export const publisherCompatibilitySchema = z.strictObject({
  database: z.strictObject({ observed: revisionSchema.nullable(), minimum: revisionSchema.nullable(), maximum: revisionSchema.nullable(), compatible: z.boolean().nullable() }),
  runtime: z.strictObject({ observed: z.string().min(1).max(100).nullable(), minimum: z.string().min(1).max(100).nullable(), maximum: z.string().min(1).max(100).nullable(), compatible: z.boolean().nullable() }),
  state: z.enum(["compatible", "incompatible", "unknown"]), checks: z.array(checkViewSchema), checkedAt: instantSchema
});
export const releaseStatusSchema = z.strictObject({
  currentDigest: digestSchema.nullable(), previousDigest: digestSchema.nullable(), controlDigest: digestSchema.nullable(), targetDigest: digestSchema.nullable(),
  projectionCurrentDigest: digestSchema.nullable(), projectionStale: z.boolean(), compatibility: publisherCompatibilitySchema,
  gates: z.array(checkViewSchema), attestationRefs: z.array(recordRefSchema), operationRefs: z.array(recordRefSchema),
  rollbackEligible: z.boolean(), checkedAt: instantSchema
});
export type PublisherCompatibilityV1 = z.infer<typeof publisherCompatibilitySchema>;
export type ReleaseStatusV1 = z.infer<typeof releaseStatusSchema>;
export const publisherSchemaInventory = { PublisherCompatibilityV1: publisherCompatibilitySchema, ReleaseStatusV1: releaseStatusSchema };
