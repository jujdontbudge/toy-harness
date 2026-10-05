import { capabilityManifestSchema } from "@toy/contracts";
import type { R0AdapterContext, R0AdapterPage, R0PartitionDefinition, SourceAdapterR0 } from "@toy/contracts";

const fixturePartition: R0PartitionDefinition = { partition: "empty" };

const ensureActive = (ctx: R0AdapterContext): void => {
  if (ctx.abortSignal.aborted || ctx.remainingMs() <= 0) throw new Error("ADAPTER_CANCELLED_OR_DEADLINE_EXPIRED");
};

const readEmptyPage = (ctx: R0AdapterContext, partition: R0PartitionDefinition): Promise<R0AdapterPage> => {
  ensureActive(ctx);
  if (partition.partition !== fixturePartition.partition) throw new Error("UNKNOWN_FIXTURE_PARTITION");
  return Promise.resolve({
    items: [],
    nextCursor: null,
    finalCheckpoint: null,
    exhausted: true,
    authoritativeSnapshot: false,
    snapshotScopeHash: null,
    providerCheckedAt: ctx.now(),
    warnings: []
  });
};

export const k4aReferenceSourceAdapter: SourceAdapterR0 = {
  provider: "toy-k4a-empty",
  version: "1.0.0",
  capabilities() {
    return capabilityManifestSchema.parse({
      provider: "toy-k4a-empty",
      adapterVersion: "1.0.0",
      apiVersion: null,
      authKind: "none",
      readCapabilities: ["empty_check"],
      deniedOperations: ["write", "delete", "message", "calendar_action", "external_network"],
      requestedScopes: [],
      permittedHosts: [],
      collectionMode: "local_report_only",
      pollSeconds: null,
      staleAfterSeconds: null,
      reconciliationSchedule: null,
      modelUsePolicyId: "k4a.reference.no_model",
      retentionPolicyId: "k4a.reference.transient",
      supportsExplicitDeletion: false,
      supportsCompleteSnapshot: false,
      supportsHistoricalBackfill: false,
      accountValidationFields: [],
      admissionEvidence: []
    });
  },
  validateConnection(ctx) {
    ensureActive(ctx);
    return Promise.resolve({ valid: true, accountLabel: "fixture", checkedAt: ctx.now(), reasonCode: null });
  },
  async *enumeratePartitions(ctx) {
    ensureActive(ctx);
    yield await Promise.resolve(fixturePartition);
  },
  readPage(ctx, request) {
    return readEmptyPage(ctx, request.partition);
  },
  async *reconcile(ctx, partition) {
    yield await readEmptyPage(ctx, partition);
  }
};
