import { z } from "zod";
import { instantSchema, releaseSchema, uuidSchema } from "./primitives.js";

export const connectionStateSchema = z.enum([
  "unconfigured",
  "auth_required",
  "consent_required",
  "policy_blocked",
  "connecting",
  "backfilling",
  "active",
  "paused",
  "broken",
  "disconnected"
]);
export const healthStateSchema = z.enum(["fresh", "stale", "broken"]);
export const coverageModeSchema = z.enum([
  "api",
  "device_stream",
  "device_export",
  "imported_snapshot",
  "local_report_only",
  "partial",
  "unavailable"
]);
export const coverageExclusionSchema = z.strictObject({
  capability: z.string(),
  reasonCode: z.string()
});
export const coverageGapSchema = z.strictObject({
  partition: z.string(),
  from: instantSchema.nullable(),
  through: instantSchema.nullable(),
  reasonCode: z.string()
});
export const coverageSchema = z.strictObject({
  mode: coverageModeSchema,
  included: z.array(z.string()),
  excluded: z.array(coverageExclusionSchema),
  historicalFrom: instantSchema.nullable(),
  historicalThrough: instantSchema.nullable(),
  historyComplete: z.boolean(),
  gaps: z.array(coverageGapSchema)
});
export const sourceStatusSchema = z.strictObject({
  sourceId: uuidSchema,
  provider: z.string(),
  accountLabel: z.string(),
  connection: connectionStateSchema,
  health: healthStateSchema,
  coverage: coverageSchema,
  lastAttemptAt: instantSchema.nullable(),
  lastSuccessfulCheckAt: instantSchema.nullable(),
  lastObservedChangeAt: instantSchema.nullable(),
  lastReconciledAt: instantSchema.nullable(),
  nextCheckAt: instantSchema.nullable(),
  oldestPendingAt: instantSchema.nullable(),
  freshnessTargetSeconds: z.number().nullable(),
  reasonCode: z.string().nullable(),
  release: releaseSchema,
  deploymentState: z.enum(["planned", "deferred", "validated", "deployed"]),
  repairAction: z.enum([
    "none",
    "retry_scheduled",
    "reconnect",
    "grant_os_permission",
    "institutional_review",
    "provider_permission",
    "supply_export",
    "operator_repair"
  ])
});
export const capabilityManifestSchema = z.strictObject({
  provider: z.string(),
  adapterVersion: z.string(),
  apiVersion: z.string().nullable(),
  authKind: z.enum(["oauth", "api_token", "os_permission", "device_token", "none"]),
  readCapabilities: z.array(z.string()),
  deniedOperations: z.array(z.string()),
  requestedScopes: z.array(z.string()),
  permittedHosts: z.array(z.string()),
  collectionMode: coverageModeSchema,
  pollSeconds: z.number().nullable(),
  staleAfterSeconds: z.number().nullable(),
  reconciliationSchedule: z.string().nullable(),
  modelUsePolicyId: z.string(),
  retentionPolicyId: z.string(),
  supportsExplicitDeletion: z.boolean(),
  supportsCompleteSnapshot: z.boolean(),
  supportsHistoricalBackfill: z.boolean(),
  accountValidationFields: z.array(z.string()),
  admissionEvidence: z.array(z.string())
});

export type ConnectionState = z.infer<typeof connectionStateSchema>;
export type HealthState = z.infer<typeof healthStateSchema>;
export type CoverageMode = z.infer<typeof coverageModeSchema>;
export type CoverageExclusion = z.infer<typeof coverageExclusionSchema>;
export type CoverageGap = z.infer<typeof coverageGapSchema>;
export type Coverage = z.infer<typeof coverageSchema>;
export type SourceStatus = z.infer<typeof sourceStatusSchema>;
export type CapabilityManifest = z.infer<typeof capabilityManifestSchema>;

export const sourceSchemaInventory = {
  ConnectionState: connectionStateSchema,
  HealthState: healthStateSchema,
  CoverageMode: coverageModeSchema,
  CoverageExclusion: coverageExclusionSchema,
  CoverageGap: coverageGapSchema,
  Coverage: coverageSchema,
  SourceStatus: sourceStatusSchema,
  CapabilityManifest: capabilityManifestSchema
};
