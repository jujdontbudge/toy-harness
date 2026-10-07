# ADR 0050: R0.10 Durable cadence owner floor

Status: accepted for bounded implementation. Scope is limited to `AT-hermes-config-69` and `AT-activity-focus-86`.

## Decision

Implement the smallest real persistence boundary needed to prove the R0 cadence ownership gate. Durable admission/Turn Review is the sole writer role for `toy_si.cadence_slot`, `toy_si.run`, and `toy_si.review`. Obligations reads a reconstructible projection and has no write path. This gate is not a claim that the full scheduler, Hermes run lifecycle, judge, accepted-review persistence, or seven-day cadence trial is complete.

The database source remains `toy` with objects in `toy_si`. The exact slot states are `scheduled`, `running`, `swept`, `reviewed`, `deferred_quota`, `deferred_auth`, `deferred_network`, `deferred_busy`, `maintenance`, `failed`, `missed`, and `coalesced_after_outage`. The generated enum is the source for the SQL constraint and every coverage-count key. `toy_si_durable_owner` is the sole operational writer role, not the SQL object owner; the existing disposable-fixture migration administrator owns the objects and is explicitly outside the production-role claim.

## Generated contract floor

Add schemas to `packages/contracts/src/durable-cadence.ts` and generate the normal `@toy/contracts` artifacts. Do not edit generated output by hand.

- `CadenceSlotState` is the exact twelve-value enum above, generated once and imported by both modules.
- `CadenceSlotRefV1`: `jobKey: string`, `slotAt: Instant`.
- `ExperimentalSlotSweepV1`: `armId: UUID`, `index: number` constrained to `0..3359`; the operation receives no caller-supplied policy or target state.
- `CadenceSlotV1`: `jobKey: string`, `slotAt: Instant`, `state: CadenceSlotState`, `runId: UUID | null`, `reviewId: UUID | null`, `reason: string | null`, `startedAt: Instant | null`, `inferenceDoneAt: Instant | null`, `reviewedAt: Instant | null`, `updatedAt: Instant`.
- `CadenceProjectionQueryV1`: `jobKey: string | null`, `from: Instant`, `to: Instant`; validate `from < to`.
- `CadenceProjectionV1`: `slots: CadenceSlotV1[]`, `counts: Record<CadenceSlotState, UInt64String>`, `acceptedAiReviewed: UInt64String`, `swept: UInt64String`. Count an AI review only for a `reviewed` slot with a non-null `reviewId` resolving to an immutable canonical review; count `swept` separately.
- `CadenceSourceFileV1`: `path: string`, `contents: string`; `CadenceSourceGateInputV1`: `files: CadenceSourceFileV1[]`; `CadenceSourceGateResultV1`: `accepted`, `reasonCodes`, `writerFiles`, `expectedStates`, and `sqlStates`. The source-gate input is a typed snapshot of authored package TS/TSX/MTS/CTS/JS/JSX/MJS/CJS and SQL files, excluding compiled `dist` and external `node_modules`.
- `RunRefV1` has exactly the nine §3 fields: `runId: UUID`, `principalId: PrincipalId`, `profile: "toy"`, `sessionId: string`, `taskId: string | null`, `turnId: string | null`, `contractId: UUID`, `contractVersion: number`, `generation: Revision`.
- `AdmissionInputV1` is the narrow scheduled-admission input: `principalId: PrincipalId`, `profile: "toy"`, `surface: string`, `admissionKey: string`, `payloadHash: Sha256`, `sessionId: string`, `taskId: string | null`, `turnId: string | null`, `contractId: UUID`, `contractVersion: number`, `generation: Revision`, `releaseHash: Sha256`, `budgetGroupId: UUID`, and `scheduledSlot: CadenceSlotRefV1`. The owner creates `runId` and sets `root_run_id = runId`; neither is caller-supplied. This input exercises only scheduled admission, not the general §6 admission pipeline.
- `ReviewV1` retains the complete §3 shape: `id`, `run`, `processingState: "reviewed"`, `verdict`, `criterionResults`, `remainingActions`, `dependencyIds`, `incidentIds`, `evidenceHighWater`, `rubricHash`, `judgePromptHash`, `releaseHash`, `reason`, `stopDisposition`, `humanReason`, `patternMatches`, `lookupAuditRef`, `conversationSnapshotHash`, `judgeCallId`, `noProgressCount`, and `reviewedAt`, with the canonical §3 field types. `ReviewResultV1` is exactly `{ state: "reviewed"; review: ReviewV1 } | { state: "pending"; run: RunRefV1; reason: "awaiting_terminal" | "awaiting_evidence" | "judge_unavailable" | "judge_invalid" | "quota" | "superseded" | "control_unavailable"; retryAt: Instant | null }`. Pending is not a Review and cannot link a cadence slot.

