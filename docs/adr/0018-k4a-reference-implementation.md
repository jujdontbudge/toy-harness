# ADR 0018: R0.K4a reference implementation

Status: reference contracts frozen; runtime receipts pending the parent-owned K3 fixture transport. Date: 2026-10-05.

## Scope

This card provides one source adapter reference, one thin owner tool, the existing local `toy-control` skill reference, and one disposable Ops migration artifact. It does not implement Sources coordination or ingestion, Obligations behavior, provider activation, a Hermes installation, or production migration behavior. The four references remain feasibility-only until the K3 parent records their protected registrations and public CLI receipts.

The source fixture is named `toy-k4a-empty`, uses `authKind: "none"`, has no permitted hosts or requested scopes, and returns an empty read page. It observes cancellation, the injected remaining-time budget, and the injected clock. It receives no credential, does not perform network I/O, and cannot write or delete provider data. The registered probe must invoke the adapter only through the parent-owned fake-only fixture transport.

The public `SourceAdapterR0` keeps the `SourceAdapter` method set from `specs/sources.md` §4 and is explicitly limited to the K4a feasibility reference. `R0AdapterContext` has only the cancellation, remaining-budget, and injected-clock capabilities this no-I/O fixture needs; it is not a second production `AdapterContext`. A later production adapter must extend this same owner surface when its complete context is accepted. The R0 page/context helper types are in-process owner contracts; wire DTOs (`SourceId`, `ISOInstant`, `SyncMode`, `NormalizedSourceItem`, `SourceError`, `SyncReceipt`, and the status-tool request/data/result) are declared in `packages/contracts/src/bootstrap-references.ts` for the parent to add to the generated inventory. The status tool uses the existing generated `SourceStatus` and common JSON envelope. `include_coverage` is accepted as declared; `SourceStatus.coverage` remains present because it is required by the canonical DTO.

The canonical tool is `toy_sources_status` in the existing `toy` plugin/toolset. It calls only the public `Sources.inventory()` operation and returns its selected rows with the injected clock value. Its source reference does not install the plugin or change the Hermes profile.

The local skill is the already recorded `skills/toy-control/SKILL.md` bundle at version `1.0.0`. Its exact digest is retained in the evidence manifest; this card does not republish it or change the adjacent feature map.

The migration reference belongs to Ops and creates one namespaced marker table in the `main` schema of the parent-owned private disposable SQLite database. The migration descriptor marks it test-only and non-production. The parent-owned K3 transport may apply it only to that private database and verify persistence through the public probe receipt. The reference does not open or modify `ops.db`, the bootstrap journal, or any fixed local store, and it has no automatic down operation.

## Frozen contract names

The generated additions are `SourceId`, `ISOInstant`, `ObservationId`, `SyncMode`, `NormalizedSourceItem`, `SourceErrorCode`, `SourceError`, `SyncReceipt`, `ToySourcesStatusInputV1`, `ToySourcesStatusDataV1`, `ToySourcesStatusErrorV1`, and `ToySourcesStatusResultV1`. Existing generated `UUID`, `Instant`, `SourceStatus`, `CapabilityManifest`, and CLI/probe DTOs remain the source of truth for their members. The parent owns adding the new schema inventory to the canonical public package and generated artifacts.

The Python adapter accepts the generated `ToySourcesStatusInputV1`, calls the public owner inventory, and emits the generated `ToySourcesStatusResultV1`. It contains no copied DTO declarations and no tool-side source state.

## Registration and acceptance boundary

Artifact registrations are bound by `build/evidence/R0.K4a/reference-implementation.json`. Protected test-world, provider, probe, and case IDs are owned by K3 and remain pending until the parent records them. The parent also records public `toy` CLI run/show receipts for the fixed test case. No direct module call, SQL assertion, private helper, simulated UID, or fixed production journal is an acceptance substitute.

R0.K4a acceptance is limited to the four named feasibility references, their frozen source/schema/registration digests, and compilation through each public boundary. The R0 static follow-on remains `AT-hermes-config-101` and `AT-cli-7/8`. Full generator behavior `AT-cli-25–27` and required future SIM cases remain pending their assigned later release. Actual installed identity and launcher conditions remain pending R0.04–05; this ADR makes no identity, launcher, stack, or runtime-pass claim.
