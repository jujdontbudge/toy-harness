# ADR 0018: R0.K4a reference implementation

Status: reference contracts frozen; runtime receipts pending the parent-owned K3 fixture transport. Date: 2026-10-05.

## Scope

This card provides one source adapter reference, one thin owner tool, the existing local `toy-control` skill reference, and one disposable Ops migration artifact. It does not implement Sources coordination or ingestion, Obligations behavior, provider activation, a Hermes installation, or production migration behavior. The four references remain feasibility-only until the K3 parent records their protected registrations and public CLI receipts.

The source fixture is named `toy-k4a-empty`, uses `authKind: "none"`, has no permitted hosts or requested scopes, and returns an empty read page. It observes cancellation, the injected remaining-time budget, and the injected clock. It receives no credential, does not perform network I/O, and cannot write or delete provider data. The registered probe must invoke the adapter only through the parent-owned fake-only fixture transport.

The public `SourceAdapterR0` keeps the `SourceAdapter` method set from `specs/sources.md` §4 and is explicitly limited to the K4a feasibility reference. `R0AdapterContext` has only the cancellation, remaining-budget, and injected-clock capabilities this no-I/O fixture needs; it is not a second production `AdapterContext`. A later production adapter must extend this same owner surface when its complete context is accepted. The R0 page/context helper types are in-process owner contracts; wire DTOs (`SourceId`, `ISOInstant`, `SyncMode`, `NormalizedSourceItem`, `SourceError`, `SyncReceipt`, and the status-tool request/data/result) are declared in `packages/contracts/src/bootstrap-references.ts` for the parent to add to the generated inventory. The status tool uses the existing generated `SourceStatus` and common JSON envelope. `include_coverage` is accepted as declared; `SourceStatus.coverage` remains present because it is required by the canonical DTO.

The verified tool reference is canonical `toy_ops_status`, a TypeScript adapter that calls only the existing public `OpsControlRead.status` operation and returns its generated `ControlStatusV1`. Its fixed CLI case verifies the owned fixture and the unavailable later-owner inventory. The unverified Python `toy_sources_status` prototype was removed from the active tree; its source remains in checkpoint 207a2d2. R1's actual Sources owner and transport will receive its tool through the sole generator. This choice avoids introducing R1 coordination, a second handwritten tool path or an extra protocol into the kitchen. No plugin is installed and the Hermes profile is unchanged.

The local skill is the already recorded `skills/toy-control/SKILL.md` bundle at version `1.0.0`. Its exact digest is retained in the evidence manifest; this card does not republish it or change the adjacent feature map.

The migration reference belongs to Ops and creates one namespaced marker table in the `main` schema of the parent-owned private disposable SQLite database. The migration descriptor marks it test-only and non-production. The parent-owned K3 transport may apply it only to that private database and verify persistence through the public probe receipt. The reference does not open or modify `ops.db`, the bootstrap journal, or any fixed local store, and it has no automatic down operation.

## Frozen contract names

The generated additions are `SourceId`, `ISOInstant`, `ObservationId`, `SyncMode`, `NormalizedSourceItem`, `SourceErrorCode`, `SourceError`, `SyncReceipt`, `ToySourcesStatusInputV1`, `ToySourcesStatusDataV1`, `ToySourcesStatusErrorV1`, and `ToySourcesStatusResultV1`. Existing generated `UUID`, `Instant`, `SourceStatus`, `CapabilityManifest`, and CLI/probe DTOs remain the source of truth for their members. The parent owns adding the new schema inventory to the canonical public package and generated artifacts.

In-process adapter behavior types live in the canonical contracts package and are emitted by TypeScript compilation. UUID/Instant aliases reuse their existing generated primitive artifacts. Generated Sources tool wire DTOs remain available for the R1 owner dependency. The verified TypeScript tool accepts `ControlStatusInputV1` and emits `ControlStatusV1` directly from Ops and stores no owner state.

## Registration and acceptance boundary

The fixed registered cases are `k4a-connector`, `k4a-tool`, `k4a-skill`, and `k4a-migration` under `AT-hermes-config-101`. ReplayEnvironment runs the Sources adapter, actual public Ops tool and local skill checks; Ops owns disposable SQL application/readback and receipt storage. The caller cannot provide a callback, path, SQL, expected outcome or identity. The four case observations bind artifact digests and retain a partial `NOT_IMPLEMENTED` report until K4's whole static assertion passes. Artifact registrations and public `toy` run/show receipts are retained in the K4a evidence. Actual protected evaluator/controller admission remains pending its existing identity cards. No direct module test, private helper, simulated UID, or production journal is an acceptance substitute.

R0.K4a acceptance is limited to the four named feasibility references, their frozen source/schema/registration digests, and compilation through each public boundary. The R0 static follow-on remains `AT-hermes-config-101` and `AT-cli-7/8`. Full generator behavior `AT-cli-25–27` and required future SIM cases remain pending their assigned later release. Actual installed identity and launcher conditions remain pending R0.04–05; this ADR makes no identity, launcher, stack, or runtime-pass claim.
