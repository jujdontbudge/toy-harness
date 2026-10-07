# ADR 0061: R0.06 cross-day model admission resume

Status: Known-reset rollover CLI unit verified and stopped after the first implementation pass: four assigned checks and fourteen affected checks pass. Whole AT/card acceptance remains pending; evidence is `build/evidence/R0.06/cross-day-final-verification.json`.

## Existing public interface

This change keeps the public `ModelAdmission` surface unchanged:

```ts
inspectPending(accountRef): Result<readonly ModelAdmissionRecordV1[]>
resumePending(accountRef, callKey): Result<ModelAdmissionRecordV1>
```

`inspectPending` must retain eligible denied work across a UTC-day boundary. `resumePending` continues to accept the original denied call key. It owns retry lookup, current-day admission, and idempotency; callers do not construct a replacement request or mutate the original row.

## Rollover behavior

The pending queue retains eligible denied work across UTC days. The original denied row keeps its UTC day and immutable call bindings. Advancing the test clock past midnight does not clear an exhausted observation or authorize a reservation. Before the recorded retry time, or while the newest normalized observation is not a fresh, authorized, schema-valid available observation reported at or after that reset, `resumePending` returns the original denied row without charging it or creating a current-day attempt.

After the retry time, a fresh authorized normalized available observation plus a measured eligible policy decision permits one current-day retry. The owner creates a new row with a bounded day-specific call key and a canonical request hash, retains the same account, budget group, root binding, route, work class, run, and generation, and preserves the original denied row. Repeating `resumePending` for the original key returns the same retry and cannot charge the current-day ledger twice. The superseded original leaves the runnable pending queue; its exact original request remains an idempotent public readback. The retry remains an accounting reservation only: this operation issues no provider-send permit and makes no native provider call. After the proof, the external no-send fixture acknowledges termination through public settlement with null usage, releases the lease and retains the single conservative charge.

The stored retry links to the original call through the existing parent-call and attempt fields. The current `ModelAdmissionRecordV1` readback does not expose `parentCallId`, `attempt`, or `rootContractId`; the assigned public case cannot independently inspect those stored values. It can verify the stable budget-group ID and reject a public reservation that reuses that group with a different root. The probe must state this readback limit and make no claim that it directly verified the stored parent link or root ID.

## Assigned proof and boundaries

The existing AT-ops-10 `deferred-restart-recovery` case remains at its assigned CLI rung and retains all four mandatory case IDs and its source assertion hash. Its existing same-day nine-call recovery proof remains intact. The case adds a public fake-clock sequence that persists one denied call at 23:59 UTC, reopens the disposable PostgreSQL owner at 00:02 while quota remains exhausted, then observes fresh available quota after the 00:05 reset and verifies the idempotent current-day reservation through owner readbacks.

This accounting case does not prove durable cadence slot/wake dispatch, authenticated provider subscription evidence, raw HTTP 429 parsing, protected provider execution, or whole AT/card acceptance. It adds no public method, DTO, command, database field, table, migration, fixture infrastructure, acceptance ID, or native activation.

Unknown-reset cross-day recovery is outside this known-reset unit and remains deferred to R0.06.
