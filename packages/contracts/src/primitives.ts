import { z } from "zod";

export const moduleIdSchema = z.enum([
  "contracts", "obligations", "attention", "authority", "sources", "lifestore",
  "hermes", "client", "hands", "self-improvement", "adhd", "ops"
]);
export const releaseSchema = z.enum(["R0", "R1", "R2", "R3", "R4", "R5"]);
export type Release = z.infer<typeof releaseSchema>;
export const cadenceSlotStateSchema = z.enum([
  "scheduled", "running", "swept", "reviewed", "deferred_quota", "deferred_auth", "deferred_network", "deferred_busy",
  "maintenance", "failed", "missed", "coalesced_after_outage"
]);
export type ModuleId = z.infer<typeof moduleIdSchema>;

export const uuidSchema = z.uuid().length(36);
export const digestSchema = z.string().length(64).regex(/^[a-f0-9]{64}(?![\s\S])/);
export const instantSchema = z.iso.datetime({ precision: 3 }).length(24);
export const revisionSchema = z.string().regex(/^(0|[1-9][0-9]*)(?![\s\S])/);
export const uint64Maximum = "18446744073709551615";
export const uint64Schema = revisionSchema.refine((value) => /^(0|[1-9][0-9]*)(?![\s\S])/.test(value) && (value.length < uint64Maximum.length || (value.length === uint64Maximum.length && value <= uint64Maximum)));
export type UUID = z.infer<typeof uuidSchema>;
export type Digest = z.infer<typeof digestSchema>;
export type Instant = z.infer<typeof instantSchema>;
export type Revision = z.infer<typeof revisionSchema>;
export type UInt64String = z.infer<typeof uint64Schema>;
export const primitiveSchemaInventory = {
  ModuleId: moduleIdSchema,
  UUID: uuidSchema,
  Digest: digestSchema,
  Instant: instantSchema,
  Revision: revisionSchema,
  UInt64String: uint64Schema,
  Release: releaseSchema
};
