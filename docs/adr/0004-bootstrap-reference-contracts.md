# ADR 0004: R0.K4a bootstrap-reference contracts

Status: preparation only; the four references below are not implemented, exercised, or accepted. Date: 2026-10-04.

This ADR freezes the intended public names and receipt route for R0.K4a planning. It is not evidence that K4a, K3, a provider, the launcher, or any AT works. The companion snapshot is [preparation.json](../../build/evidence/R0.K4a/preparation.json).

## Authority and scope

The binding order is repo `AGENTS.md` and `specs/PRINCIPLES.md`, with `specs/CONTRACTS.md` (including Amendments) authoritative for names. `BUILD-PLAN.md` R0.K4a limits this card to one feasibility-only reference for each of connector, tool, skill, and migration, in addition to K1–K3. The references are the only K4a bootstrap exemptions. They do not activate a connector, change production data, publish a skill, or authorize an R1 feature. K4 must derive the generators from verified references and close the exemptions before R0.01; all later additions use the generators.

`cli.md` says the published-skill registry currently has 17 entries and asks for canonical additions. The later `CONTRACTS.md` Amendments already include both `toy-control` and `toy-gardener`; that canonical-name decision wins. K4a must still record `toy-control` in the generated skill/publication inventory, but it does not introduce a new skill name. The reference must not pull `toy-gardener` or another pattern into the K4a exemption.

The feature map already contains `control.new.connector`, `control.new.tool`, `control.new.skill`, and `control.new.migration`, each linked to `AT-cli-25`. This preparation does not edit that map or create test registrations. The CLI specification assigns the R0 static/template work to `AT-hermes-config-101` and `AT-cli-7/8`; their complete acceptance remains pending K4. The integrated `AT-cli-25–27` behavior remains assigned to later R1 work. This ADR records no AT verdict.

## Shared contract and receipt rules

All DTOs and runtime schemas come from `@toy/contracts`; no reference may hand-copy a DTO or create a second contracts package. For every registered CLI command ID `c`, the CLI contract names are `CliInputV1<c>`, `CliDataV1<c>`, and `CliResultV1<c>`, exposed through the generated command-schema map. The registered probe boundary is `RegisteredProbeInputV1` → `RegisteredProbeOperationV1` / `RegisteredProbeReportV1`; `probe.show` reads the same safe operation state. Probe cases and expectations are selected by a sealed registered manifest, never by caller-supplied code, SQL, fixture bytes, identity, endpoint, or expectation.

Each future reference is exercised from a named disposable test stack through the largest available public surface. The planned command sequence is:

```text
toy --env test stack up --release R0 --request-id <UUID> --world <registered-world-id> --clock fake --model fake --json
toy --env test --stack <returned-stack-UUID> probe run <registered-AT-id> --request-id <UUID> --case <registered-case-id> --wait-ms 120000 --json
toy --env test --stack <returned-stack-UUID> probe show <returned-operation-UUID> --json
toy --env test --stack <returned-stack-UUID> stack down --request-id <UUID> --json
```

The first command and the probe commands depend on K3's compiled `toy` CLI, the existing Ops test-stack/probe owners, and a current attestation for that exact stack. The K4a AT and case IDs are not assigned here; they must come from the protected registered inventory before any command is run. The route yields public `toy.cli.v1` envelopes, with the probe operation and report carrying the binding, manifest digest, and safe evidence links. A stack that is unavailable is not replaced by direct module calls, `psql`, a one-off script, or a private helper.

An unavailable owner returns the registered `NOT_IMPLEMENTED` result; a missing test owner or launcher returns `DEPENDENCY_UNAVAILABLE`. Both are exit 5 and remain pending. There is no fallback to private database access, ambient credentials, direct loopback calls, a simulated UID, a production stack, a live provider, shell escalation, or paid inference. The connector's fake is a registered external-provider seam inside the disposable stack. No credentials or production configuration are needed.

## Four reference plans

