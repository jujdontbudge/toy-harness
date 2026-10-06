import { z } from "zod";
import { digestSchema, instantSchema, uint64Schema, uuidSchema } from "./primitives.js";

const path = z.string().min(1).max(4096).refine(value => !value.startsWith("/") && !/[\u0000-\u001f\u007f]/.test(value) && value.split("/").every(part => part !== "" && part !== "." && part !== ".."));
export const siwcControlStageEntrySchema = z.strictObject({
  path, kind: z.enum(["directory", "file", "link"]), mode: z.enum(["0440", "0550"]),
  bytes: uint64Schema, digest: digestSchema.nullable(), target: z.string().min(1).max(4096).nullable()
}).refine(value => value.kind === "file" ? value.digest !== null && value.target === null : value.kind === "link" ? value.target !== null && value.digest === null && value.bytes === "0" : value.digest === null && value.target === null && value.bytes === "0" && value.mode === "0550", "Artifact kind and content agree");
export const siwcControlStageManifestSchema = z.strictObject({
  schemaVersion: z.literal("toy.siwc-control-stage-manifest.v1"), schemaDigest: digestSchema,
  nodeVersion: z.literal("24.21.0"), pythonVersion: z.literal("3.14.7"), zodVersion: z.literal("4.6.5"),
  sourceLockDigest: digestSchema, entries: z.array(siwcControlStageEntrySchema).min(1).max(12000)
}).refine(value => new Set(value.entries.map(entry => entry.path)).size === value.entries.length, "Artifact paths are unique");
export const siwcControlStageReportSchema = z.strictObject({
  schemaVersion: z.literal("toy.siwc-control-stage-report.v1"), requestId: uuidSchema, observedAt: instantSchema,
  operation: z.enum(["prepare", "stage", "verify"]), state: z.enum(["prepared", "staged", "verified", "blocked"]),
  reason: z.enum(["ARTIFACT_PREPARED", "ROOT_ARTIFACT_STAGED", "ROOT_ARTIFACT_VERIFIED", "ROOT_CALLER_REQUIRED", "ARTIFACT_UNAVAILABLE"]),
  artifactDigest: digestSchema.nullable(), fileCount: z.int().min(0).max(12000), bytes: uint64Schema,
  callerUid: z.int().nonnegative(), controlUid: z.int().nonnegative().nullable(), controlGid: z.int().nonnegative().nullable(),
  finalPath: z.string().max(4096).nullable(), bootstrapReceiptDigest: digestSchema.nullable(),
  relocationVerified: z.boolean(), ownershipVerified: z.boolean(), preservedPartialStage: z.boolean(),
  currentPointerChanged: z.literal(false), servicesActivated: z.literal(false), keychainCalled: z.literal(false),
  liveProviderSends: z.literal(0), acceptanceComplete: z.literal(false)
});
export type SiwcControlStageEntryV1 = z.infer<typeof siwcControlStageEntrySchema>;
export type SiwcControlStageManifestV1 = z.infer<typeof siwcControlStageManifestSchema>;
export type SiwcControlStageReportV1 = z.infer<typeof siwcControlStageReportSchema>;
export const siwcControlStageSchemaInventory = {
  SiwcControlStageEntryV1: siwcControlStageEntrySchema, SiwcControlStageManifestV1: siwcControlStageManifestSchema,
  SiwcControlStageReportV1: siwcControlStageReportSchema
};