## Public interfaces and module direction

Declare the service interface types in the canonical `@toy/contracts` source, following `CapacityTrialJournalApi`; the implementations import these types and define no exported DTO/interface copies. In the existing Self-Improvement owner, implement only the paths needed by these gates:

```ts
interface DurableCadenceTestApi {
  startArm(input: CapacityTrialArmV1): Result<CapacityTrialReportV1>;
  sweepExperimentalSlot(input: ExperimentalSlotSweepV1): Result<CapacityTrialSlotV1>;
  deferSlot(input: CapacityTrialDeferralV1): Result<CapacityTrialSlotV1>;
  reconcileArm(armId: UUID): Result<CapacityTrialReportV1>;
  reportArm(armId: UUID): Result<CapacityTrialReportV1>;
  slot(armId: UUID, index: number): Result<CapacityTrialSlotV1>;
  admitScheduled(input: AdmissionInputV1): Result<RunRefV1>;
  reviewResult(runId: UUID): Result<ReviewResultV1>;
  readSlots(query: CadenceProjectionQueryV1): Result<CadenceSlotV1[]>;
  readProjection(query: CadenceProjectionQueryV1): Result<CadenceProjectionV1>;
  roleProof(): Result<CadenceRoleProofV1>;
  reviewCount(): Result<UInt64String>;
  sourceSnapshot(): Result<CadenceSourceGateInputV1>;
  sourceGate(input?: CadenceSourceGateInputV1): Result<CadenceSourceGateResultV1>;
}

interface DurableCadenceOwner {
  withTest<Data>(context: OpsControlContextV1, run: (api: DurableCadenceTestApi) => Result<Data> | Promise<Result<Data>>): Promise<Result<Data>>;
}

interface CadenceProjectionReader {
  readSlots(query: CadenceProjectionQueryV1): Result<CadenceSlotV1[]>;
}

interface ObligationsCadenceProjection {
  readSlots(query: CadenceProjectionQueryV1, reader: CadenceProjectionReader): Result<CadenceProjectionV1>;
}
```

`withTest` retains the existing ready fake-clock/fake-model fixture guard. Its SQL owner operations use real PostgreSQL transactions and effective roles. `startArm` writes arm metadata and all 3,360 scheduled rows atomically. `sweepExperimentalSlot(input)` reads the persisted arm and slot; it may change only a scheduled experimental slot whose persisted `aiEverySeconds` policy says that index requires no AI. It accepts no caller-supplied policy or target state. `admitScheduled` atomically inserts a non-trial fixture slot as `scheduled` if absent, inserts one gate-floor run, binds that slot to the run and changes it to `running`, then inserts canonical `review_work` as `pending`. If the slot exists, it must be unbound and scheduled. Identical `(profile, surface, admissionKey)` plus payload returns the same run; changed payload conflicts before any slot mutation. The operation creates test-floor slot metadata only and proves no production native-anchor admission. `reviewResult` reconstructs pending from `review_work` when no terminal evidence or accepted review exists. Neither method synthesizes terminal evidence or a Review.

`sourceSnapshot()` reads the actual checkout through the owner’s bounded filesystem inventory. `sourceGate(input)` validates that typed snapshot and candidate snapshots supplied by the CLI fault case. The probe changes only in-memory candidate contents, then runs those candidates through the same public gate; it never edits repository files.

`reviewCount()` reads the actual canonical review table under the operational role. The CLI records zero before and after the owner operations, so an unexpected retained accepted review fails the gate. Review-result wire branches use strict objects with disjoint literal states; the supported generated union preserves their exclusivity.

The existing `CapacityTrialJournal` public interface remains the compatibility entry point for the four trial regressions; its operations become a thin call into the same owner API and contain no slot SQL. The owner owns arm creation plus its 3,360 slot inserts in one transaction, deferral, miss reconciliation and readback. The existing trial schema/guard SQL remains unchanged.

The broader §3 methods `heartbeat`, `terminal`, `TurnReview.checkStop`, and `TurnReview.review` are explicitly deferred; no success stub or public accepted-review store is added. `toy_si.review` stays empty in these probes. The operational role's `SELECT/INSERT` capability is reserved for the deferred protected commit path; this unit adds no review INSERT caller or accepted-review persistence site. No caller-supplied model argument can create a review. Accepted-review persistence remains pending until the trusted path is implemented.

