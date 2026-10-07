import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  admissionInputV1Schema, admissionReadbackV1Schema, cadenceProjectionQueryV1Schema, cadenceRoleProofV1Schema,
  cadenceSlotStateSchema, cadenceSlotV1Schema, capacityTrialArmSchema, capacityTrialDeferralSchema,
  capacityTrialReportSchema, capacityTrialSlotSchema, checkViewSchema, cadenceSourceGateInputV1Schema,
  cadenceSourceGateResultV1Schema, reviewResultV1Schema, runRefV1Schema,
  experimentalSlotSweepV1Schema, opsErrorMessages, uint64Schema, uuidSchema
} from "@toy/contracts";
import type {
  AdmissionReadbackV1, CadenceProjectionQueryV1, CadenceProjectionV1,
  CadenceRoleProofV1, CadenceRoleTableV1, CadenceSlotV1, CadenceSourceGateInputV1,
  CadenceSourceGateResultV1, DurableCadenceTestApi,
  CapacityTrialReportV1, CapacityTrialSlotV1, CheckViewV1, OpsControlContextV1, UUID,
  Result, ReviewResultV1, RunRefV1
} from "@toy/contracts";
import { CadenceProjection } from "@toy/obligations/public";
import { OpsTestStack, TestClockControl, trustedCheckoutRoot } from "@toy/ops/public";
import { AccountingFailure, accountingQuery, accountingTestConnection, sqlJson, sqlText, withAccountingFixture } from "./accounting-postgres.js";
import { capacityTrialMigration } from "./capacity-trial-migration.js";
import { durableCadenceMigration } from "./durable-cadence-migration.js";

const ownerRole = "toy_si_durable_owner";
const readerRole = "toy_si_obligations_reader";
const baseTables: readonly CadenceRoleTableV1[] = ["cadence_slot", "run", "review"];
const stamp = (column: string): string => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const ownerSql = (connection: ReturnType<typeof accountingTestConnection>, statement: string, mutation = false): unknown =>
  accountingQuery(connection, `SET LOCAL ROLE ${ownerRole};\n${statement}`, mutation);
const readerSql = (connection: ReturnType<typeof accountingTestConnection>, statement: string): unknown =>
  accountingQuery(connection, `SET LOCAL ROLE ${readerRole};\n${statement}`);

class OwnerConflict extends Error {}
class OwnerRefusal extends Error {}
const attempt = <Data>(run: () => Data, diagnostic?: (check: CheckViewV1) => void): Result<Data> => {
  try { return { ok: true, data: run() }; }
  catch (error) {
    const code = error instanceof OwnerConflict ? "CONFLICT" : "ATTESTATION_INVALID";
    if (!(error instanceof OwnerConflict)) diagnostic?.(checkViewSchema.parse({ id: "capacity.trial-journal", owner: "self-improvement", state: "BLOCKED", checkedAt: new Date().toISOString(),
      reasonCode: error instanceof AccountingFailure ? error.reason : "CAPACITY_TRIAL_OWNER_REFUSED", prerequisite: null, nextCommandId: "probe.show",
      links: { recordRefs: [], observations: [], artifactDigests: [] } }));
    return { ok: false, error: { module: "ops", code, message: opsErrorMessages[code], retryable: false, effectState: "unknown" } };
  }
};
const requireOwner = (context: OpsControlContextV1): void => {
  if (context.environment.kind !== "test" || context.environment.stackId === null) throw new OwnerRefusal();
  const stack = OpsTestStack.inspect(context);
  if (!stack.ok || !stack.data.result?.ready || stack.data.result.model !== "fake" || stack.data.result.clock !== "fake") throw new OwnerRefusal();
};
const runRefSql = (alias: string): string => `jsonb_build_object(
  'runId',${alias}.id,'principalId',${alias}.principal_id,'profile',${alias}.profile,'sessionId',${alias}.session_id,
  'taskId',${alias}.task_id,'turnId',${alias}.turn_id,'contractId',${alias}.contract_id,
  'contractVersion',${alias}.contract_version,'generation',${alias}.generation::text)`;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isUnknownArray = (value: unknown): value is unknown[] => Array.isArray(value);

