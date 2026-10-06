# ADR 0033: R0 native pg-boss obligation fault probe

**Status:** accepted for the AT-obligations-76 feasibility probe
**Owner:** `@toy/ops`
**Scope:** one registered, disposable PostgreSQL fault probe; not an Obligations service implementation

## Written interface

`QueueFaultProbe.exercise(input: RegisteredProbeInputV1, context: OpsControlContextV1, connection: ModelAdmissionConnectionV1): Promise<CheckViewV1[]>` accepts only `AT-obligations-76` with the registered `queue-transaction-faults` case. The caller owns and starts the existing `withAccountingFixture` PostgreSQL 17 lifecycle, then passes its `ModelAdmissionConnectionV1`. The probe requires a test context for the same owned, ready R0 fake-clock/fake-model stack and the exact fixture socket, `toy` database, local peer role, and port 5432. It accepts no connection override from CLI input.

## Decision

The Ops owner constructs one pinned pg-boss 12.36.0 instance against the fixture's Unix socket. pg-boss creates and owns its native `pgboss` schema. The probe uses only public `PgBoss.getDb`, `IDatabase.beginTransaction` / `TransactionHandle`, `IDatabase.executeSql`, `send` with `SendOptions.db`, `work` with `transactional: true`, `cancel`, `getJobById`, `offWork`, `deleteAllJobs`, `deleteQueue`, and `stop` APIs. No SQL references pg-boss tables, and no independent queue, worker loop, schema, or connection pool is introduced.

The bounded fault cells are: (1) insert a fixed domain marker and enqueue with `send(..., { db: tx.db })`, then rollback and require both records absent; (2) repeat and commit as the transaction control, then read back both records; (3) have a native transactional worker write a marker through the supplied `tx.executeSql` and throw, then require the marker absent and job failed; and (4) hold a second transactional handler at a promise barrier after its marker write, cancel its active job through public `cancel`, release the handler, and require the marker absent while the job remains cancelled. Retry limit is zero, waits are wall-clock bounded, and the barrier is always released during cleanup. pg-boss's own worker poller is the only queue consumer.

The probe's sole domain table is `public.toy_ops_queue_spike`, created with fixed DDL and keyed by the owned stack and registered request IDs. Only rows for that pair are cleaned up. The native queue name is derived from those same IDs and is cleaned through pg-boss public APIs. Pool size is two to fit the fixture's four-connection limit while leaving headroom.

For the schema clause, the probe calls the five `obligationToolParameters` Zod schemas and the contracts-owned `validateObligationToolParameters` / `obligationToolSchemaDialect` functions. Contracts owns Ajv 8.17.1 and the generated Draft 2020-12 artifacts; Ops neither imports Ajv nor reads generated schema files directly. Fixed valid/invalid payloads exercise unknown fields, empty amendment patches, duplicate UUID arrays, all capture/defer variants, and optional `toy_due` fields with both absence and explicit `null`. Validator mutation options remain disabled at the contracts boundary.

One registered `queue.obligation-faults` check contains only fixed scenario names, expected state/readback booleans, declared dialects, and generated artifact digests. It is a probe result, not a declaration that the whole AT has passed. The complete CLI, stack, static-gate, and acceptance evidence remain owned by the integrating caller.

The first strict compilation exposed pg-boss 12.36.0 publication defects: its declarations reference the stripped internal `ResolvedConstructorOptions` type, and its emitted Db declaration depends on undeclared `@types/pg`. The Ops declaration augmentation restores only that missing interface's fields from the exact [upstream tag source](https://github.com/timgit/pg-boss/blob/12.36.0/src/types.ts); the root development dependency pins `@types/pg` 8.23.1, matching upstream. No installed package or runtime source is patched and `skipLibCheck` remains false. The worker call supplies its literal options type to the existing conditional overload so transactional handlers retain their checked second parameter.

## Scope boundary

No CLI command, contracts schema, schema generator, generated artifact, registry, feature map, acceptance index, migration, production queue, polling implementation, live service, or durable Obligations behavior is added by this ADR. Temporal semantics and all non-AT76 obligations behavior remain outside this feasibility probe.