| Pattern | Canonical public contract and registration | Planned local reference files | Planned public receipt and limit |
|---|---|---|---|
| Sources connector | Implement the Sources §4 `SourceAdapter` seam with the exact members shown below and shared types `AdapterContext`, `CapabilityManifest`, `ConnectionValidation`, `PartitionDefinition`, `SyncMode`, `AdapterPage`, `NormalizedSourceItem`, `CoverageWarning`, `RevocationReceipt`, `UUID`, and `ISOInstant`. Register one R0 feasibility-only `CapabilityManifest` against a protected test-provider ID; the ID is pending the K3/fixture registry. It is read-only, with `authKind: "none"`, fake-only hosts and an explicit denied-operation list. | Proposed source: `packages/sources/src/adapters/k4a-reference.ts`; fake provider fixture: `tests/fakes/sources/k4a-provider.ts`; manifest registration in the Sources test-world fixture. These are candidate checkout paths, not existing files or runtime registrations. | The registered probe invokes public `Sources.sync(sourceId, {mode, requestId, budgetMs})`, then reads `Sources.status(sourceId)`. The owner receipt is `SyncReceipt` plus `SourceStatus`; the CLI receipt is `RegisteredProbeOperationV1`/`RegisteredProbeReportV1`. The R1 CLI leaf `sources.sync.now` is not the K4a route. No live adapter, OAuth, external network call, or activation is implied. |
| Thin owner tool | Reuse the existing canonical tool `toy_sources_status`, not a new model-tool name. It calls `Sources.inventory()` or `Sources.status(sourceId)` through the public Sources transport. Its declared input is `{source_ids?: UUID[], include_coverage?: boolean}` and its declared data is `{sources: SourceStatus[], checked_at: ISOInstant}` inside the common `{ok:true,data:T}` / `{ok:false,error:{module,code,message,retryable,…}}` envelope. The one plugin registration is `toy` version `1.0.0`, native toolset `toy`; no duplicate provider, plugin, skill, or toolset. | Proposed local source: `python/toy_adapter/sources_tools.py`; generated tool schema target: the existing-plugin `schemas/sources_status.json` from Sources §8.2. The live Hermes profile target remains the documented `~/.hermes/profiles/toy/plugins/toy/` compatibility location and is not written by K4a preparation. | A registered CLI probe calls the thin handler through the selected test transport and validates the generated tool schema and common envelope against the public owner result. Its report uses the shared probe receipt. The full installed Hermes/plugin acceptance remains pending its owner/launcher and R1 integration; this receipt cannot claim that the model tool is deployed. |
| Local skill | Canonical name `toy-control`, version `1.0.0`, from the complete initial skill text in `cli.md` §7. `FEATURE-MAP.md` remains adjacent and unchanged. Add one entry to the verified release skill manifest and generated runtime inventory when that owner exists. `CONTRACTS.md` Amendments already supplies the canonical name. | `skills/toy-control/SKILL.md` is the single local source. The existing `skills/toy-control/FEATURE-MAP.md` is retained as-is. The publisher's manifest path is not named by the current repo interface and remains pending its owner freeze. | A registered CLI probe records the local `SKILL.md` digest and validates its metadata and fixed-command guidance; its output is the shared probe receipt. This is a source/static receipt only: no publication, Hermes load, unrestricted shell, CLI runtime availability, or skill behavior AT is claimed. |
| Disposable owner migration | Use the existing Obligations owner and canonical `obligations.schema_migrations` registry. The public owner calls are `capture(input, ctx)` and `due(input, ctx)`; their request/result types remain the generated `CaptureInput`, `DueInput`, and owner result schemas. The existing CLI generator boundary is `EngineeringControl.generate(GeneratorInputV1, ctx)` → `GeneratorPlanV1` / `GeneratorReceiptV1`; the migration generator records owner, order, checksum, and compatibility but never applies a migration. | Proposed source: `packages/obligations/migrations/0001-k4a-reference.sql`; registration through the Obligations migration inventory and its `schema_migrations` table. Exact runner interface and inventory file path remain pending K3/owner freeze. This proposed file only runs against the stack's private `toy` database and disposable schema. | The registered probe asks the owner runner to apply the migration, then verifies persistence and rollback behavior using only Obligations public operations. The owner runner/probe returns safe operation/evidence references; CLI returns the shared probe receipt. No production migration, direct-SQL assertion, automatic down migration, destructive cleanup, or mutation outside the disposable stack is permitted. |

The connector interface is the exact SourceAdapter contract from `specs/sources.md` §4:

```ts
interface SourceAdapter {
  readonly provider: string;
  readonly version: string;

  capabilities(): CapabilityManifest;

  validateConnection(ctx: AdapterContext): Promise<ConnectionValidation>;

  enumeratePartitions(ctx: AdapterContext): AsyncIterable<PartitionDefinition>;

  readPage(
    ctx: AdapterContext,
    request: {
      partition: PartitionDefinition;
      mode: SyncMode;
      cursor: Uint8Array | null;
      snapshotId: UUID | null;
      pageBudgetBytes: number;
    }
  ): Promise<AdapterPage>;

  reconcile(
    ctx: AdapterContext,
    partition: PartitionDefinition
  ): AsyncIterable<AdapterPage>;

  revoke?(ctx: AdapterContext): Promise<RevocationReceipt>;
}

interface AdapterPage {
  items: NormalizedSourceItem[];
  nextCursor: Uint8Array | null;
  finalCheckpoint: Uint8Array | null;
  exhausted: boolean;
  authoritativeSnapshot: boolean;
  snapshotScopeHash: string | null;
  providerCheckedAt: ISOInstant;
  warnings: CoverageWarning[];
}
```

`AdapterContext` carries a credential handle, restricted HTTP client, abort signal/deadline, rate limiter, account binding, safe logger, blob sink, protected policy decision, and current lease generation. The external fake uses `authKind: "none"`, receives no provider secret, and must not read ambient credentials. Its context still follows the canonical `AdapterContext` contract and honors cancellation, deadlines, allowed hosts, and safe logging. The adapter may not write Life Store, schedule Hermes work, or ask the user questions. Sources owns coordination and durable ingestion.

## Required handoff before implementation

The time-bounded source snapshot in the preparation receipt predates the parent K3 edits: at capture, `packages/sources/src/public.ts` exported only `ModuleId`; `packages/contracts/src/public.ts` did not re-export `cli.ts`; `cli/src/main.ts` was the R0.K3 stub; and the local `toy-control/SKILL.md`, connector, tool handler, and migration files did not exist. The parent has since exported CLI schemas and implemented offline help/version/parser behavior. The protected stack/probe route and owner interfaces remain unavailable. These are source observations, not runtime findings. K3's complete frozen owner interfaces and compiled transport route must land first; Sources and Obligations must then expose the owner interfaces through their permitted public packages.

The signed launcher, Ops test-stack attestation, actual-identity denial/positive evidence, and R0.04–05 identity gates are separate prerequisites. They were not probed here. No simulated identity may substitute. When any owner or launcher is absent, preserve the pending status and the fail-closed CLI result rather than adding a fallback. K4a evidence must later include the exact reference and schema digests, registrations, and CLI receipts; this document and its preparation snapshot count for none of those gates.