const sourceFiles = (root: string): CadenceSourceGateInputV1 => {
  const files: CadenceSourceGateInputV1["files"] = [];
  const roots = ["packages"].map(path => join(root, path));
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory() && !["dist", "node_modules"].includes(entry.name)) visit(absolute);
      else if (entry.isFile() && /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|sql)$/.test(entry.name)) {
        const path = relative(root, absolute).split(sep).join("/");
        files.push({ path, contents: readFileSync(absolute, "utf8") });
      }
    }
  };
  for (const directory of roots) visit(directory);
  return cadenceSourceGateInputV1Schema.parse({ files });
};

const inspectSourceGate = (raw: CadenceSourceGateInputV1): CadenceSourceGateResultV1 => {
  const input = cadenceSourceGateInputV1Schema.parse(raw);
  const reasons = new Set<CadenceSourceGateResultV1["reasonCodes"][number]>();
  if (input.files.length === 0) reasons.add("SOURCE_INVENTORY_EMPTY");
  const ownerFile = "packages/self-improvement/src/durable-cadence.ts";
  const writerFiles = [...new Set(input.files.flatMap(file => /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+toy_si\.(?:cadence_slot|run|review)\b/i.test(file.contents) ? [file.path] : []))].sort();
  if (!writerFiles.includes(ownerFile)) reasons.add("CADENCE_OWNER_WRITE_MISSING");
  if (writerFiles.some(path => path !== ownerFile)) reasons.add("CADENCE_COMPETING_WRITER");
  const sql = input.files.find(file => file.path === "packages/self-improvement/migrations/capacity-trial.sql")?.contents ?? "";
  const enumMatch = /state text NOT NULL CHECK \(state IN \(([^)]*)\)\)/s.exec(sql);
  const sqlStates = [...(enumMatch?.[1] ?? "").matchAll(/'([^']+)'/g)].map(match => match[1] ?? "");
  const expectedStates = [...cadenceSlotStateSchema.options];
  if (JSON.stringify(sqlStates) !== JSON.stringify(expectedStates)) reasons.add("CADENCE_ENUM_MISMATCH");
  return cadenceSourceGateResultV1Schema.parse({ accepted: reasons.size === 0, reasonCodes: [...reasons], writerFiles, expectedStates, sqlStates });
};

const tablePrivilegeSql = (table: CadenceRoleTableV1): string => {
  const relation = `toy_si.${table}`;
  return `'${table}',jsonb_build_object(
    'select',has_table_privilege(current_user,'${relation}','SELECT'),
    'insert',has_table_privilege(current_user,'${relation}','INSERT'),
    'update',has_table_privilege(current_user,'${relation}','UPDATE'),
    'delete',has_table_privilege(current_user,'${relation}','DELETE'))`;
};

const checkRoleBoundary = (connection: ReturnType<typeof accountingTestConnection>): CadenceRoleProofV1 => {
  const ownerSnapshot = ownerSql(connection, `SELECT jsonb_build_object('effectiveRole',current_user,'privileges',jsonb_build_object(${baseTables.map(tablePrivilegeSql).join(",")}));`);
  const readerSnapshot = readerSql(connection, `SELECT jsonb_build_object(
    'effectiveRole',current_user,'projectionSelect',has_table_privilege(current_user,'toy_si.obligations_cadence_projection','SELECT'),
    'privileges',jsonb_build_object(${baseTables.map(tablePrivilegeSql).join(",")}));`);
  const denialValues = baseTables.flatMap(table => [
    `(${sqlText(table)},'INSERT',${sqlText(`INSERT INTO toy_si.${table} DEFAULT VALUES`)})`,
    `(${sqlText(table)},'UPDATE',${sqlText(`UPDATE toy_si.${table} SET ${table === "cadence_slot" ? "state" : "id"}=${table === "cadence_slot" ? "state" : "id"} WHERE false`)})`,
    `(${sqlText(table)},'DELETE',${sqlText(`DELETE FROM toy_si.${table} WHERE false`)})`
  ]).join(",");
const denials = readerSql(connection, `DO $denials$
DECLARE
  test_row record;
  observed_state text;
  observed jsonb := '[]'::jsonb;
BEGIN
  FOR test_row IN SELECT * FROM (VALUES ${denialValues}) AS candidates(table_name,operation,statement) LOOP
    observed_state := NULL;
    BEGIN
      EXECUTE test_row.statement;
      RAISE EXCEPTION 'CADENCE_READER_WRITE_WAS_NOT_DENIED' USING ERRCODE='P0001';
    EXCEPTION WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS observed_state = RETURNED_SQLSTATE;
    END;
    IF observed_state <> '42501' THEN
      RAISE EXCEPTION 'CADENCE_READER_DENIAL_SQLSTATE_INVALID' USING ERRCODE='P0001';
    END IF;
    observed := observed || jsonb_build_array(jsonb_build_object('table',test_row.table_name,'operation',test_row.operation,'sqlState',observed_state));
  END LOOP;
  PERFORM set_config('toy.cadence_denials',observed::text,true);
END;
$denials$;
SELECT current_setting('toy.cadence_denials')::jsonb;`);
  if (!isRecord(ownerSnapshot) || !isRecord(readerSnapshot) || !isUnknownArray(denials)) throw new OwnerRefusal();
  const ownerObject = ownerSnapshot;
  const readerObject = readerSnapshot;
  return cadenceRoleProofV1Schema.parse({
    ownerEffectiveRole: ownerObject["effectiveRole"],
    readerEffectiveRole: readerObject["effectiveRole"],
    readerCanSelectProjection: readerObject["projectionSelect"],
    ownerPrivileges: ownerObject["privileges"],
    readerPrivileges: readerObject["privileges"],
    readerWriteDenials: denials
  });
};

