import { z } from "zod";
import { digestSchema, instantSchema, uuidSchema } from "./primitives.js";
import type { UUID } from "./primitives.js";
import { coverageSchema, sourceStatusSchema } from "./sources.js";
import type { CapabilityManifest, SourceStatus } from "./sources.js";

export const sourceIdSchema = uuidSchema;
export const isoInstantSchema = instantSchema;
export const observationIdSchema = uuidSchema;
export const syncModeSchema = z.enum(["incremental", "reconcile", "backfill"]);
export const normalizedSourceItemSchema = z.strictObject({
  sourceId: sourceIdSchema,
  partition: z.string().min(1),
  kind: z.string().min(1),
  providerId: z.string().min(1),
  revisionKey: z.string().min(1),
  operation: z.enum(["upsert", "tombstone", "availability_change"]),
  occurredAt: isoInstantSchema.nullable(),
  providerUpdatedAt: isoInstantSchema.nullable(),
  payloadSchema: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  rawBlobId: uuidSchema.nullable(),
  contentHash: digestSchema
});
export const sourceErrorCodeSchema = z.enum([
  "AUTH_REQUIRED", "CONSENT_REQUIRED", "POLICY_BLOCKED", "OS_PERMISSION_REQUIRED", "ACCOUNT_MISMATCH", "CURSOR_EXPIRED",
  "RATE_LIMITED", "QUOTA_EXHAUSTED", "PAYMENT_REQUIRED", "NETWORK_UNAVAILABLE", "PROVIDER_UNAVAILABLE", "SCHEMA_CHANGED",
  "MALFORMED_ITEM", "COVERAGE_INCOMPLETE", "STORAGE_PRESSURE", "LEASE_LOST", "IDENTITY_CONFLICT", "INVALID_INPUT"
]);
export const sourceErrorSchema = z.strictObject({
  code: sourceErrorCodeSchema,
  retryable: z.boolean(),
  retryAt: isoInstantSchema.nullable(),
  incidentId: uuidSchema.nullable(),
  safeMessage: z.string()
});
export const syncReceiptSchema = z.strictObject({
  runId: uuidSchema,
  sourceId: sourceIdSchema,
  mode: syncModeSchema,
  status: z.enum(["completed", "checkpointed", "blocked", "failed"]),
  observationIds: z.array(observationIdSchema),
  inserted: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  tombstones: z.number().int().nonnegative(),
  quarantined: z.number().int().nonnegative(),
  moreWork: z.boolean(),
  checkedAt: isoInstantSchema,
  coverage: coverageSchema,
  error: sourceErrorSchema.nullable()
});
export const toySourcesStatusInputV1Schema = z.strictObject({
  source_ids: z.array(sourceIdSchema).optional(),
  include_coverage: z.boolean().optional()
});
export const toySourcesStatusDataV1Schema = z.strictObject({
  sources: z.array(sourceStatusSchema),
  checked_at: isoInstantSchema
});
export const toySourcesStatusErrorV1Schema = z.strictObject({
  module: z.literal("sources"),
  code: sourceErrorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
  incidentId: uuidSchema.optional()
});
export const toySourcesStatusResultV1Schema = z.union([
  z.strictObject({ ok: z.literal(true), data: toySourcesStatusDataV1Schema }),
  z.strictObject({ ok: z.literal(false), error: toySourcesStatusErrorV1Schema })
]);

export type SourceId = z.infer<typeof sourceIdSchema>;
export type ISOInstant = z.infer<typeof isoInstantSchema>;
export type ObservationId = z.infer<typeof observationIdSchema>;
export type SyncMode = z.infer<typeof syncModeSchema>;
export type NormalizedSourceItem = z.infer<typeof normalizedSourceItemSchema>;
export type SourceErrorCode = z.infer<typeof sourceErrorCodeSchema>;
export type SourceError = z.infer<typeof sourceErrorSchema>;
export type SyncReceipt = z.infer<typeof syncReceiptSchema>;
export type ToySourcesStatusInputV1 = z.infer<typeof toySourcesStatusInputV1Schema>;
export type ToySourcesStatusDataV1 = z.infer<typeof toySourcesStatusDataV1Schema>;
export type ToySourcesStatusErrorV1 = z.infer<typeof toySourcesStatusErrorV1Schema>;
export type ToySourcesStatusResultV1 = z.infer<typeof toySourcesStatusResultV1Schema>;

export const bootstrapReferenceSchemaInventory = {
  SyncMode: syncModeSchema,
  NormalizedSourceItem: normalizedSourceItemSchema,
  SourceErrorCode: sourceErrorCodeSchema,
  SourceError: sourceErrorSchema,
  SyncReceipt: syncReceiptSchema,
  ToySourcesStatusInputV1: toySourcesStatusInputV1Schema,
  ToySourcesStatusDataV1: toySourcesStatusDataV1Schema,
  ToySourcesStatusErrorV1: toySourcesStatusErrorV1Schema,
  ToySourcesStatusResultV1: toySourcesStatusResultV1Schema
};

export interface R0AdapterContext {
  readonly abortSignal: AbortSignal;
  remainingMs(): number;
  now(): ISOInstant;
}

export interface R0ConnectionValidation {
  valid: boolean;
  accountLabel: string | null;
  checkedAt: ISOInstant;
  reasonCode: string | null;
}

export interface R0PartitionDefinition {
  partition: string;
}

export interface R0CoverageWarning {
  code: string;
  safeMessage: string;
}

export interface R0RevocationReceipt {
  provider: string;
  revokedAt: ISOInstant;
}

export interface R0AdapterPage {
  items: NormalizedSourceItem[];
  nextCursor: Uint8Array | null;
  finalCheckpoint: Uint8Array | null;
  exhausted: boolean;
  authoritativeSnapshot: boolean;
  snapshotScopeHash: string | null;
  providerCheckedAt: ISOInstant;
  warnings: R0CoverageWarning[];
}

export interface SourceAdapterR0 {
  readonly provider: string;
  readonly version: string;
  capabilities(): CapabilityManifest;
  validateConnection(ctx: R0AdapterContext): Promise<R0ConnectionValidation>;
  enumeratePartitions(ctx: R0AdapterContext): AsyncIterable<R0PartitionDefinition>;
  readPage(
    ctx: R0AdapterContext,
    request: {
      partition: R0PartitionDefinition;
      mode: SyncMode;
      cursor: Uint8Array | null;
      snapshotId: UUID | null;
      pageBudgetBytes: number;
    }
  ): Promise<R0AdapterPage>;
  reconcile(ctx: R0AdapterContext, partition: R0PartitionDefinition): AsyncIterable<R0AdapterPage>;
  revoke?(ctx: R0AdapterContext): Promise<R0RevocationReceipt>;
}

export interface Sources {
  sync(sourceId: SourceId, options?: { mode?: SyncMode; requestId?: UUID; budgetMs?: number }): Promise<SyncReceipt>;
  status(sourceId: SourceId): Promise<SourceStatus>;
  inventory(): Promise<SourceStatus[]>;
}
