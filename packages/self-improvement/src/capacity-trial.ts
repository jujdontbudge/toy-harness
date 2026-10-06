import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkViewSchema, cadenceSlotStateSchema, capacityTrialArmSchema, capacityTrialDeferralSchema, capacityTrialReportSchema, capacityTrialSlotSchema, opsErrorMessages, uuidSchema } from "@toy/contracts";
import type { CapacityTrialArmV1, CheckViewV1, CapacityTrialJournalApi, CapacityTrialReportV1, CapacityTrialSlotV1, ModelAdmissionConnectionV1, OpsControlContextV1, Result } from "@toy/contracts";
import { OpsTestStack, TestClockControl, trustedCheckoutRoot } from "@toy/ops/public";
import { AccountingFailure, accountingQuery, accountingTestConnection, sqlJson, sqlText, withAccountingFixture } from "./accounting-postgres.js";
import { capacityTrialMigration } from "./capacity-trial-migration.js";

class TrialConflict extends Error {}
const attempt = <Data>(run: () => Data, diagnostic?: (check: CheckViewV1) => void): Result<Data> => {
  try { return { ok: true, data: run() }; }
  catch (error) {
    const code = error instanceof TrialConflict ? "CONFLICT" : "ATTESTATION_INVALID";
    if (!(error instanceof TrialConflict)) diagnostic?.(checkViewSchema.parse({ id: "capacity.trial-journal", owner: "self-improvement", state: "BLOCKED", checkedAt: new Date().toISOString(), reasonCode: error instanceof AccountingFailure ? error.reason : "CAPACITY_TRIAL_OWNER_REFUSED", prerequisite: null, nextCommandId: "probe.show", links: { recordRefs: [], observations: [], artifactDigests: [] } }));
    return { ok: false, error: { module: "ops", code, message: opsErrorMessages[code], retryable: false, effectState: "unknown" } };
  }
};
const stamp = (column: string): string => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

const openFixture = (connection: ModelAdmissionConnectionV1, clock: () => string, guard: () => void, diagnostic?: (check: CheckViewV1) => void): CapacityTrialJournalApi => {
  const readReport = (rawArmId: string): CapacityTrialReportV1 => {
    guard();
    const armId = uuidSchema.parse(rawArmId);
    const states = cadenceSlotStateSchema.options.map(state => "(" + sqlText(state) + ")").join(",");
    return capacityTrialReportSchema.parse(accountingQuery(connection, `SELECT jsonb_build_object(
      'arm', a.manifest, 'endsAt', ${stamp("a.ends_at")}, 'denominator', 3360, 'cadenceSeconds', 180,
      'totalSlots', (SELECT count(*) FROM toy_si.cadence_slot WHERE arm_id=a.id),
      'sequenceIntact', (SELECT count(*)=3360 AND bool_and(job_key=a.job_key AND slot_at=a.anchor+trial_slot_index*interval '180 seconds') FROM toy_si.cadence_slot WHERE arm_id=a.id),
      'firstSlotAt', (SELECT ${stamp("min(slot_at)")} FROM toy_si.cadence_slot WHERE arm_id=a.id),
      'lastSlotAt', (SELECT ${stamp("max(slot_at)")} FROM toy_si.cadence_slot WHERE arm_id=a.id),
      'counts', (SELECT jsonb_object_agg(s.state, (SELECT count(*) FROM toy_si.cadence_slot WHERE arm_id=a.id AND state=s.state)) FROM (VALUES ${states}) s(state)),
      'reasons', coalesce((SELECT jsonb_agg(jsonb_build_object('reason',r.reason,'count',r.n) ORDER BY r.reason) FROM (SELECT reason,count(*) n FROM toy_si.cadence_slot WHERE arm_id=a.id AND reason IS NOT NULL GROUP BY reason) r),'[]'::jsonb),
      'acceptanceComplete', false, 'fullCadenceVerdict', 'NOT_EVALUATED')
      FROM toy_si.capacity_trial_arm a WHERE a.id=${sqlText(armId)}::uuid;`));
  };
  const readSlot = (rawArmId: string, rawIndex: number): CapacityTrialSlotV1 => {
    guard();
    const armId = uuidSchema.parse(rawArmId);
    const index = capacityTrialSlotSchema.shape.index.parse(rawIndex);
    return capacityTrialSlotSchema.parse(accountingQuery(connection, `SELECT jsonb_build_object(
      'armId',arm_id,'index',trial_slot_index,'slotAt',${stamp("slot_at")},'state',state,'reason',reason,'updatedAt',${stamp("updated_at")})
      FROM toy_si.cadence_slot WHERE arm_id=${sqlText(armId)}::uuid AND trial_slot_index=${index};`));
  };
  return {
    startArm(raw: CapacityTrialArmV1): Result<CapacityTrialReportV1> {
      const parsed = capacityTrialArmSchema.safeParse(raw);
      if (!parsed.success) return { ok: false, error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false } };
      return attempt(() => {
        guard();
        const arm = parsed.data;
        const old = capacityTrialArmSchema.nullable().parse(accountingQuery(connection, `SELECT coalesce((SELECT manifest FROM toy_si.capacity_trial_arm WHERE id=${sqlText(arm.armId)}::uuid OR request_id=${sqlText(arm.requestId)}::uuid LIMIT 1),'null'::jsonb);`));
        if (old !== null) {
          if (JSON.stringify(old) !== JSON.stringify(arm)) throw new TrialConflict();
          return readReport(arm.armId);
        }
        if (clock() !== arm.anchor) throw new TrialConflict();
        const overlap = accountingQuery(connection, `SELECT to_jsonb(EXISTS (SELECT 1 FROM toy_si.capacity_trial_arm WHERE job_key=${sqlText(arm.jobKey)} AND ends_at>${sqlText(arm.anchor)}::timestamptz AND anchor<${sqlText(arm.anchor)}::timestamptz+interval '168 hours'));`);
        if (overlap === true) throw new TrialConflict();
        accountingQuery(connection, `SELECT pg_advisory_xact_lock(18374692);
          DO $trial$ BEGIN
            IF EXISTS (SELECT 1 FROM toy_si.capacity_trial_arm WHERE job_key=${sqlText(arm.jobKey)} AND ends_at>${sqlText(arm.anchor)}::timestamptz AND anchor<${sqlText(arm.anchor)}::timestamptz+interval '168 hours') THEN
              RAISE EXCEPTION 'CAPACITY_TRIAL_ARMS_OVERLAP';
            END IF;
          END; $trial$;
          INSERT INTO toy_si.capacity_trial_arm VALUES (${sqlText(arm.armId)}::uuid,${sqlText(arm.requestId)}::uuid,${sqlText(arm.jobKey)},${sqlText(arm.anchor)}::timestamptz,${sqlText(arm.anchor)}::timestamptz+interval '168 hours',${sqlJson(arm)});
          INSERT INTO toy_si.cadence_slot(job_key,slot_at,state,updated_at,arm_id,trial_slot_index)
          SELECT ${sqlText(arm.jobKey)},${sqlText(arm.anchor)}::timestamptz+n*interval '180 seconds','scheduled',${sqlText(arm.anchor)}::timestamptz,${sqlText(arm.armId)}::uuid,n FROM generate_series(0,3359) n;
          SELECT 'true'::jsonb;`);
        return readReport(arm.armId);
      }, diagnostic);
    },
    deferSlot(raw) {
      return attempt(() => {
        guard();
        const input = capacityTrialDeferralSchema.parse(raw);
        const old = readSlot(input.armId, input.index);
        if (old.state === input.state && old.reason === input.reason) return old;
        const now = clock();
        if (old.state !== "scheduled" || Date.parse(now) < Date.parse(old.slotAt) || Date.parse(now) >= Date.parse(old.slotAt) + 180000) throw new TrialConflict();
        accountingQuery(connection, `UPDATE toy_si.cadence_slot SET state=${sqlText(input.state)},reason=${sqlText(input.reason)},updated_at=${sqlText(now)}::timestamptz
          WHERE arm_id=${sqlText(input.armId)}::uuid AND trial_slot_index=${input.index} AND state='scheduled'; SELECT 'true'::jsonb;`, true);
        const current = readSlot(input.armId, input.index);
        if (current.state !== input.state || current.reason !== input.reason) throw new TrialConflict();
        return current;
      }, diagnostic);
    },
    reconcileArm(rawArmId) {
      return attempt(() => {
        const armId = uuidSchema.parse(rawArmId);
        readReport(armId);
        const now = clock();
        accountingQuery(connection, `UPDATE toy_si.cadence_slot SET state='missed',reason='SLOT_BOUNDARY_PASSED',updated_at=${sqlText(now)}::timestamptz
          WHERE arm_id=${sqlText(armId)}::uuid AND state='scheduled' AND slot_at+interval '180 seconds'<=${sqlText(now)}::timestamptz; SELECT 'true'::jsonb;`, true);
        return readReport(armId);
      }, diagnostic);
    },
    reportArm: armId => attempt(() => readReport(armId), diagnostic),
    slot: (armId, index) => attempt(() => readSlot(armId, index), diagnostic)
  };
};