const openOwner = (connection: ReturnType<typeof accountingTestConnection>, clock: () => string, root: string, guard: () => void, diagnostic?: (check: CheckViewV1) => void): DurableCadenceTestApi => {
  const readReport = (rawArmId: string): CapacityTrialReportV1 => {
    guard();
    const armId = uuidSchema.parse(rawArmId);
    const states = cadenceSlotStateSchema.options.map(state => `(${sqlText(state)})`).join(",");
    return capacityTrialReportSchema.parse(ownerSql(connection, `SELECT jsonb_build_object(
      'arm',a.manifest,'endsAt',${stamp("a.ends_at")},'denominator',3360,'cadenceSeconds',180,
      'totalSlots',(SELECT count(*) FROM toy_si.cadence_slot WHERE arm_id=a.id),
      'sequenceIntact',(SELECT count(*)=3360 AND bool_and(job_key=a.job_key AND slot_at=a.anchor+trial_slot_index*interval '180 seconds') FROM toy_si.cadence_slot WHERE arm_id=a.id),
      'firstSlotAt',(SELECT ${stamp("min(slot_at)")} FROM toy_si.cadence_slot WHERE arm_id=a.id),
      'lastSlotAt',(SELECT ${stamp("max(slot_at)")} FROM toy_si.cadence_slot WHERE arm_id=a.id),
      'counts',(SELECT jsonb_object_agg(s.state,(SELECT count(*) FROM toy_si.cadence_slot WHERE arm_id=a.id AND state=s.state)) FROM (VALUES ${states}) s(state)),
      'reasons',coalesce((SELECT jsonb_agg(jsonb_build_object('reason',r.reason,'count',r.n) ORDER BY r.reason) FROM (SELECT reason,count(*) n FROM toy_si.cadence_slot WHERE arm_id=a.id AND reason IS NOT NULL GROUP BY reason) r),'[]'::jsonb),
      'acceptanceComplete',false,'fullCadenceVerdict','NOT_EVALUATED') FROM toy_si.capacity_trial_arm a WHERE a.id=${sqlText(armId)}::uuid;`));
  };
  const readSlot = (rawArmId: string, rawIndex: number): CapacityTrialSlotV1 => {
    guard();
    const armId = uuidSchema.parse(rawArmId);
    const index = capacityTrialSlotSchema.shape.index.parse(rawIndex);
    return capacityTrialSlotSchema.parse(ownerSql(connection, `SELECT jsonb_build_object(
      'armId',arm_id,'index',trial_slot_index,'slotAt',${stamp("slot_at")},'state',state,'reason',reason,'updatedAt',${stamp("updated_at")})
      FROM toy_si.cadence_slot WHERE arm_id=${sqlText(armId)}::uuid AND trial_slot_index=${index};`));
  };
  const readSlots = (rawQuery: CadenceProjectionQueryV1): Result<CadenceSlotV1[]> => attempt(() => {
    guard();
    const query = cadenceProjectionQueryV1Schema.parse(rawQuery);
    const filterJob = query.jobKey === null ? "TRUE" : `"jobKey"=${sqlText(query.jobKey)}`;
    const rows = readerSql(connection, `SELECT coalesce(jsonb_agg(jsonb_build_object(
      'jobKey',"jobKey",'slotAt',${stamp('"slotAt"')},'state',state,'runId',"runId",'reviewId',"reviewId",'reason',reason,
      'startedAt',CASE WHEN "startedAt" IS NULL THEN NULL ELSE ${stamp('"startedAt"')} END,
      'inferenceDoneAt',CASE WHEN "inferenceDoneAt" IS NULL THEN NULL ELSE ${stamp('"inferenceDoneAt"')} END,
      'reviewedAt',CASE WHEN "reviewedAt" IS NULL THEN NULL ELSE ${stamp('"reviewedAt"')} END,
      'updatedAt',${stamp('"updatedAt"')}) ORDER BY "slotAt","jobKey"),'[]'::jsonb)
      FROM toy_si.obligations_cadence_projection WHERE ${filterJob} AND "slotAt">=${sqlText(query.from)}::timestamptz AND "slotAt"<${sqlText(query.to)}::timestamptz;`);
    if (!isUnknownArray(rows)) throw new OwnerRefusal();
    return rows.map(row => cadenceSlotV1Schema.parse(row));
  });
  return {
    startArm(raw): Result<CapacityTrialReportV1> {
      const parsed = capacityTrialArmSchema.safeParse(raw);
      if (!parsed.success) return { ok: false, error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false } };
      return attempt(() => {
        guard();
        const arm = parsed.data;
        if (clock() !== arm.anchor) throw new OwnerConflict();
        const existing = capacityTrialArmSchema.nullable().parse(ownerSql(connection, `SELECT coalesce(
          (SELECT manifest FROM toy_si.capacity_trial_arm WHERE id=${sqlText(arm.armId)}::uuid OR request_id=${sqlText(arm.requestId)}::uuid LIMIT 1),'null'::jsonb);`));
        if (existing !== null) {
          if (JSON.stringify(existing) !== JSON.stringify(arm)) throw new OwnerConflict();
          return readReport(arm.armId);
        }
        const overlap = ownerSql(connection, `SELECT to_jsonb(EXISTS (SELECT 1 FROM toy_si.capacity_trial_arm WHERE job_key=${sqlText(arm.jobKey)}
          AND ends_at>${sqlText(arm.anchor)}::timestamptz AND anchor<${sqlText(arm.anchor)}::timestamptz+interval '168 hours'));`);
        if (overlap === true) throw new OwnerConflict();
        ownerSql(connection, `SELECT pg_advisory_xact_lock(18374692);
          DO $trial$ DECLARE old_manifest jsonb;
          BEGIN
            SELECT manifest INTO old_manifest FROM toy_si.capacity_trial_arm WHERE id=${sqlText(arm.armId)}::uuid OR request_id=${sqlText(arm.requestId)}::uuid LIMIT 1;
            IF old_manifest IS NOT NULL THEN
              IF old_manifest IS DISTINCT FROM ${sqlJson(arm)} THEN RAISE EXCEPTION 'CAPACITY_TRIAL_CONFLICT'; END IF;
              RETURN;
            END IF;
            IF EXISTS (SELECT 1 FROM toy_si.capacity_trial_arm WHERE job_key=${sqlText(arm.jobKey)} AND ends_at>${sqlText(arm.anchor)}::timestamptz AND anchor<${sqlText(arm.anchor)}::timestamptz+interval '168 hours') THEN
              RAISE EXCEPTION 'CAPACITY_TRIAL_ARMS_OVERLAP';
            END IF;
            INSERT INTO toy_si.capacity_trial_arm VALUES (${sqlText(arm.armId)}::uuid,${sqlText(arm.requestId)}::uuid,${sqlText(arm.jobKey)},${sqlText(arm.anchor)}::timestamptz,${sqlText(arm.anchor)}::timestamptz+interval '168 hours',${sqlJson(arm)});
            INSERT INTO toy_si.cadence_slot(job_key,slot_at,state,updated_at,arm_id,trial_slot_index)
              SELECT ${sqlText(arm.jobKey)},${sqlText(arm.anchor)}::timestamptz+n*interval '180 seconds','scheduled',${sqlText(arm.anchor)}::timestamptz,${sqlText(arm.armId)}::uuid,n FROM generate_series(0,3359) n;
          END; $trial$; SELECT 'true'::jsonb;`, true);
        return readReport(arm.armId);
      }, diagnostic);
    },
    sweepExperimentalSlot(raw): Result<CapacityTrialSlotV1> {
      const parsed = experimentalSlotSweepV1Schema.safeParse(raw);
      if (!parsed.success) return { ok: false, error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false } };
      return attempt(() => {
        guard();
        const { armId, index } = parsed.data;
        const now = clock();
        let outcome: unknown;
        try {
          outcome = ownerSql(connection, `UPDATE toy_si.cadence_slot SET state='swept',reason='DETERMINISTIC_SWEEP_COMPLETE',updated_at=${sqlText(now)}::timestamptz
            WHERE arm_id=${sqlText(armId)}::uuid AND trial_slot_index=${index} AND state='scheduled';
            SELECT to_jsonb(EXISTS (SELECT 1 FROM toy_si.cadence_slot WHERE arm_id=${sqlText(armId)}::uuid AND trial_slot_index=${index} AND state='swept'));`, true);
        } catch (error) {
          if (error instanceof AccountingFailure && error.reason === "ACCOUNTING_DATABASE_SQL_FAILED" && readSlot(armId, index).state === "scheduled") throw new OwnerConflict();
          throw error;
        }
        if (outcome !== true) throw new OwnerRefusal();
        return readSlot(armId, index);
      }, diagnostic);
    },
    deferSlot(raw): Result<CapacityTrialSlotV1> {
      const parsed = capacityTrialDeferralSchema.safeParse(raw);
      if (!parsed.success) return { ok: false, error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false } };
      return attempt(() => {
        guard();
        const input = parsed.data;
        const old = readSlot(input.armId, input.index);
        if (old.state === input.state && old.reason === input.reason) return old;
        const now = clock();
        if (old.state !== "scheduled" || Date.parse(now) < Date.parse(old.slotAt) || Date.parse(now) >= Date.parse(old.slotAt) + 180000) throw new OwnerConflict();
        const changed = ownerSql(connection, `UPDATE toy_si.cadence_slot SET state=${sqlText(input.state)},reason=${sqlText(input.reason)},updated_at=${sqlText(now)}::timestamptz
          WHERE arm_id=${sqlText(input.armId)}::uuid AND trial_slot_index=${input.index} AND state='scheduled'; SELECT to_jsonb(count(*)=1) FROM toy_si.cadence_slot WHERE arm_id=${sqlText(input.armId)}::uuid AND trial_slot_index=${input.index} AND state=${sqlText(input.state)} AND reason=${sqlText(input.reason)};`, true);
        if (changed !== true) throw new OwnerConflict();
        return readSlot(input.armId, input.index);
      }, diagnostic);
    },
    reconcileArm(rawArmId): Result<CapacityTrialReportV1> {
      return attempt(() => {
        guard();
        const armId = uuidSchema.parse(rawArmId);
        readReport(armId);
        const now = clock();
        ownerSql(connection, `UPDATE toy_si.cadence_slot SET state='missed',reason='SLOT_BOUNDARY_PASSED',updated_at=${sqlText(now)}::timestamptz
          WHERE arm_id=${sqlText(armId)}::uuid AND state='scheduled' AND slot_at+interval '180 seconds'<=${sqlText(now)}::timestamptz; SELECT 'true'::jsonb;`, true);
        return readReport(armId);
      }, diagnostic);
    },
    reportArm: armId => attempt(() => readReport(armId), diagnostic),
    slot: (armId, index) => attempt(() => readSlot(armId, index), diagnostic),
    admitScheduled(raw): Result<RunRefV1> {
      const parsed = admissionInputV1Schema.safeParse(raw);
      if (!parsed.success) return { ok: false, error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false } };
      return attempt(() => {
        guard();
        const input = parsed.data;
        const id = randomUUID();
        const now = clock();
        const slotAt = input.scheduledSlot.slotAt;
        const outcome = ownerSql(connection, `DO $admit$ DECLARE
          old_run_id uuid;
          slot_state text;
          slot_arm_id uuid;
          slot_run_id uuid;
          BEGIN
            PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(${sqlText(input.profile)},${sqlText(input.surface)},${sqlText(input.admissionKey)})::text,0));
            SELECT id INTO old_run_id FROM toy_si.run
              WHERE profile=${sqlText(input.profile)} AND surface=${sqlText(input.surface)} AND admission_key=${sqlText(input.admissionKey)};
            IF old_run_id IS NOT NULL THEN RETURN; END IF;
            INSERT INTO toy_si.cadence_slot(job_key,slot_at,state,updated_at)
              VALUES (${sqlText(input.scheduledSlot.jobKey)},${sqlText(slotAt)}::timestamptz,'scheduled',${sqlText(now)}::timestamptz)
              ON CONFLICT (job_key,slot_at) DO NOTHING;
            SELECT state,arm_id,run_id INTO slot_state,slot_arm_id,slot_run_id FROM toy_si.cadence_slot
              WHERE job_key=${sqlText(input.scheduledSlot.jobKey)} AND slot_at=${sqlText(slotAt)}::timestamptz FOR UPDATE;
            IF slot_state IS DISTINCT FROM 'scheduled' OR slot_arm_id IS NOT NULL OR slot_run_id IS NOT NULL THEN RAISE EXCEPTION 'CADENCE_ADMISSION_SLOT_CONFLICT'; END IF;
            INSERT INTO toy_si.run(id,principal_id,parent_run_id,root_run_id,profile,surface,admission_key,payload_hash,session_id,task_id,turn_id,
              scheduled_slot_at,contract_id,contract_version,generation,release_hash,budget_group_id,state,lease_epoch,last_event_seq,admitted_at)
              VALUES (${sqlText(id)}::uuid,${sqlText(input.principalId)}::uuid,NULL,${sqlText(id)}::uuid,${sqlText(input.profile)},${sqlText(input.surface)},
              ${sqlText(input.admissionKey)},${sqlText(input.payloadHash)},${sqlText(input.sessionId)},${input.taskId === null ? "NULL" : sqlText(input.taskId)},
              ${input.turnId === null ? "NULL" : sqlText(input.turnId)},${sqlText(slotAt)}::timestamptz,${sqlText(input.contractId)}::uuid,${input.contractVersion},
              ${sqlText(input.generation)}::bigint,${sqlText(input.releaseHash)},${sqlText(input.budgetGroupId)}::uuid,'admitted',0,0,${sqlText(now)}::timestamptz);
            UPDATE toy_si.cadence_slot SET state='running',run_id=${sqlText(id)}::uuid,started_at=${sqlText(now)}::timestamptz,updated_at=${sqlText(now)}::timestamptz
              WHERE job_key=${sqlText(input.scheduledSlot.jobKey)} AND slot_at=${sqlText(slotAt)}::timestamptz AND state='scheduled' AND run_id IS NULL;
            IF NOT FOUND THEN RAISE EXCEPTION 'CADENCE_ADMISSION_SLOT_BINDING_FAILED'; END IF;
            INSERT INTO toy_si.review_work(run_id,processing_state,attempt_count,lease_epoch,updated_at)
              VALUES (${sqlText(id)}::uuid,'pending',0,0,${sqlText(now)}::timestamptz);
          END; $admit$;
          SELECT jsonb_build_object('run',${runRefSql("r")},'payloadHash',r.payload_hash,
            'scheduledSlot',CASE WHEN s.job_key IS NULL THEN NULL ELSE jsonb_build_object('jobKey',s.job_key,'slotAt',${stamp("s.slot_at")}) END,
            'slotState',s.state,'pendingWork',w.processing_state='pending')
          FROM toy_si.run r LEFT JOIN toy_si.cadence_slot s ON s.run_id=r.id LEFT JOIN toy_si.review_work w ON w.run_id=r.id
          WHERE r.profile=${sqlText(input.profile)} AND r.surface=${sqlText(input.surface)} AND r.admission_key=${sqlText(input.admissionKey)};`, true);
        const readback: AdmissionReadbackV1 = admissionReadbackV1Schema.parse(outcome);
        if (readback.payloadHash !== input.payloadHash || readback.scheduledSlot?.jobKey !== input.scheduledSlot.jobKey
          || readback.scheduledSlot?.slotAt !== slotAt || readback.slotState !== "running" || !readback.pendingWork) throw new OwnerConflict();
        return runRefV1Schema.parse(readback.run);
      }, diagnostic);
    },
    reviewResult(rawRunId: UUID): Result<ReviewResultV1> {
      return attempt(() => {
        guard();
        const runId = uuidSchema.parse(rawRunId);
        const result = ownerSql(connection, `SELECT CASE WHEN rev.id IS NULL THEN jsonb_build_object(
            'state','pending','run',${runRefSql("r")},'reason','awaiting_terminal','retryAt',NULL)
          ELSE jsonb_build_object('state','reviewed','review',rev.body) END
          FROM toy_si.run r JOIN toy_si.review_work w ON w.run_id=r.id
          LEFT JOIN toy_si.review rev ON rev.id=w.latest_review_id
          WHERE r.id=${sqlText(runId)}::uuid;`);
        return reviewResultV1Schema.parse(result);
      }, diagnostic);
    },
    readSlots,
    readProjection(rawQuery): Result<CadenceProjectionV1> {
      const parsed = cadenceProjectionQueryV1Schema.safeParse(rawQuery);
      if (!parsed.success) return { ok: false, error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false } };
      return CadenceProjection.readSlots(parsed.data, { readSlots: query => readSlots(query) });
    },
    roleProof: () => attempt(() => checkRoleBoundary(connection), diagnostic),
    reviewCount: () => attempt(() => {
      guard();
      return uint64Schema.parse(ownerSql(connection, "SELECT to_jsonb(count(*)::text) FROM toy_si.review;"));
    }, diagnostic),
    sourceSnapshot: () => attempt(() => sourceFiles(root), diagnostic),
    sourceGate: raw => attempt(() => inspectSourceGate(raw ?? sourceFiles(root)), diagnostic)
  };
};

