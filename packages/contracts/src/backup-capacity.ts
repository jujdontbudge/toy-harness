import { z } from "zod";
import { instantSchema, uint64Schema } from "./primitives.js";
import { evidenceLinksSchema } from "./control-evidence.js";

export const backupCapacityInventorySchema = z.strictObject({
  observedAt: instantSchema,
  dataFilesystemPath: z.literal("/System/Volumes/Data"),
  primaryTotalBytes: uint64Schema.nullable(),
  primaryAvailableBytes: uint64Schema.nullable(),
  externalPhysicalDiskCount: z.int().min(0).max(128).nullable(),
  localCapacityState: z.enum(["measured", "unavailable"]),
  externalMetadataState: z.enum(["measured", "unavailable"]),
  independentDestinationCapacityVerified: z.literal(false),
  remoteAccountInspected: z.literal(false),
  restoreVerified: z.literal(false)
});
export const backupCapacityForecastSchema = z.strictObject({
  state: z.enum(["unmeasured", "measured"]), checkedAt: instantSchema, links: evidenceLinksSchema,
  retainedBytes: uint64Schema, dumpBytes: uint64Schema, versionBytes: uint64Schema,
  stagingBytes: uint64Schema, pruneScratchBytes: uint64Schema, restoreWorkspaceBytes: uint64Schema,
  shortGrowthBytesPerDay: uint64Schema, longGrowthBytesPerDay: uint64Schema, horizonDays: uint64Schema
});
export const backupCapacityDestinationSchema = z.strictObject({
  kind: z.enum(["external", "b2", "internal-snapshot"]),
  state: z.enum(["unknown", "missing", "outage", "ready"]),
  availableBytes: uint64Schema.nullable(),
  independentVerified: z.boolean(), policyEligible: z.boolean(), noSpendVerified: z.boolean(),
  escrowVerified: z.boolean(), restoreVerified: z.boolean(),
  checkedAt: instantSchema, links: evidenceLinksSchema
});
export const backupCapacityInputSchema = z.strictObject({
  observedAt: instantSchema, primaryAvailableBytes: uint64Schema.nullable(), stagingWriteBytes: uint64Schema,
  stagingFloorBytes: z.literal("10000000000"),
  forecast: backupCapacityForecastSchema,
  destinations: z.strictObject({
    external: backupCapacityDestinationSchema.extend({ kind: z.literal("external") }),
    b2: backupCapacityDestinationSchema.extend({ kind: z.literal("b2") }),
    internalSnapshot: backupCapacityDestinationSchema.extend({ kind: z.literal("internal-snapshot") })
  })
});
export const backupCapacityReasonSchema = z.enum([
  "INVENTORY_UNPROVEN", "DESTINATION_MISSING", "DESTINATION_OUTAGE", "CAPACITY_EXCEEDED", "INTERNAL_SNAPSHOT",
  "POLICY_UNPROVEN", "NO_SPEND_UNPROVEN", "ESCROW_UNPROVEN", "RESTORE_UNPROVEN", "FORECAST_UNPROVEN", "FORECAST_OVERFLOW"
]);
export const backupCapacityDestinationDecisionSchema = z.strictObject({
  kind: backupCapacityDestinationSchema.shape.kind,
  state: z.enum(["unavailable", "blocked", "eligible-for-testing"]),
  reasons: z.array(backupCapacityReasonSchema), remainingDays: uint64Schema.nullable()
});
export const backupCapacityDecisionSchema = z.strictObject({
  observedAt: instantSchema, verdict: z.enum(["PASS", "FAIL", "INCOMPLETE"]),
  requiredBytes: uint64Schema.nullable(), growthBytesPerDay: uint64Schema.nullable(),
  destinations: z.array(backupCapacityDestinationDecisionSchema).max(3),
  independentDestinationCount: z.int().min(0).max(2),
  disasterRpo: z.enum(["unattainable", "unproven", "eligible-for-testing"]),
  staging: z.enum(["refused", "eligible-for-testing"]),
  pauseLowPriority: z.boolean(),
  gaps: z.array(z.enum(["FORECAST_UNPROVEN", "FORECAST_OVERFLOW", "STAGING_FLOOR", "NONCRITICAL_DISK_FLOOR", "DESTINATION_OUTAGE", "OFFSITE_CAPACITY_UNAVAILABLE"])),
  sealedPartialSets: z.literal("reuse-before-new-staging"),
  deletePermittedData: z.literal(false), purchaseAssumed: z.literal(false), uploadPermitted: z.literal(false),
  deployedCoverageVerified: z.literal(false)
});
export type BackupCapacityInventoryV1 = z.infer<typeof backupCapacityInventorySchema>;
export type BackupCapacityForecastV1 = z.infer<typeof backupCapacityForecastSchema>;
export type BackupCapacityDestinationV1 = z.infer<typeof backupCapacityDestinationSchema>;
export type BackupCapacityInputV1 = z.infer<typeof backupCapacityInputSchema>;
export type BackupCapacityReasonV1 = z.infer<typeof backupCapacityReasonSchema>;
export type BackupCapacityDestinationDecisionV1 = z.infer<typeof backupCapacityDestinationDecisionSchema>;
export type BackupCapacityDecisionV1 = z.infer<typeof backupCapacityDecisionSchema>;
export const backupCapacitySchemaInventory = {
  BackupCapacityInventoryV1: backupCapacityInventorySchema,
  BackupCapacityForecastV1: backupCapacityForecastSchema,
  BackupCapacityDestinationV1: backupCapacityDestinationSchema,
  BackupCapacityInputV1: backupCapacityInputSchema,
  BackupCapacityReasonV1: backupCapacityReasonSchema,
  BackupCapacityDestinationDecisionV1: backupCapacityDestinationDecisionSchema,
  BackupCapacityDecisionV1: backupCapacityDecisionSchema
};
