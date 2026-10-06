import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { PgBoss } from "pg-boss";
import {
  checkViewSchema, modelAdmissionConnectionSchema, obligationToolParameters, obligationToolSchemaDialect,
  registeredCliAcceptanceManifestInventory, registeredProbeInputSchema, schemaBundleArtifacts, validateObligationToolParameters
} from "@toy/contracts";
import type { CheckViewV1, ModelAdmissionConnectionV1, OpsControlContextV1, RegisteredProbeInputV1 } from "@toy/contracts";
import { fixtureStackInspect } from "./fixture-stack.js";

type ToolName = keyof typeof obligationToolParameters;
type SchemaProbeCase = { tool: ToolName; valid: readonly unknown[]; invalid: readonly unknown[] };
type QueuePayload = { stackId: string; invocationId: string; scenario: "worker-throw" | "lost-claim" };

const dialect = "https://json-schema.org/draft/2020-12/schema";
const ids = {
  commitment: "00000000-0000-4000-8000-000000000001",
  dependency: "00000000-0000-4000-8000-000000000002",
  observation: "00000000-0000-4000-8000-000000000003",
  receipt: "00000000-0000-4000-8000-000000000004"
} as const;
const evidence = [{ observationRef: `life://observation/${ids.observation}` }];
const intent = {
  title: "Probe commitment", kind: "task", owner: "johan", next_action: "Review the result", priority: 2,
  phase: "actionable", next_action_at: null, deadline: null, dependencies: null, recurrence: null,
  calendar: "default", interpretation_note: null
};
const dueOmitted = { schema_version: "toy.obligations.v1", view: "due" };
const dueNulls = { ...dueOmitted, now: null, through: null, cursor: null, ids: [] };
const captureCreate = { schema_version: "toy.obligations.v1", request_key: "probe-capture", mode: "create", claim_key: "probe-claim", evidence, intent };
const captureAmend = { schema_version: "toy.obligations.v1", request_key: "probe-amend", commitment_id: ids.commitment, expected_revision: "1", mode: "amend", evidence, patch: { next_action: null } };
const captureAttach = { schema_version: "toy.obligations.v1", request_key: "probe-attach", commitment_id: ids.commitment, expected_revision: "1", mode: "attach", claim_key: "probe-claim", evidence };
const resolve = {
  schema_version: "toy.obligations.v1", request_key: "probe-resolve", commitment_id: ids.commitment, expected_revision: "1",
  outcome: "done", scope: "item", evidence, completion_receipt_refs: [{ module: "ops", kind: "queue-probe", id: ids.receipt }], reason: "Verified completion"
};
const deferUntil = {
  schema_version: "toy.obligations.v1", request_key: "probe-defer-until", commitment_id: ids.commitment, expected_revision: "1",
  scope: "item", reason: "Wait until the fixed instant", evidence, restart_action: null, mode: "until",
  until: { kind: "instant", at: "2026-10-06T12:00:00.000Z" }
};
const deferDependency = {
  schema_version: "toy.obligations.v1", request_key: "probe-defer-dependency", commitment_id: ids.commitment, expected_revision: "1",
  scope: "item", reason: "Wait for the dependency", evidence, restart_action: "Review dependency", mode: "dependency",
  dependencies: { mode: "all", ids: [ids.dependency] }, fallback_at: { kind: "instant", at: "2026-10-07T12:00:00.000Z" }
};
const satisfy = {
  schema_version: "toy.obligations.v1", request_key: "probe-satisfy", dependency_id: ids.dependency,
  expected_dependency_revision: "1", evidence
};

const schemaCases: readonly SchemaProbeCase[] = [
  { tool: "toy_capture", valid: [captureCreate, captureAmend, captureAttach], invalid: [{ ...captureCreate, unrecognized: true }, { ...captureAmend, patch: {} }] },
  { tool: "toy_due", valid: [dueOmitted, dueNulls], invalid: [{ ...dueOmitted, unrecognized: true }, { ...dueNulls, ids: [ids.commitment, ids.commitment] }] },
  { tool: "toy_resolve", valid: [resolve], invalid: [{ ...resolve, unrecognized: true }] },
  { tool: "toy_defer", valid: [deferUntil, deferDependency], invalid: [{ ...deferUntil, unrecognized: true }, { ...deferDependency, dependencies: { mode: "all", ids: [ids.dependency, ids.dependency] } }] },
  { tool: "toy_satisfy", valid: [satisfy], invalid: [{ ...satisfy, unrecognized: true }] }
];