export const CapacityTrialJournal = {
  async withTest<Data>(context: OpsControlContextV1, run: (owner: CapacityTrialJournalApi) => Result<Data> | Promise<Result<Data>>, diagnostic?: (check: CheckViewV1) => void): Promise<Result<Data>> {
    if (context.environment.kind !== "test" || context.environment.stackId === null) return { ok: false, error: { module: "ops", code: "UNAUTHORIZED", message: opsErrorMessages.UNAUTHORIZED, retryable: false } };
    try {
      const guard = (): void => {
        const owned = OpsTestStack.inspect(context);
        if (!owned.ok || !owned.data.result?.ready || owned.data.result.model !== "fake" || owned.data.result.clock !== "fake") throw new Error("CAPACITY_TRIAL_FIXTURE_UNAVAILABLE");
      };
      guard();
      const stackId = context.environment.stackId;
      const connection = accountingTestConnection(stackId);
      const clock = (): string => {
        const current = TestClockControl.get(context);
        if (!current.ok) throw new Error("CAPACITY_TRIAL_CLOCK_UNAVAILABLE");
        return current.data.virtualWall;
      };
      return await withAccountingFixture(stackId, context.timeoutMs, () => {
        const exists = accountingQuery(connection, "SELECT to_jsonb(to_regclass('toy_si.capacity_trial_arm') IS NOT NULL);");
        const source = readFileSync(join(trustedCheckoutRoot(), "packages/self-improvement/migrations/capacity-trial.sql"), "utf8");
        if (source !== capacityTrialMigration) throw new Error("CAPACITY_TRIAL_MIGRATION_CHANGED");
        if (exists !== true) accountingQuery(connection, source + "SELECT 'true'::jsonb;");
        return run(openFixture(connection, clock, guard, diagnostic));
      });
    } catch (error) {
      diagnostic?.(checkViewSchema.parse({ id: "capacity.trial-journal", owner: "self-improvement", state: "BLOCKED", checkedAt: new Date().toISOString(), reasonCode: error instanceof AccountingFailure ? error.reason : "CAPACITY_TRIAL_FIXTURE_REFUSED", prerequisite: null, nextCommandId: "probe.show", links: { recordRefs: [], observations: [], artifactDigests: [] } }));
      return { ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false, effectState: "unknown" } }; }
  }
};