Obligations keeps the projection in its existing public surface. Its read-only `readSlots(query, source)` applies the requested job/time filter and computes separate state counts, linked reviewed coverage and swept coverage; deleting this implementation would move nontrivial projection logic into the Self-Improvement caller. The real Self-Improvement source adapter queries the SQL view under the reader role. This follows `architecture/modules.json`: Self-Improvement may depend on Obligations; Obligations must not import Self-Improvement internals or SQL.

## Database floor and role proof

Apply the existing `capacity-trial` migration first, unchanged, then apply exactly one generated `durable-cadence` migration through the existing `toy new migration` path after the parent integrates that name into the generator's finite allowlist. The existing migration remains the sole `CREATE TABLE` definition for `capacity_trial_arm` and `cadence_slot`, the twelve-state constraint, and both original trial guards. The new migration's one source definition creates gate-floor `run`, canonical `review`, and `review_work`; adds cadence foreign keys and state-shape constraints; replaces only the arm-bound outcome check (locating that predicate from `pg_constraint`, not dropping other checks by guessed name) to permit a `swept` candidate for a dedicated native trigger to validate; creates roles/grants and the Obligations view. It alters the existing cadence table; it does not create a second slot table or repeat the capacity migration DDL. The generated SQL/descriptor are artifacts, not separate authored definitions. The owner applies the ordered migration chain before any arm creation; arm metadata and its 3,360 slot inserts remain one later transaction.

- `cadence_slot`: preserve existing primary key `(job_key, slot_at)`, exact twelve-state check, trial-slot uniqueness/binding and identity/deletion/outcome guard. Add `run_id → toy_si.run(id)` and `review_id → toy_si.review(id)` foreign keys with `ON DELETE RESTRICT`; require `running` to have a run/start time and `reviewed` to have a run, review and reviewed time. Require `swept` to have no run/review/inference/reviewed-time link. Replace only the old arm-bound state check with the same fake-arm/no-reference restrictions plus `swept`; a new trigger permits arm-bound `swept` only when the persisted arm manifest says `designation='experimental'` and `trial_slot_index % (aiEverySeconds / 180) <> 0`. It also requires all run/review/inference/reviewed-time references to remain null. The same trigger rejects non-arm `swept` writes in this floor because no non-trial schedule-policy row exists yet. The existing `protect_trial_slot` identity and scheduled-to-terminal immutability guard remains installed and unchanged.
- `run`: gate-floor fields are `id uuid PK`, `principal_id uuid NOT NULL`, `parent_run_id uuid NULL`, `root_run_id uuid NOT NULL`, `profile text NOT NULL CHECK (profile='toy')`, `surface text NOT NULL`, `admission_key text NOT NULL`, `payload_hash text NOT NULL`, `session_id text NOT NULL`, nullable `task_id`/`turn_id`, `contract_id uuid NOT NULL`, `contract_version integer NOT NULL CHECK (>=0)`, `generation bigint NOT NULL CHECK (>=0)`, `release_hash text NOT NULL`, `budget_group_id uuid NOT NULL`, `state text NOT NULL CHECK (state='admitted')`, `lease_epoch bigint NOT NULL CHECK (>=0)`, `last_event_seq bigint NOT NULL CHECK (>=0)`, and `admitted_at timestamptz NOT NULL`. For this top-level fixture run, the owner sets `parent_run_id=NULL` and `root_run_id=id`. Enforce canonical lowercase SHA-256 constraints on payload/release digests and unique `(profile, surface, admission_key)`. This is not the complete §5.2 run schema.
- `review`: use the canonical immutable §5.2 review columns and `UNIQUE (run_id, attempt)`, all required fields non-null as specified; do not add nullable verdict/body fields, pending-review rows or a test-only verdict. `review_work` holds the canonical pending state from §5.2 and §6.2.
- `toy_si_durable_owner`: `NOLOGIN` operational role, not object owner. It receives cadence slot `SELECT/INSERT/UPDATE`; run `SELECT/INSERT`; review `SELECT/INSERT`; review_work `SELECT/INSERT/UPDATE`; and test-arm metadata `SELECT/INSERT`. It receives no `DELETE` on these relations. A database trigger rejects review `UPDATE/DELETE`; the gate separately proves the operational role's catalog privileges. The fixture migration administrator retains object ownership and is not counted as an operational writer.
- `toy_si_obligations_reader`: `NOLOGIN`, receives `SELECT` on the view and no direct table privileges. Revoke table privileges from `PUBLIC`.