const artifactNames = {
  toy_capture: "toy-capture-parameters-v1.schema.json",
  toy_due: "toy-due-parameters-v1.schema.json",
  toy_resolve: "toy-resolve-parameters-v1.schema.json",
  toy_defer: "toy-defer-parameters-v1.schema.json",
  toy_satisfy: "toy-satisfy-parameters-v1.schema.json"
} satisfies Record<ToolName, string>;
const recurrenceCases = [
  { id: "monthly-day-31", expression: "DTSTART;TZID=America/Chicago:20270131T090000\nRRULE:FREQ=MONTHLY;BYMONTHDAY=31", from: "2027-01-01T00:00:00.000Z",
    expected: ["2027-01-31T15:00:00.000Z", "2027-03-31T14:00:00.000Z", "2027-05-31T14:00:00.000Z"] },
  { id: "spring-gap", expression: "DTSTART;TZID=America/Chicago:20270313T023000\nRRULE:FREQ=DAILY", from: "2027-03-01T00:00:00.000Z",
    expected: ["2027-03-13T08:30:00.000Z", "2027-03-15T07:30:00.000Z", "2027-03-16T07:30:00.000Z"] },
  { id: "fall-overlap", expression: "DTSTART;TZID=America/Chicago:20271106T013000\nRRULE:FREQ=DAILY", from: "2027-11-05T00:00:00.000Z",
    expected: ["2027-11-06T06:30:00.000Z", "2027-11-07T06:30:00.000Z", "2027-11-08T07:30:00.000Z"] }
];

const schemaProbe = async (): Promise<{ passed: boolean; observations: unknown[]; artifactDigests: string[] }> => {
  const observations = await Promise.all(schemaCases.map(async (sample) => {
    const artifact = schemaBundleArtifacts.find((entry) => entry.path.endsWith("/" + artifactNames[sample.tool]));
    const declaredDialect = obligationToolSchemaDialect(sample.tool);
    const validSource = sample.valid.map((value) => obligationToolParameters[sample.tool].safeParse(value).success);
    const validGenerated = await Promise.all(sample.valid.map((value) => validateObligationToolParameters(sample.tool, value)));
    const invalidSource = sample.invalid.map((value) => obligationToolParameters[sample.tool].safeParse(value).success);
    const invalidGenerated = await Promise.all(sample.invalid.map((value) => validateObligationToolParameters(sample.tool, value)));
    const absentNullFieldsRemainAbsent = sample.tool !== "toy_due" || !Object.hasOwn(dueOmitted, "now") && !Object.hasOwn(dueOmitted, "through") && !Object.hasOwn(dueOmitted, "cursor");
    const explicitNullFieldsRemainPresent = sample.tool !== "toy_due" || Object.hasOwn(dueNulls, "now") && Object.hasOwn(dueNulls, "through") && Object.hasOwn(dueNulls, "cursor");
    return {
      tool: sample.tool, artifactPath: artifact?.path ?? null, artifactDigest: artifact?.digest ?? null,
      declaredDialect, validCount: sample.valid.length, invalidCount: sample.invalid.length,
      validAccepted: validSource.every(Boolean) && validGenerated.every(Boolean),
      invalidRejected: invalidSource.every((accepted) => !accepted) && invalidGenerated.every((accepted) => !accepted),
      ...(sample.tool === "toy_due" ? { absentNullFieldsRemainAbsent, explicitNullFieldsRemainPresent } : {}),
      passed: artifact !== undefined && declaredDialect === dialect && validSource.every(Boolean) && validGenerated.every(Boolean)
        && invalidSource.every((accepted) => !accepted) && invalidGenerated.every((accepted) => !accepted)
        && absentNullFieldsRemainAbsent && explicitNullFieldsRemainPresent
    };
  }));
  return {
    passed: observations.length === 5 && observations.every((item) => item.passed),
    observations,
    artifactDigests: observations.flatMap((item) => item.artifactDigest === null ? [] : [item.artifactDigest])
  };
};

