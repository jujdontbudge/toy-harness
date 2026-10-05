# Diagnostic inventory reconciliation

**Status:** interface design proposal only. No schema, implementation, runtime, or acceptance result is changed by this ADR.

## Finding

`CheckViewV1` and `EvidenceLinksV1` are the right shapes for registered predicate results and references to evidence. They are not a transport for the detail required by CLI §5.1: `CheckViewV1` has one acceptance state and bounded reason/prerequisite text; `EvidenceLinksV1` carries only record/observation references and approved digests. A reference is not a typed readback, and adding owner facts to free-form text or unknown object keys would violate CLI §4.4's recursive strictness.

Existing safe owner reads cover part of the detail: Ops `status()` returns the canonical `OpsStatus`; Sources `cursor()` returns `SourceCursorViewV1`; `RunControlRead.slots()` returns `PageV1<CadenceSlotViewV1>` with requested and observed model settings; and `Obligations.due()` returns `DueResult` with wake health and canonical commitments. `SourceStatus.coverage` already carries included/excluded coverage and gaps, freshness timestamps/targets, backlog age, and auth/consent state. The gap is that `ControlStatusV1` does not compose the cursor/slot/due results, and Ops `ServiceStatus` has no expected artifact, endpoint, or explicit lifecycle measurements. The current references do not make those values recoverable through a generic record read.

## Proposed strict composition

Keep every V1 schema frozen. Introduce a versioned status composition and reuse canonical owner DTOs wherever they already exist. All nullable observations mean “not measured/available”; `false` means a measured negative. Never convert missing data into a positive status.

`ControlStatusV2` keeps the existing fields from `ControlStatusV1`, replacing its nested `ops`, `sources`, and `cadence` values with the V2 owner compositions below and adding `obligations: DueResult | null`. The status owner calls the corresponding safe owner reads. A missing owner result is `null`, has a registered `CheckViewV1` with `BLOCKED` or the measured failure, and makes `complete` false.

Its exact required keys are `{requiredRelease,ops:OpsStatusV2|null,probes:CheckViewV1[],sources:SourceHealthV2|null,attention:AttentionSnapshot|null,quota:QuotaAdmissionViewV1|null,cadence:CadenceCoverageV2|null,obligations:DueResult|null,release:ReleaseStatusV1|null,secrets:SecretReadinessV1[],capabilities:CapabilityViewV1[],complete:boolean}`. Every nested reference resolves to its existing generated canonical owner schema or to one of the strict safe projections defined above.

`OpsStatusV2` keeps the Ops §7 `OpsStatus` fields, with `services: ServiceStatusV2[]`. Each service uses this strict shape:

```ts
interface ServiceStatusV2 {
  id: ServiceId;
  state: HealthState;
  expected: {
    launchdDomain: string | null;
    launchdLabel: string | null;
    uid: number | null;
    releaseId: ReleaseId | null;
    executableDigest: SHA256 | null;
    endpoints: ServiceEndpointExpectationV1[];
  } | null;
  observed: {
    launchdDomain: string | null;
    launchdLabel: string | null;
    uid: number | null;
    pid: number | null;
    bootId: UUID | null;
    releaseId: ReleaseId | null;
    executableDigest: SHA256 | null;
    installed: boolean | null;
    running: boolean | null;
    reachable: boolean | null;
    ready: boolean | null;
    checkedAt: Instant | null;
    lastProgressAt: Instant | null;
    endpoints: ServiceEndpointObservationV1[];
  } | null;
  reasonCode: string | null;
}

interface ServiceEndpointExpectationV1 {
  id: registered-endpoint-id;
  kind: "none" | "stdio" | "inherited-pipe" | "unix-socket" | "loopback-tcp" | "loopback-http" | "tailnet-https";
}

interface ServiceEndpointObservationV1 {
  id: registered-endpoint-id;
  kind: "none" | "stdio" | "inherited-pipe" | "unix-socket" | "loopback-tcp" | "loopback-http" | "tailnet-https";
  installed: boolean | null;
  reachable: boolean | null;
  ready: boolean | null;
  checkedAt: Instant | null;
}
```

`ServiceId`, `ReleaseId`, `SHA256`, `UUID`, `Instant`, and registered endpoint IDs must reference generated Contracts schemas. Endpoint IDs and kinds expose no filesystem path, port, peer address, or credential. The endpoint inventory check fails on an unregistered actual endpoint. The expected side comes only from Ops' protected installed-service manifest; the observed side comes only from an Ops safe read. `observed.checkedAt` compared with `OpsStatusV2.generatedAt` is the observation-age basis; do not store a second derived age. If the manifest or observer is unavailable, use `expected:null` or `observed:null` respectively and preserve the matching prerequisite check. This directly addresses ADR 0005's rule against inventing actual UID/PID/boot observations.

`SourceHealthV2` keeps `items: SourceStatus[]`, `capabilities: CapabilityViewV1[]`, `evaluatedAt`, and `complete`, while replacing opaque latest-sync references with typed safe receipt reads and composing the existing cursor projection:

```ts
interface SourceCapabilityManifestV2 {
  sourceId: SourceId;
  manifest: CapabilityManifest;
}

interface SourceHealthV2 {
  items: SourceStatus[];
  latestSyncReceipts: SyncReceipt[];
  capabilityManifests: SourceCapabilityManifestV2[];
  cursors: SourceCursorViewV1[];
  capabilities: CapabilityViewV1[];
  evaluatedAt: Instant;
  complete: boolean;
}
```

These are generated references to Sources §3.1's `SourceStatus`, `SyncReceipt`, and `CapabilityManifest`, plus the already declared strict CLI §4.4 `SourceCursorViewV1`. Promote that cursor projection into the generated Sources/Contracts public boundary before Ops composes it; implement it through the already specified `SourcesControlRead.cursor(CursorQueryV1, ctx)`. Join a cursor and manifest to inventory by `sourceId`; require `manifest.provider` to agree with the source's `provider`. `SourceStatus.coverage` remains the source data-scope view, while `CapabilityManifest.requestedScopes` remains declared/requested OAuth scope. `ConnectionState` remains the auth/consent state. The manifest does not prove the provider actually granted every requested scope; no actual granted-scope projection is currently declared, so report it as unknown rather than infer it. `oldestPendingAt` is the existing backlog-age fact; no numeric backlog count is invented because Sources §3.1 defines none.

For cadence, `CadenceCoverageV2` preserves the existing policy digest, 180-second requirement, periods, and pending-run references. Each `CadencePeriodV2` preserves every `CadencePeriodV1` field and adds `slotDetails: PageV1<CadenceSlotViewV1>`. This reuses the exact safe slot projection, including canonical requested/observed settings, and bounds large seven-day periods. The page must be queried by the period bounds and the owning cadence/arm identity; `hasMore` and its cursor remain visible, while period counts and the 3,360-opportunity denominator are computed from the complete canonical slot set, not from the first page.

There is one required correlation predicate before this is usable: `CadencePeriodV1` has `armId`, but `CadenceSlotViewV1` and the declared `toy_si.cadence_slot` table do not. The R0 capacity-trial specification requires separate immutable arm IDs. The owner must prove that each period's range uniquely selects one arm, or add a durable arm binding and a versioned slot query/view. It must not label overlapping/unbound slot pages as original or reduced arms. Deterministic tick/sweep health also remains distinct from AI slot counts; the existing `OpsStatus.reviewSlots` daily aggregate is not a typed tick/sweep receipt and cannot substitute for one.

For obligations, extend the existing read-only `DueInput.view` with `oldest_unmet`, defined by the owner as the oldest open commitment ordered by `created_at ASC, id ASC`, and return the existing canonical `DueResult` with `limit: 1`. It already contains `evaluated_at`, `health.wakes`, capture backlog age, and the selected canonical `Commitment` with `created_at`, `next_wake_at`, and deadline fields. Compose that exact result as `ControlStatusV2.obligations`; do not copy commitment fields into an Ops-owned status DTO or select/sort work in the CLI. Register an Obligations-owned check for this read. A `CheckViewV1` reports the predicate; the nested `DueResult` carries its structured detail. A degraded wake state, missing read, or unstable selection cannot be rendered as PASS.

## Wire compatibility and admission

These changes are wire-breaking relative to the strict V1 objects. V1 rejects unknown keys recursively, and old readers cannot safely distinguish newly mandatory detail from an accidental payload change. Add new generated schemas and IDs for `ServiceStatusV2`, `OpsStatusV2`, `SourceHealthV2`, `CadencePeriodV2`, `CadenceCoverageV2`, and `ControlStatusV2`; point the `status` CLI leaf at the V2 payload specialization. If per-slot arm binding is required, add the corresponding versioned slot view/query as well. Keep V1 immutable for any existing consumer or explicitly retire it through the generated registry; do not emit V2 under a V1 `$id`, loosen strict objects, or put facts in `reasonCode`.

The current reads are sufficient as owner truth only for source cursors, slot settings, and due health after the above composition and correlation work. The current Ops status contract is not sufficient for expected/observed deployment detail and needs the strict split above. This is design evidence only: no schema generation, check, runtime, source/service observation, AT, protected owner transport, or R0.K3 acceptance was performed. All corresponding gates remain pending.

## Source references

- `~/Documents/Codex/personal-assistant-harness/specs/cli.md` §§4.4, 5.1–5.2, 5.5–5.6, 6: exact strict V1 payloads and the source/cursor/slot/due read interfaces.
- `~/Documents/Codex/personal-assistant-harness/specs/ops.md` §§5, 7: protected installed-service manifest and current `ServiceStatus`/`OpsStatus` field sets.
- `~/Documents/Codex/personal-assistant-harness/specs/sources.md` §§3.1–3.2, 4: canonical `SourceStatus`, `SyncReceipt`, `CapabilityManifest`, and safe owner operations.
- `~/Documents/Codex/personal-assistant-harness/specs/obligations.md` §§4.3, 4.7, 4.9: `DueResult`, `Commitment`, due ordering, and latency targets.
- `~/Documents/Codex/personal-assistant-harness/specs/self-improvement.md` §§5.3, 5.4, 15.6: authoritative cadence slot record/state and the separate original/reduced R0 trial arms.
- `docs/adr/0005-diagnostic-contracts.md` §§11–15: strict source/ops/cadence invariants and no invented identity observations.