Every API query sets `SET LOCAL ROLE` in the same SQL transaction as its read/write. `accountingQuery` launches a fresh `psql` process per call, so role-setting in a prior call is not evidence. The CLI probe uses the existing private PostgreSQL 17 fixture, exercises the owner API, reads the view through the reader role, checks `current_user` and effective catalog privileges, and attempts actual INSERT/UPDATE/DELETE on all three base tables under the reader role. Each attempt must fail with PostgreSQL insufficient-privilege evidence; strings or source labels alone do not pass. This proves fixture database-role behavior only; it does not prove how production service credentials obtain these roles.

The fixture initializes the `toy_si` model-admission migration, but this repository has no `identity.principals` schema migration. The disposable gate-floor `run` therefore keeps `principal_id` typed as UUID without inventing an Authority/identity table or claiming the canonical FK. The full §5.2 run schema and `identity.principals` FK remain a production prerequisite owned by the real identity schema. The existing accounting `budget_group` is also not asserted to be the canonical Self-Improvement budget table. The test-floor slot metadata and its chosen time are not evidence of a persisted production native schedule anchor. The floor is a schema/ownership proof only.

## Capacity trial routing

Keep `capacity_trial_arm` as immutable test-arm metadata. Leave the existing migration SQL and its generated migration source unchanged. Move all cadence-slot DML out of `CapacityTrialJournal` and into `DurableCadenceOwner`; route its `startArm`, experimental `sweepExperimentalSlot`, deferral, missed-slot reconciliation and readback through that owner. The owner creates arm metadata and all 3,360 bound slots atomically. The association remains `(arm_id, trial_slot_index)` on the sole canonical slot table, deriving each slot time from the persisted anchor at 180-second intervals. No trial-slot table or alternate cadence writer is added.

Preserve the current arm binding trigger and trial-slot identity/outcome guards. Trial manifests remain `fake_model` only; trial rows never carry run, review, inference, or reviewed-time references. The additive arm-state-check replacement plus native trigger allows a swept transition only for a persisted experimental policy index that does not require AI; original arms and experimental AI-required indices reject it. Non-arm sweep writes are deferred until a persisted native schedule policy exists. A separate non-trial owner-floor slot exercises scheduled run admission and remains `running` with pending `review_work`. The CLI must call the public owner sweep, then the real Obligations projection. With no trusted accepted review, readback must show `swept = 1`, `acceptedAiReviewed = 0`, and `reviewed = 0`; the required-AI slot remains `running`, never `reviewed`.

## CLI cases and limits

Add manifests only for `AT-hermes-config-69` and `AT-activity-focus-86`, both at their assigned CLI rung. The shared case is `durable-cadence-owner-floor` in phase `durable-cadence-owner-floor`; it emits `cadence.contract-enum`, `cadence.owner-run-pending`, `cadence.obligations-readonly-projection`, `cadence.reader-write-denials`, `cadence.source-gate`, and `cadence.coverage-distinction`. The six checks prove generated/SQL enum equality; real owner slot/run write and pending-work readback; read-only projection readback; all nine reader-role table write denials; injected competing-writer and missing/extra-state mutations rejected by the public source gate; and swept/reviewed separation. `AT-hermes-config-69` also retains its required disposable-stack evidence. The probe reads the baseline from the actual checkout and submits in-memory candidate source snapshots through the bounded typed source-gate seam; it does not edit source files. Do not add `AT-obligations-82` or other ATs to this unit.

The four affected trial regressions remain parent-run: `AT-ops-47`, `AT-self-improvement-59`, `AT-self-improvement-60`, and `AT-RESEARCH-REGISTER-6`. These and the two assigned ATs are distinct from the still-pending seven-day original-policy trial. No source inspection or schema-floor pass marks either assigned AT complete.

The six CheckView IDs have one declaration in `durableCadenceCheckInventory` in the canonical contracts registry. Both the producer and the CLI observation allowlist use it; an independent unregistered list cannot be supplied by this probe.

## Evidence basis

The assigned assertions/rungs are in `tests/acceptance-index.json` lines 113–122 and 665–674. Self-Improvement lines 97–107 define the exact nine-field RunRef; lines 145–183 define immutable Review and the pending/reviewed result union; lines 423–455 define the canonical owner tables; lines 524–536 define write ownership; lines 592–615 define pending admission and scheduled binding; lines 1561–1563 define cadence coverage. Obligations §13.6 lines 2104–2114 and CONTRACTS lines 269–272 and 303–307 define the exact states and projection ownership. Existing trial direct writes are in `capacity-trial.ts` lines 65–68, 80–81 and 92–93; its current migration plus immutable trial guards are in `capacity-trial-migration.ts` and `migrations/capacity-trial.sql`. The existing generator's finite migration names are in `engineering-control.ts` lines 993–1033. `accounting-postgres.ts` runs each query in one transaction and initializes the disposable fixture.