const waitFor = async <Value>(promise: Promise<Value>, timeoutMs: number): Promise<Value> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("QUEUE_FAULT_PROBE_TIMEOUT")), timeoutMs); })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

const insertMarker = (database: { executeSql: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> }, stackId: string, invocationId: string, scenario: string, effect: string): Promise<{ rows: unknown[] }> =>
  database.executeSql("INSERT INTO public.toy_ops_queue_spike (stack_id, invocation_id, scenario, effect) VALUES ($1, $2, $3, $4)", [stackId, invocationId, scenario, effect]);

const checkView = (passed: boolean, evidenceValue: unknown, artifactDigests: string[] = []): CheckViewV1 => checkViewSchema.parse({
  id: "queue.obligation-faults", owner: "ops", state: passed ? "PASS" : "FAIL", checkedAt: new Date().toISOString(),
  reasonCode: passed ? "NATIVE_PG_BOSS_FAULT_PROBE_PASS" : "NATIVE_PG_BOSS_FAULT_PROBE_FAIL",
  prerequisite: JSON.stringify(evidenceValue), nextCommandId: "probe.show",
  links: { recordRefs: [], observations: [], artifactDigests }
} satisfies CheckViewV1);

export const QueueFaultProbe = {
  async exercise(input: RegisteredProbeInputV1, context: OpsControlContextV1, connection: ModelAdmissionConnectionV1): Promise<CheckViewV1[]> {
    const stackId = context.environment.stackId;
    if (!registeredProbeInputSchema.safeParse(input).success || input.probeId !== "AT-obligations-76" || (input.caseId !== undefined && input.caseId !== "queue-transaction-faults")
      || context.environment.kind !== "test" || stackId === null) return [checkView(false, { refusal: "REGISTERED_TEST_CASE_REQUIRED" })];
    const manifest = registeredCliAcceptanceManifestInventory.find(entry => entry.id === input.probeId);
    if (!manifest || manifest.scenarioId !== "queue-transaction-faults" || JSON.stringify(manifest.mandatoryCases) !== JSON.stringify([{ id: "queue-transaction-faults", publicOperation: "QueueFaultProbe.exercise", phase: "queue-transaction-faults" }])) return [checkView(false, { refusal: "SOURCE_BOUND_MANIFEST_REQUIRED" })];
    const owned = fixtureStackInspect(context);
    if (!owned.ok || !owned.data.result?.ready || owned.data.result.stackId !== stackId || owned.data.result.release !== "R0"
      || owned.data.result.clock !== "fake" || owned.data.result.model !== "fake") return [checkView(false, { refusal: "OWNED_READY_R0_FIXTURE_REQUIRED" })];
    if (!modelAdmissionConnectionSchema.safeParse(connection).success || connection.socketDirectory !== "/private/tmp/toy-pg-" + stackId
      || connection.database !== "toy" || connection.peerRole !== userInfo().username) return [checkView(false, { refusal: "FIXTURE_CONNECTION_MISMATCH" })];

    let schema: Awaited<ReturnType<typeof schemaProbe>> = { passed: false, observations: [], artifactDigests: [] };
    const queueName = `toy.r010.obligation.${stackId}.${input.requestId}`;
    const timeoutMs = Math.min(context.timeoutMs, 30000);
    const scenarios: Record<string, boolean> = {};
    let stage = "native-schema";
    let cleanupPassed = true;
    let boss: PgBoss | undefined;
    let started = false;
    let queueCreated = false;
    let workerRegistered = false;
    let backgroundErrors = 0;
    let releaseThrow: () => void = () => undefined;
    let releaseLost: () => void = () => undefined;
    let enteredThrowResolve: () => void = () => undefined;
    let enteredLostResolve: () => void = () => undefined;
    const throwEntered = new Promise<void>((resolve) => { enteredThrowResolve = resolve; });
    const lostEntered = new Promise<void>((resolve) => { enteredLostResolve = resolve; });
    const throwBarrier = new Promise<void>((resolve) => { releaseThrow = resolve; });
    const lostBarrier = new Promise<void>((resolve) => { releaseLost = resolve; });
    const onError = (): void => { backgroundErrors += 1; };
    let operations: Record<string, unknown> = { schemas: [] };
    let failureStage: string | null = null;
    const recurrenceKey = "r010.recurrence";
    let recurrenceObservations: unknown[] = [];
    let recurrencePassed = false;
    let nativeSchemaVersion: number | null = null;
    let schemaDriftPassed = false;

    try {
      schema = await schemaProbe();
      operations = { schemas: schema.observations };
      if (!schema.passed) throw new Error("QUEUE_FAULT_SCHEMA_VALIDATION_FAILED");
      stage = "pg-boss-start";
      boss = new PgBoss({
        application_name: "toy-r010-obligation-faults", host: connection.socketDirectory, port: 5432,
        database: connection.database, user: connection.peerRole, schema: "pgboss", max: 2,
        connectionTimeoutMillis: 3000, options: "-c statement_timeout=5000 -c lock_timeout=2000",
        schedule: false, supervise: false, monitorVacuum: false, monitorIntervalSeconds: 3600,
        maintenanceIntervalSeconds: 3600, bamIntervalSeconds: 3600, flowIntervalSeconds: 3600,
        registerInstance: false, persistWarnings: false, persistQueueStats: false, reindex: false,
        openTelemetry: { enabled: false }
      });
      boss.on("error", onError);
      await boss.start();
      started = true;
      stage = "native-schema44-readback";
      nativeSchemaVersion = await boss.schemaVersion();
      schemaDriftPassed = (await boss.detectSchemaDrift()).ok;
      scenarios.nativeSchema44 = nativeSchemaVersion === 44 && schemaDriftPassed;
      const database = boss.getDb();
      if (!database.beginTransaction) throw new Error("QUEUE_FAULT_TRANSACTION_API_UNAVAILABLE");
      stage = "domain-table-create";
      await database.executeSql("CREATE TABLE IF NOT EXISTS public.toy_ops_queue_spike (stack_id uuid NOT NULL, invocation_id uuid NOT NULL, scenario text NOT NULL CHECK (scenario IN ('application-rollback','application-commit','worker-throw','lost-claim')), effect text NOT NULL CHECK (effect IN ('application','worker')), PRIMARY KEY (stack_id, invocation_id, scenario))");
      await database.executeSql("DELETE FROM public.toy_ops_queue_spike WHERE stack_id = $1 AND invocation_id = $2", [stackId, input.requestId]);
      stage = "native-queue-create";
      await boss.createQueue(queueName, { retryLimit: 0, expireInSeconds: 30, deleteAfterSeconds: 300, policy: "standard", notify: false });
      queueCreated = true;

      stage = "native-recurrence-preview";
      const recurrenceResults = recurrenceCases.map(sample => {
        const observed = boss?.previewSchedule(sample.expression, { tz: "America/Chicago", from: new Date(sample.from), count: 3 }).map(date => date.toISOString()) ?? [];
        return { ...sample, observed, passed: JSON.stringify(observed) === JSON.stringify(sample.expected) };
      });
      recurrenceObservations = recurrenceResults;
      recurrencePassed = recurrenceResults.length === 3 && recurrenceResults.every(result => result.passed);
      scenarios.recurrencePreview = recurrencePassed;
      stage = "native-recurrence-storage-readback";
      const monthly = recurrenceCases[0];
      if (monthly === undefined) throw new Error("QUEUE_RECURRENCE_CASE_UNAVAILABLE");
      await boss.schedule(queueName, monthly.expression, { stackId, invocationId: input.requestId }, { key: recurrenceKey, tz: "America/Chicago", missed: "skip" });
      const stored = await boss.getSchedule(queueName, recurrenceKey);
      await boss.unschedule(queueName, recurrenceKey);
      const removed = await boss.getSchedule(queueName, recurrenceKey);
      scenarios.recurrenceStorage = stored?.name === queueName && stored.key === recurrenceKey && stored.kind === "rrule"
        && stored.cron === monthly.expression && stored.timezone === "America/Chicago" && removed === null;

      stage = "application-rollback";
      const rollback = await database.beginTransaction();
      let rollbackJobId: string | null = null;
      try {
        await insertMarker(rollback.db, stackId, input.requestId, "application-rollback", "application");
        rollbackJobId = await boss.send(queueName, { stackId, invocationId: input.requestId, scenario: "worker-throw" } satisfies QueuePayload, {
          db: rollback.db, retryLimit: 0, expireInSeconds: 30, deleteAfterSeconds: 300
        });
        if (rollbackJobId === null) throw new Error("QUEUE_FAULT_SEND_EMPTY");
        await rollback.rollback();
      } catch (error) {
        await rollback.rollback();
        throw error;
      }
      const rollbackJob = rollbackJobId === null ? null : await boss.getJobById(queueName, rollbackJobId);
      const rollbackRows = await database.executeSql("SELECT 1 FROM public.toy_ops_queue_spike WHERE stack_id = $1 AND invocation_id = $2 AND scenario = 'application-rollback'", [stackId, input.requestId]);
      scenarios.applicationRollback = rollbackJob === null && rollbackRows.rows.length === 0;

      stage = "application-commit-control";
      const commit = await database.beginTransaction();
      let commitJobId: string | null = null;
      try {
        await insertMarker(commit.db, stackId, input.requestId, "application-commit", "application");
        commitJobId = await boss.send(queueName, { stackId, invocationId: input.requestId, scenario: "worker-throw" } satisfies QueuePayload, {
          db: commit.db, retryLimit: 0, expireInSeconds: 30, deleteAfterSeconds: 300
        });
        if (commitJobId === null) throw new Error("QUEUE_FAULT_SEND_EMPTY");
        await commit.commit();
      } catch (error) {
        await commit.rollback();
        throw error;
      }
      const committedJob = commitJobId === null ? null : await boss.getJobById(queueName, commitJobId);
      const commitRows = await database.executeSql("SELECT 1 FROM public.toy_ops_queue_spike WHERE stack_id = $1 AND invocation_id = $2 AND scenario = 'application-commit'", [stackId, input.requestId]);
      if (commitJobId !== null) await boss.cancel(queueName, commitJobId);
      const canceledJob = commitJobId === null ? null : await boss.getJobById(queueName, commitJobId);
      scenarios.applicationCommitControl = committedJob?.state === "created" && commitRows.rows.length === 1
        && canceledJob?.state === "cancelled";

      const registerWorker = async (): Promise<void> => {
        const options = {
          transactional: true, transactionTimeoutSeconds: 20, pollingIntervalSeconds: 0.5, batchSize: 1, localConcurrency: 1
        } as const;
        await boss?.work<QueuePayload, { handled: boolean }, typeof options>(queueName, options, async (jobs, transaction) => {
          const job = jobs[0];
          if (job === undefined) return { handled: false };
          const payload = job.data;
          if (payload.scenario === "worker-throw") {
            await insertMarker(transaction, payload.stackId, payload.invocationId, "worker-throw", "worker");
            enteredThrowResolve();
            await throwBarrier;
            throw new Error("FIXED_QUEUE_WORKER_FAULT");
          }
          await insertMarker(transaction, payload.stackId, payload.invocationId, "lost-claim", "worker");
          enteredLostResolve();
          await lostBarrier;
          return { handled: true };
        });
        workerRegistered = true;
      };

      stage = "native-worker-throw-rollback";
      const throwJobId = await boss.send(queueName, { stackId, invocationId: input.requestId, scenario: "worker-throw" } satisfies QueuePayload, {
        retryLimit: 0, expireInSeconds: 30, deleteAfterSeconds: 300
      });
      if (throwJobId === null) throw new Error("QUEUE_FAULT_SEND_EMPTY");
      await registerWorker();
      await waitFor(throwEntered, timeoutMs);
      releaseThrow();
      await waitFor(boss.offWork(queueName, { wait: true }), timeoutMs);
      workerRegistered = false;
      const failedJob = await boss.getJobById(queueName, throwJobId);
      const throwRows = await database.executeSql("SELECT 1 FROM public.toy_ops_queue_spike WHERE stack_id = $1 AND invocation_id = $2 AND scenario = 'worker-throw'", [stackId, input.requestId]);
      scenarios.nativeWorkerThrowRollback = failedJob?.state === "failed" && throwRows.rows.length === 0;

      stage = "native-worker-lost-claim-fence";
      const lostJobId = await boss.send(queueName, { stackId, invocationId: input.requestId, scenario: "lost-claim" } satisfies QueuePayload, {
        retryLimit: 0, expireInSeconds: 30, deleteAfterSeconds: 300
      });
      if (lostJobId === null) throw new Error("QUEUE_FAULT_SEND_EMPTY");
      await registerWorker();
      await waitFor(lostEntered, timeoutMs);
      await boss.cancel(queueName, lostJobId);
      const duringCancellation = await boss.getJobById(queueName, lostJobId);
      releaseLost();
      await waitFor(boss.offWork(queueName, { wait: true }), timeoutMs);
      workerRegistered = false;
      const lostJob = await boss.getJobById(queueName, lostJobId);
      const lostRows = await database.executeSql("SELECT 1 FROM public.toy_ops_queue_spike WHERE stack_id = $1 AND invocation_id = $2 AND scenario = 'lost-claim'", [stackId, input.requestId]);
      scenarios.nativeLostClaimFence = duringCancellation?.state === "cancelled" && lostJob?.state === "cancelled" && lostRows.rows.length === 0;
      operations = { applicationRollback: scenarios.applicationRollback, applicationCommitControl: scenarios.applicationCommitControl,
        nativeWorkerThrowRollback: scenarios.nativeWorkerThrowRollback, nativeLostClaimFence: scenarios.nativeLostClaimFence,
        nativeSchemaVersion, schemaDriftPassed, recurrencePreview: recurrencePassed, recurrenceStorage: scenarios.recurrenceStorage, backgroundErrors };
    } catch {
      failureStage = stage;
      operations = { scenarios, failureStage };
    } finally {
      releaseThrow();
      releaseLost();
      if (boss !== undefined) {
        if (started && workerRegistered) {
          try { await boss.offWork(queueName, { wait: true }); }
          catch { cleanupPassed = false; }
        }
        if (started && queueCreated) {
          try { await boss.unschedule(queueName, recurrenceKey); await boss.deleteAllJobs(queueName); await boss.deleteQueue(queueName); }
          catch { cleanupPassed = false; }
        }
        if (started) {
          try {
            await boss.getDb().executeSql("DELETE FROM public.toy_ops_queue_spike WHERE stack_id = $1 AND invocation_id = $2", [stackId, input.requestId]);
          } catch { cleanupPassed = false; }
        }
        try { await boss.stop({ close: true, graceful: false, timeout: 5000 }); }
        catch { cleanupPassed = false; }
        boss.off("error", onError);
      }
    }
    const passed = failureStage === null && schema.passed && scenarios.applicationRollback === true
      && scenarios.applicationCommitControl === true && scenarios.nativeWorkerThrowRollback === true
      && scenarios.nativeLostClaimFence === true && scenarios.nativeSchema44 === true && recurrencePassed
      && scenarios.recurrenceStorage === true && cleanupPassed && backgroundErrors === 0;
    const artifactDigests = [...new Set([
      createHash("sha256").update(readFileSync(new URL("./queue-fault-probe.js", import.meta.url))).digest("hex"),
      ...schema.artifactDigests
    ])];
    return [
      ...schema.observations.map(observation => checkView(schema.passed, observation, schema.artifactDigests)),
      ...recurrenceObservations.map(observation => checkView(recurrencePassed, { recurrence: observation }, artifactDigests)),
      checkView(passed, { wholeAcceptance: "PENDING", stackId, requestId: input.requestId, queueName, schemasPassed: schema.passed, scenarios, operations, cleanupPassed, failureStage }, artifactDigests)
    ];
  }
};
