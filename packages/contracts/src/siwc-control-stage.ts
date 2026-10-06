import { z } from "zod";
import { digestSchema, instantSchema, uint64Schema, uuidSchema } from "./primitives.js";
import { roleBootstrapRoot } from "./identity-bootstrap.js";

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
export const siwcControlRuntimeReceiptSchema = z.strictObject({
  requestId: uuidSchema, uid: z.int().nonnegative(), euid: z.int().nonnegative(), gid: z.int().nonnegative(), egid: z.int().nonnegative(),
  groups: z.array(z.int().nonnegative()).max(128), moduleImported: z.boolean(),
  keychainState: z.enum(["not_called", "absent", "present", "unavailable"]), helperExitCode: z.int().nullable(), helperTerminated: z.boolean()
});
export const siwcControlRuntimeBackupSchema = z.strictObject({
  schemaVersion: z.literal("toy.siwc-control-runtime-backup.v1"), requestId: uuidSchema, observedAt: instantSchema,
  artifactDigest: digestSchema, childDigest: digestSchema, bootstrapReceiptDigest: digestSchema,
  parents: z.array(z.strictObject({
    path: z.enum([roleBootstrapRoot + "/control", roleBootstrapRoot + "/control/releases"]),
    uid: z.literal(0), gid: z.literal(0), mode: z.literal("0700"), device: uint64Schema, inode: uint64Schema
  })).length(2)
}).refine(value => new Set(value.parents.map(parent => parent.path)).size === 2, "Fixed parents appear once");
export const siwcControlRuntimeReportSchema = z.strictObject({
  schemaVersion: z.literal("toy.siwc-control-runtime-report.v1"), requestId: uuidSchema, observedAt: instantSchema,
  artifactDigest: digestSchema, state: z.enum(["verified", "restored", "blocked"]),
  reason: z.enum(["CONTROL_RUNTIME_READ_VERIFIED", "PARENTS_RESTORED", "ROOT_CALLER_REQUIRED", "CONTROL_RUNTIME_UNAVAILABLE", "CONTROL_KEYCHAIN_READ_UNAVAILABLE", "PARENT_RESTORE_FAILED"]),
  callerUid: z.int().nonnegative(), controlUid: z.int().nonnegative().nullable(), controlGid: z.int().nonnegative().nullable(),
  childDigest: digestSchema.nullable(), backupDigest: digestSchema.nullable(), bootstrapReceiptDigest: digestSchema.nullable(),
  artifactVerified: z.boolean(), backupWritten: z.boolean(), parentModesRestored: z.boolean(), bootstrapReceiptUnchanged: z.boolean(),
  child: siwcControlRuntimeReceiptSchema.nullable(), keychainCalled: z.boolean(), credentialBytesCaptured: z.literal(false),
  credentialWritten: z.literal(false), currentPointerChanged: z.literal(false), servicesActivated: z.literal(false),
  liveProviderSends: z.literal(0), acceptanceComplete: z.literal(false)
}).refine(value => value.keychainCalled === (value.child !== null && value.child.keychainState !== "not_called"), "Keychain call agrees with the child receipt")
  .refine(value => value.state === "verified" ? value.reason === "CONTROL_RUNTIME_READ_VERIFIED" && value.callerUid === 0
    && value.artifactVerified && value.backupWritten && value.parentModesRestored && value.bootstrapReceiptUnchanged
    && value.childDigest !== null && value.backupDigest !== null && value.bootstrapReceiptDigest !== null && value.child !== null
    && value.child.requestId === value.requestId && value.child.uid === value.controlUid && value.child.euid === value.controlUid
    && value.child.gid === value.controlGid && value.child.egid === value.controlGid && value.child.groups.length === 1
    && value.child.groups[0] === value.controlGid && value.child.moduleImported && !value.child.helperTerminated
    && (value.child.keychainState === "absent" && value.child.helperExitCode === 3 || value.child.keychainState === "present" && value.child.helperExitCode === 0)
    : value.state === "restored" ? value.reason === "PARENTS_RESTORED" && value.callerUid === 0 && value.backupWritten
      && value.parentModesRestored && value.bootstrapReceiptUnchanged && value.backupDigest !== null && value.child === null && !value.keychainCalled
    : value.reason !== "CONTROL_RUNTIME_READ_VERIFIED" && value.reason !== "PARENTS_RESTORED", "Verified state requires actual identity, native read and restoration proof");
export type SiwcControlRuntimeReceiptV1 = z.infer<typeof siwcControlRuntimeReceiptSchema>;
export type SiwcControlRuntimeBackupV1 = z.infer<typeof siwcControlRuntimeBackupSchema>;
export type SiwcControlRuntimeReportV1 = z.infer<typeof siwcControlRuntimeReportSchema>;
export const siwcControlStageSchemaInventory = {
  SiwcControlStageEntryV1: siwcControlStageEntrySchema, SiwcControlStageManifestV1: siwcControlStageManifestSchema,
  SiwcControlStageReportV1: siwcControlStageReportSchema, SiwcControlRuntimeReceiptV1: siwcControlRuntimeReceiptSchema,
  SiwcControlRuntimeBackupV1: siwcControlRuntimeBackupSchema, SiwcControlRuntimeReportV1: siwcControlRuntimeReportSchema
};