export const DurableCadenceOwner = {
  async withTest<Data>(context: OpsControlContextV1, run: (api: DurableCadenceTestApi) => Result<Data> | Promise<Result<Data>>, diagnostic?: (check: CheckViewV1) => void): Promise<Result<Data>> {
    try {
      requireOwner(context);
      const stackId = uuidSchema.parse(context.environment.stackId);
      const connection = accountingTestConnection(stackId);
      const root = trustedCheckoutRoot();
      const guard = (): void => requireOwner(context);
      const clock = (): string => {
        const current = TestClockControl.get(context);
        if (!current.ok) throw new OwnerRefusal();
        return current.data.virtualWall;
      };
      return await withAccountingFixture(stackId, context.timeoutMs, () => {
        const capacitySource = readFileSync(join(root, "packages/self-improvement/migrations/capacity-trial.sql"), "utf8");
        if (capacitySource !== capacityTrialMigration) throw new OwnerRefusal();
        const hasCapacity = accountingQuery(connection, "SELECT to_jsonb(to_regclass('toy_si.capacity_trial_arm') IS NOT NULL);");
        if (hasCapacity !== true) accountingQuery(connection, capacitySource + "SELECT 'true'::jsonb;");
        const durableSource = join(root, "packages/self-improvement/migrations/durable-cadence.sql");
        if (!existsSync(durableSource) || readFileSync(durableSource, "utf8") !== durableCadenceMigration) throw new OwnerRefusal();
        const hasDurable = accountingQuery(connection, "SELECT to_jsonb(to_regclass('toy_si.run') IS NOT NULL);");
        if (hasDurable !== true) accountingQuery(connection, durableCadenceMigration + "SELECT 'true'::jsonb;");
        const ready = accountingQuery(connection, "SELECT to_jsonb(to_regclass('toy_si.run') IS NOT NULL AND to_regclass('toy_si.review') IS NOT NULL AND to_regclass('toy_si.review_work') IS NOT NULL AND to_regclass('toy_si.obligations_cadence_projection') IS NOT NULL);");
        if (ready !== true) throw new OwnerRefusal();
        return run(openOwner(connection, clock, root, guard, diagnostic));
      });
    } catch (error) {
      diagnostic?.(checkViewSchema.parse({ id: "capacity.trial-journal", owner: "self-improvement", state: "BLOCKED", checkedAt: new Date().toISOString(),
        reasonCode: error instanceof AccountingFailure ? error.reason : "CAPACITY_TRIAL_FIXTURE_REFUSED", prerequisite: null, nextCommandId: "probe.show",
        links: { recordRefs: [], observations: [], artifactDigests: [] } }));
      return { ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false, effectState: "unknown" } };
    }
  },
};
