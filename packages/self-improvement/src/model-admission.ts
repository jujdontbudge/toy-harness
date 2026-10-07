import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { checkViewSchema, modelAdmissionClaimSchema, modelAdmissionDecisionSchema, modelAdmissionInputSchema, modelAdmissionRecordSchema, modelAdmissionRequestSchema, modelAdmissionRuntimeSchema, modelAdmissionSettlementSchema, modelAdmissionStoreViewSchema, modelQuotaObservationSchema, opsErrorMessages, uuidSchema } from "@toy/contracts";
import type { CheckViewV1, ModelAdmissionApi, ModelAdmissionRecordV1, ModelAdmissionRuntimeV1, ModelAdmissionStoreViewV1, OpsControlContextV1, OpsErrorCode, Result } from "@toy/contracts";
import { ModelAdmissionPolicy, OpsTestStack, TestClockControl } from "@toy/ops/public";
import { AccountingFailure, accountingQuery, accountingTestConnection, sqlJson, sqlText, withAccountingFixture } from "./accounting-postgres.js";

const denied = <Data>(code: OpsErrorCode, effectState: "none" | "unknown" = "none"): Result<Data> => ({ ok: false, error: { module: "ops", code, message: opsErrorMessages[code], retryable: false, effectState } });
const unavailable = <Data>(error: unknown, effectState: "none" | "unknown" = "unknown", diagnostic?: (check: CheckViewV1) => void): Result<Data> => {
  diagnostic?.(checkViewSchema.parse({id:"accounting.model-admission",owner:"self-improvement",state:"BLOCKED",checkedAt:new Date().toISOString(),
    reasonCode:error instanceof AccountingFailure?error.reason:"ACCOUNTING_OWNER_DEPENDENCY_UNAVAILABLE",prerequisite:null,nextCommandId:"probe.show",links:{recordRefs:[],observations:[],artifactDigests:[]}} satisfies CheckViewV1));
  return denied<Data>("DEPENDENCY_UNAVAILABLE", effectState);
};
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const stamp = (column: string): string => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const recordJson = (alias: string): string => `jsonb_build_object(
  'id', ${alias}.id, 'callKey', ${alias}.call_key, 'requestHash', ${alias}.request_hash,
  'budgetGroupId', ${alias}.budget_group_id, 'accountRef', ${alias}.account_ref, 'utcDay', ${alias}.utc_day::text,
  'runId', ${alias}.run_id, 'generation', ${alias}.generation::text,
  'requested', ${alias}.requested_route, 'work', ${alias}.work, 'state', ${alias}.state,
  'reservationCharged', ${alias}.reservation_charged, 'leaseActive', ${alias}.send_lease_active,
  'nativeSendCount', ${alias}.native_send_count, 'nativeTerminalAcknowledged', ${alias}.native_terminal_acknowledged,
  'decision', ${alias}.decision, 'expectedFiveHourUpperPercent', ${alias}.expected_five_hour_upper_percent,
  'expectedWeeklyUpperPercent', ${alias}.expected_weekly_upper_percent,
  'usage', CASE WHEN ${alias}.actual_input IS NOT NULL AND ${alias}.actual_output IS NOT NULL AND ${alias}.actual_reasoning IS NOT NULL
    THEN jsonb_build_object('inputTokens', ${alias}.actual_input, 'outputTokens', ${alias}.actual_output, 'reasoningTokens', ${alias}.actual_reasoning) ELSE NULL END,
  'reportedTotalTokens', ${alias}.actual_total::text, 'startedAt', ${stamp(alias + ".started_at")}, 'endedAt', ${stamp(alias + ".ended_at")})`;
const queuePriority = (workClass: string): number | null => workClass === "event" || workClass === "continuation" ? 1
  : workClass === "quiet-tick" ? 2 : ["repair", "replay", "child", "research", "judge", "auxiliary"].includes(workClass) ? 3 : null;
const pendingPredicate = (accountRef: string, now: string, alias = "c"): string => `${alias}.account_ref=${sqlText(accountRef)} AND ${alias}.utc_day=${sqlText(now.slice(0,10))}::date
  AND ${alias}.state='denied' AND NOT ${alias}.reservation_charged AND ${alias}.native_send_count=0 AND NOT ${alias}.native_terminal_acknowledged AND ${alias}.ended_at IS NULL
  AND (${alias}.decision->>'retryAt' IS NOT NULL OR ${alias}.decision->>'reason' IN ('QUOTA_EXHAUSTED','OPTIONAL_WORK_PAUSED')) AND ${alias}.decision->>'mode' IN ('measured','fixed-count')
  AND ${alias}.decision->>'reason' IN ('FIVE_HOUR_THRESHOLD','WEEKLY_THRESHOLD','RESERVATION_THRESHOLD','QUOTA_EXHAUSTED','OPTIONAL_WORK_PAUSED')
  AND ${alias}.purpose IN ('event','continuation','quiet-tick','repair','replay','child','research','judge','auxiliary')`;
const pendingOrder = (alias = "c"): string => `CASE WHEN ${alias}.purpose IN ('event','continuation') THEN 1 WHEN ${alias}.purpose='quiet-tick' THEN 2 ELSE 3 END, ${alias}.started_at, ${alias}.id`;
const pendingHeadCtes = (accountRef: string, now: string, expected: ModelAdmissionRecordV1 | null): string => {
  const match = expected === null ? "NOT EXISTS (SELECT 1 FROM pending_head)"
    : `EXISTS (SELECT 1 FROM pending_head WHERE id=${sqlText(expected.id)}::uuid AND call_key=${sqlText(expected.callKey)} AND retry_at IS NOT DISTINCT FROM ${expected.decision.retryAt === null ? "NULL" : sqlText(expected.decision.retryAt)})`;
  return `pending_head AS (SELECT c.id,c.call_key,c.decision->>'retryAt' AS retry_at FROM toy_si.model_call c WHERE ${pendingPredicate(accountRef,now)} ORDER BY ${pendingOrder("c")} LIMIT 1),
    pending_guard AS (SELECT 1 FROM unchanged WHERE ${match})`;
};
const pendingRowsSql = (accountRef: string, now: string): string => `SELECT COALESCE(jsonb_agg(queued.record ORDER BY queued.priority,queued.started_at,queued.id),'[]'::jsonb)
  FROM (SELECT ${recordJson("c")} AS record,CASE WHEN c.purpose IN ('event','continuation') THEN 1 WHEN c.purpose='quiet-tick' THEN 2 ELSE 3 END AS priority,c.started_at,c.id
    FROM toy_si.model_call c WHERE ${pendingPredicate(accountRef,now)}) queued`;
const snapshotSql = (accountRef: string, now: string, policyDigest: string, recordPredicate = "FALSE", budgetId: string | null = null, ignoreId: string | null = null): string => {
  const account = sqlText(accountRef);
  const day = sqlText(now.slice(0, 10)) + "::date";
  const ignore = ignoreId === null ? "TRUE" : "id <> " + sqlText(ignoreId) + "::uuid";
  const pending = `account_ref=${account} AND reservation_charged AND reflected_at_snapshot_id IS NULL AND state <> 'denied' AND ${ignore}`;
  return `SELECT jsonb_build_object('ledger', jsonb_build_object(
    'accountRef', ${account}, 'utcDay', ${day}::text, 'policyDigest', ${sqlText(policyDigest)}, 'ready', true,
    'restoredUnreconciled', EXISTS (SELECT 1 FROM toy_si.budget_group WHERE account_ref=${account} AND state='restored_unreconciled'),
    'providerLeaseActive', EXISTS (SELECT 1 FROM toy_si.model_call WHERE send_lease_active AND ${ignore}),
    'foregroundWaiting', EXISTS (SELECT 1 FROM toy_si.model_call WHERE purpose IN ('foreground', 'foreground-judge') AND state='denied' AND NOT reservation_charged AND ended_at IS NULL AND utc_day=${day} AND decision->>'reason'='PROVIDER_BUSY'),
    'fallbackJobsReserved', (SELECT count(*) FROM toy_si.model_call WHERE account_ref=${account} AND utc_day=${day} AND reservation_charged AND purpose NOT IN ('foreground', 'foreground-judge') AND ${ignore}),
    'unreflectedFiveHourUpperPercent', (SELECT CASE WHEN count(*) FILTER (WHERE expected_five_hour_upper_percent IS NULL)>0 THEN NULL ELSE COALESCE(sum(expected_five_hour_upper_percent),0) END FROM toy_si.model_call WHERE ${pending}),
    'unreflectedWeeklyUpperPercent', (SELECT CASE WHEN count(*) FILTER (WHERE expected_weekly_upper_percent IS NULL)>0 THEN NULL ELSE COALESCE(sum(expected_weekly_upper_percent),0) END FROM toy_si.model_call WHERE ${pending})),
    'observation', (SELECT observation FROM toy_si.quota_snapshot WHERE account_ref=${account} ORDER BY observation_seq DESC LIMIT 1),
    'record', (SELECT ${recordJson("c")} FROM toy_si.model_call c WHERE ${recordPredicate}),
    'budgetBinding', ${budgetId === null ? "NULL" : `(SELECT jsonb_build_object('rootContractId',root_contract_id,'accountRef',account_ref,'policyDigest',policy_hash,'state',state) FROM toy_si.budget_group WHERE id=${sqlText(budgetId)}::uuid)`}) AS snapshot`;
};

const openOwner = (runtime: ModelAdmissionRuntimeV1, clock: () => string, guard: () => void, diagnostic?: (check: CheckViewV1) => void): ModelAdmissionApi => {
  const connection = runtime.connection;
  const query = (statement: string, mutation = false): unknown => { guard(); return accountingQuery(connection, statement, mutation); };
  const readCall = (callId: string): ModelAdmissionRecordV1 | null => {
    uuidSchema.parse(callId);
    const raw = query(`SELECT COALESCE((SELECT ${recordJson("c")} FROM toy_si.model_call c WHERE id=${sqlText(callId)}::uuid),'null'::jsonb);`);
    return raw === null ? null : modelAdmissionRecordSchema.parse(raw);
  };
  const readCallByKey = (accountRef: string, callKey: string): ModelAdmissionRecordV1 | null => {
    const raw = query(`SELECT COALESCE((SELECT ${recordJson("c")} FROM toy_si.model_call c WHERE c.account_ref=${sqlText(accountRef)} AND c.call_key=${sqlText(callKey)}),'null'::jsonb);`);
    return raw === null ? null : modelAdmissionRecordSchema.parse(raw);
  };
  const readPending = (accountRef: string, now: string): readonly ModelAdmissionRecordV1[] => modelAdmissionRecordSchema.array().parse(query(pendingRowsSql(accountRef,now) + ";"));
  const readSnapshot = (accountRef: string, now: string, predicate = "FALSE", budgetId: string | null = null, ignoreId: string | null = null): ModelAdmissionStoreViewV1 =>
    modelAdmissionStoreViewSchema.parse(query(snapshotSql(accountRef, now, runtime.policyDigest, predicate, budgetId, ignoreId) + ";"));
  const compare = (snapshot: string, expected: ModelAdmissionStoreViewV1, statements: string): unknown => query(`
    WITH current_state AS (${snapshot}), unchanged AS (SELECT 1 FROM current_state WHERE snapshot=${sqlJson(expected)}), ${statements}`, true);
  return {
    reserve(raw) {
      const parsed = modelAdmissionRequestSchema.safeParse(raw);
      if (!parsed.success) return denied("INVALID_INPUT");
      const request = parsed.data;
      const requestHash = hash(request);
      const id = randomUUID();
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const now = clock();
          const predicate = "call_key=" + sqlText(request.callKey);
          const state = readSnapshot(request.accountRef, now, predicate, request.budgetGroupId);
          if (state.record !== null) return state.record.requestHash === requestHash ? { ok: true, data: state.record } : denied("CONFLICT");
          if (state.budgetBinding !== null && (state.budgetBinding.rootContractId !== request.rootContractId || state.budgetBinding.accountRef !== request.accountRef
            || state.budgetBinding.policyDigest !== request.requested.policyDigest || state.budgetBinding.state !== "open")) return denied("CONFLICT");
          if (request.work.class === "foreground-judge") {
            if (request.parentCallId !== request.work.parentCallId) return denied("UNAUTHORIZED");
            const parent = readCall(request.work.parentCallId);
            if (parent === null || parent.accountRef !== request.accountRef || parent.budgetGroupId !== request.budgetGroupId
              || parent.runId !== request.runId || parent.generation !== request.generation || parent.work.class !== "foreground"
              || parent.work.authenticatedRequestId !== request.work.authenticatedRequestId) return denied("UNAUTHORIZED");
          }
          const baseDecision = ModelAdmissionPolicy.evaluate(modelAdmissionInputSchema.parse({ now, accountRef: request.accountRef, requested: request.requested,
            work: request.work, ledger: state.ledger, observation: state.observation, expectedFiveHourUpperPercent: request.expectedFiveHourUpperPercent,
            expectedWeeklyUpperPercent: request.expectedWeeklyUpperPercent }));
          const requestPriority = queuePriority(request.work.class);
          const pending = requestPriority === null ? [] : readPending(request.accountRef,now);
          const pendingHead = pending[0] ?? null;
          const headPriority = pendingHead === null ? null : queuePriority(pendingHead.work.class);
          const pausedByOwner = baseDecision.eligible && requestPriority !== null && pendingHead !== null && headPriority !== null
            && requestPriority > headPriority;
          const decision = pausedByOwner && pendingHead !== null ? modelAdmissionDecisionSchema.parse({...baseDecision,eligible:false,mode:pendingHead.decision.mode,quotaSnapshotId:pendingHead.decision.quotaSnapshotId,
            reason:"OPTIONAL_WORK_PAUSED",retryAt:pendingHead.decision.retryAt}) : baseDecision;
          const admittedForeground = request.work.class === "foreground"
            ? { purpose: request.work.class, authenticatedRequestId: request.work.authenticatedRequestId }
            : null;
          const foregroundPurpose = admittedForeground?.purpose ?? "";
          const authenticatedRequestId = admittedForeground?.authenticatedRequestId ?? "";
          const encodedRequest = sqlJson(request);
          const encodedDecision = sqlJson(decision);
          const queueCtes = requestPriority === null ? "pending_guard AS (SELECT 1 FROM unchanged)" : pendingHeadCtes(request.accountRef,now,pendingHead);
          const data = compare(snapshotSql(request.accountRef, now, runtime.policyDigest, predicate, request.budgetGroupId), state, `
            ${queueCtes},
            root_budget AS (INSERT INTO toy_si.budget_group (id,root_contract_id,account_ref,policy_hash,updated_at,model_iterations,unreported_calls,started_at)
              SELECT ${sqlText(request.budgetGroupId)}::uuid,${sqlText(request.rootContractId)}::uuid,${sqlText(request.accountRef)},${sqlText(request.requested.policyDigest)},${sqlText(now)}::timestamptz,${decision.eligible?1:0},${decision.eligible?1:0},${decision.eligible?sqlText(now)+"::timestamptz":"NULL"} FROM pending_guard
              ON CONFLICT (id) DO NOTHING RETURNING id),
            call_insert AS (INSERT INTO toy_si.model_call (id,run_id,budget_group_id,call_key,parent_call_id,purpose,requested_route,attempt,state,reserved_input,reserved_output,quota_snapshot_id,started_at,account_ref,policy_hash,generation,utc_day,request_hash,work,decision,reservation_charged,send_lease_active,expected_five_hour_upper_percent,expected_weekly_upper_percent)
              SELECT ${sqlText(id)}::uuid,(${encodedRequest}->>'runId')::uuid,${sqlText(request.budgetGroupId)}::uuid,${sqlText(request.callKey)},(${encodedRequest}->>'parentCallId')::uuid,${sqlText(request.work.class)},${sqlJson(request.requested)},${request.attempt},${sqlText(decision.eligible ? "reserved" : "denied")},${request.reservedInputTokens},4096,
                (${encodedDecision}->>'quotaSnapshotId')::uuid,${sqlText(now)}::timestamptz,${sqlText(request.accountRef)},${sqlText(request.requested.policyDigest)},${sqlText(request.generation)}::bigint,${sqlText(now.slice(0,10))}::date,${sqlText(requestHash)},${sqlJson(request.work)},${encodedDecision},${decision.eligible},${decision.eligible},
                (${encodedRequest}->>'expectedFiveHourUpperPercent')::numeric,(${encodedRequest}->>'expectedWeeklyUpperPercent')::numeric FROM pending_guard LEFT JOIN root_budget ON TRUE RETURNING *),
            foreground_waiter_retire AS (UPDATE toy_si.model_call prior_call SET ended_at=${sqlText(now)}::timestamptz
              WHERE ${admittedForeground !== null} AND prior_call.purpose=${sqlText(foregroundPurpose)} AND prior_call.work->>'authenticatedRequestId'=${sqlText(authenticatedRequestId)}
                AND prior_call.state='denied' AND NOT prior_call.reservation_charged AND prior_call.decision->>'reason'='PROVIDER_BUSY'
                AND prior_call.ended_at IS NULL AND prior_call.native_send_count=0 AND NOT prior_call.native_terminal_acknowledged
                AND EXISTS (SELECT 1 FROM call_insert fresh WHERE fresh.state='reserved' AND fresh.reservation_charged = true
                  AND fresh.decision->>'eligible'='true' AND fresh.purpose='foreground'
                  AND fresh.purpose=${sqlText(foregroundPurpose)} AND fresh.work->>'authenticatedRequestId'=${sqlText(authenticatedRequestId)}
                  AND fresh.utc_day=prior_call.utc_day) RETURNING prior_call.id),
            budget_charge AS (UPDATE toy_si.budget_group SET model_iterations=model_iterations+1,unreported_calls=unreported_calls+1,started_at=COALESCE(started_at,${sqlText(now)}::timestamptz),updated_at=${sqlText(now)}::timestamptz
              WHERE id=${sqlText(request.budgetGroupId)}::uuid AND ${state.budgetBinding!==null} AND EXISTS (SELECT 1 FROM call_insert WHERE reservation_charged) RETURNING id)
            SELECT COALESCE((SELECT ${recordJson("c")} FROM call_insert c),'null'::jsonb);`);
          if (data !== null) return { ok: true, data: modelAdmissionRecordSchema.parse(data) };
        }
        return denied("DEPENDENCY_UNAVAILABLE");
      } catch (error) { return unavailable(error,"unknown",diagnostic); }
    },
    claimSend(callId) {
      if (!uuidSchema.safeParse(callId).success) return denied("INVALID_INPUT");
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const record = readCall(callId);
          if (record === null) return denied("INVALID_INPUT");
          if (record.state !== "reserved" || record.nativeSendCount !== 0 || !record.leaseActive) return { ok: true, data: modelAdmissionClaimSchema.parse({claimed:false,record,providerSendPermitIssued:false}) };
          const now = clock();
          if (record.utcDay !== now.slice(0,10)) return denied("ATTESTATION_INVALID");
          const predicate = "id=" + sqlText(callId) + "::uuid";
          const state = readSnapshot(record.accountRef, now, predicate, record.budgetGroupId, callId);
          const decision = ModelAdmissionPolicy.evaluate({now,accountRef:record.accountRef,requested:record.requested,work:record.work,ledger:state.ledger,observation:state.observation,
            expectedFiveHourUpperPercent:record.expectedFiveHourUpperPercent,expectedWeeklyUpperPercent:record.expectedWeeklyUpperPercent});
          const data = compare(snapshotSql(record.accountRef, now, runtime.policyDigest, predicate, record.budgetGroupId, callId),state,`
            claimed AS (UPDATE toy_si.model_call SET state=${sqlText(decision.eligible?"sending":"denied")},native_send_count=${decision.eligible?1:0},send_lease_active=${decision.eligible},decision=${sqlJson(decision)} WHERE id=${sqlText(callId)}::uuid AND state='reserved' AND native_send_count=0 AND send_lease_active AND EXISTS (SELECT 1 FROM unchanged) RETURNING *)
            SELECT COALESCE((SELECT ${recordJson("c")} FROM claimed c),'null'::jsonb);`);
          if (data !== null) return {ok:true,data:modelAdmissionClaimSchema.parse({claimed:decision.eligible,record:modelAdmissionRecordSchema.parse(data),providerSendPermitIssued:false})};
        }
        return denied("DEPENDENCY_UNAVAILABLE");
      } catch (error) { return unavailable(error,"unknown",diagnostic); }
    },
    settle(raw) {
      const parsed=modelAdmissionSettlementSchema.safeParse(raw);
      if (!parsed.success) return denied("INVALID_INPUT");
      const settlement=parsed.data;
      try {
        const existing=readCall(settlement.callId);
        if (existing===null) return denied("INVALID_INPUT");
        if (!existing.reservationCharged) return denied("INVALID_INPUT");
        const compatible = (record: ModelAdmissionRecordV1): boolean => (settlement.usage === null
          || (JSON.stringify(record.usage) === JSON.stringify(settlement.usage) && record.reportedTotalTokens === settlement.reportedTotalTokens))
          && (!settlement.nativeTerminalAcknowledged || record.nativeTerminalAcknowledged);
        if (existing.state==='settled') {
          return compatible(existing)?{ok:true,data:existing}:denied("CONFLICT");
        }
        if (existing.usage!==null && settlement.usage!==null
          && (JSON.stringify(existing.usage)!==JSON.stringify(settlement.usage)||existing.reportedTotalTokens!==settlement.reportedTotalTokens)) return denied("CONFLICT");
        const now=clock();
        const encoded=sqlJson(settlement);
        const data=query(`WITH settled AS (UPDATE toy_si.model_call c SET native_terminal_acknowledged=c.native_terminal_acknowledged OR ${settlement.nativeTerminalAcknowledged},
            send_lease_active=NOT (c.native_terminal_acknowledged OR ${settlement.nativeTerminalAcknowledged}),state=CASE WHEN (c.actual_input IS NOT NULL OR ${settlement.usage!==null}) AND (c.native_terminal_acknowledged OR ${settlement.nativeTerminalAcknowledged}) THEN 'settled' ELSE 'uncertain' END,
            actual_input=COALESCE(c.actual_input,(${encoded}->'usage'->>'inputTokens')::bigint),actual_output=COALESCE(c.actual_output,(${encoded}->'usage'->>'outputTokens')::bigint),actual_reasoning=COALESCE(c.actual_reasoning,(${encoded}->'usage'->>'reasoningTokens')::bigint),actual_total=COALESCE(c.actual_total,(${encoded}->>'reportedTotalTokens')::bigint),
            ended_at=CASE WHEN c.native_terminal_acknowledged OR ${settlement.nativeTerminalAcknowledged} THEN COALESCE(c.ended_at,${sqlText(now)}::timestamptz) ELSE NULL END,settlement_hash=${sqlText(hash(settlement))}
            WHERE c.id=${sqlText(settlement.callId)}::uuid AND c.state<>'settled' AND c.reservation_charged
              AND (${encoded}->'usage'='null'::jsonb OR c.actual_input IS NULL OR (jsonb_build_object('inputTokens',c.actual_input,'outputTokens',c.actual_output,'reasoningTokens',c.actual_reasoning)=${encoded}->'usage' AND c.actual_total::text=${encoded}->>'reportedTotalTokens')) RETURNING c.*),
          budget_settle AS (UPDATE toy_si.budget_group b SET input_tokens=b.input_tokens+s.actual_input,output_tokens=b.output_tokens+s.actual_output,
            reasoning_tokens=COALESCE(b.reasoning_tokens,0)+s.actual_reasoning,reported_total_tokens=b.reported_total_tokens+s.actual_total,unreported_calls=b.unreported_calls-1,updated_at=${sqlText(now)}::timestamptz
            FROM settled s WHERE b.id=s.budget_group_id AND s.state='settled' AND s.reservation_charged RETURNING b.id)
          SELECT COALESCE((SELECT ${recordJson("c")} FROM settled c),'null'::jsonb);`,true);
        if (data!==null) return {ok:true,data:modelAdmissionRecordSchema.parse(data)};
        const readback=readCall(settlement.callId);
        return readback!==null&&readback.state==='settled'&&compatible(readback)?{ok:true,data:readback}:denied("CONFLICT");
      } catch (error) { return unavailable(error,"unknown",diagnostic); }
    },
    observe(raw) {
      const parsed=modelQuotaObservationSchema.safeParse(raw);
      if (!parsed.success) return denied("INVALID_INPUT");
      const observation=parsed.data;
      try {
        const encoded=sqlJson(observation);
        const data=query(`WITH inserted AS (INSERT INTO toy_si.quota_snapshot (id,provider,account_ref,reported_at,unit,body_ref,confidence,observation)
          VALUES (${sqlText(observation.id)}::uuid,'siwc_responses',${sqlText(observation.accountRef)},${sqlText(observation.reportedAt)}::timestamptz,'named-window-percent',${sqlText(observation.bodyRef)},${sqlText(observation.sourceAuthorized?'authorized':'unavailable')},${encoded})
          ON CONFLICT (id) DO NOTHING RETURNING observation)
          SELECT COALESCE((SELECT observation FROM inserted),(SELECT observation FROM toy_si.quota_snapshot WHERE id=${sqlText(observation.id)}::uuid));`,true);
        const readback=modelQuotaObservationSchema.parse(data);
        return hash(readback)===hash(observation)?{ok:true,data:readback}:denied("CONFLICT");
      } catch (error) { return unavailable(error,"unknown",diagnostic); }
    },
    inspect(accountRef) {
      if (!modelAdmissionInputSchema.shape.accountRef.safeParse(accountRef).success) return denied("INVALID_INPUT");
      try { return {ok:true,data:readSnapshot(accountRef,clock())}; } catch (error) { return unavailable(error,"none",diagnostic); }
    },
    inspectPending(accountRef) {
      if (!modelAdmissionInputSchema.shape.accountRef.safeParse(accountRef).success) return denied("INVALID_INPUT");
      try { return {ok:true,data:readPending(accountRef,clock())}; } catch (error) { return unavailable(error,"none",diagnostic); }
    },
    resumePending(accountRef,callKey) {
      if (!modelAdmissionInputSchema.shape.accountRef.safeParse(accountRef).success || !modelAdmissionRequestSchema.shape.callKey.safeParse(callKey).success) return denied("INVALID_INPUT");
      try {
        for (let attempt=0;attempt<3;attempt+=1) {
          const target=readCallByKey(accountRef,callKey);
          if (target===null) return denied("INVALID_INPUT");
          if (target.state!=="denied" || target.reservationCharged || target.nativeSendCount!==0 || target.nativeTerminalAcknowledged || target.endedAt!==null) return {ok:true,data:target};
          const now=clock();
          if (target.utcDay!==now.slice(0,10) || queuePriority(target.work.class)===null) return denied("CONFLICT");
          const predicate="account_ref="+sqlText(accountRef)+" AND call_key="+sqlText(callKey);
          const state=readSnapshot(accountRef,now,predicate,target.budgetGroupId);
          const binding=state.budgetBinding;
          if (binding===null || binding.accountRef!==accountRef || binding.policyDigest!==target.requested.policyDigest
            || binding.policyDigest!==runtime.policyDigest || binding.state!=="open") return denied("CONFLICT");
          const pending=readPending(accountRef,now);
          const head=pending[0]??null;
          if (head===null || head.id!==target.id || head.callKey!==target.callKey) return denied("CONFLICT");
          const decision=ModelAdmissionPolicy.evaluate(modelAdmissionInputSchema.parse({now,accountRef,requested:target.requested,work:target.work,ledger:state.ledger,observation:state.observation,
            expectedFiveHourUpperPercent:target.expectedFiveHourUpperPercent,expectedWeeklyUpperPercent:target.expectedWeeklyUpperPercent}));
          const encodedDecision=sqlJson(decision);
          const guardCtes=`${pendingHeadCtes(accountRef,now,head)},
            budget_guard AS (SELECT 1 FROM toy_si.budget_group b CROSS JOIN unchanged WHERE b.id=${sqlText(target.budgetGroupId)}::uuid
              AND b.root_contract_id=${sqlText(binding.rootContractId)}::uuid AND b.account_ref=${sqlText(accountRef)} AND b.policy_hash=${sqlText(runtime.policyDigest)} AND b.state='open')`;
          const data=decision.eligible
            ? compare(snapshotSql(accountRef,now,runtime.policyDigest,predicate,target.budgetGroupId),state,`
              ${guardCtes},
              pending_budget_guard AS (SELECT 1 FROM pending_guard JOIN budget_guard ON TRUE),
              resume_row AS (UPDATE toy_si.model_call c SET state='reserved',reservation_charged=true,send_lease_active=true,decision=${encodedDecision},quota_snapshot_id=(${encodedDecision}->>'quotaSnapshotId')::uuid
                WHERE c.id=${sqlText(target.id)}::uuid AND c.account_ref=${sqlText(accountRef)} AND c.call_key=${sqlText(callKey)} AND c.state='denied' AND NOT c.reservation_charged
                  AND c.native_send_count=0 AND NOT c.native_terminal_acknowledged AND c.ended_at IS NULL AND EXISTS (SELECT 1 FROM pending_budget_guard) RETURNING c.*),
              budget_charge AS (UPDATE toy_si.budget_group b SET model_iterations=b.model_iterations+1,unreported_calls=b.unreported_calls+1,
                started_at=COALESCE(b.started_at,${sqlText(now)}::timestamptz),updated_at=${sqlText(now)}::timestamptz FROM resume_row r
                WHERE b.id=r.budget_group_id AND r.state='reserved' AND r.reservation_charged RETURNING b.id)
              SELECT COALESCE((SELECT ${recordJson("c")} FROM resume_row c),'null'::jsonb);`)
            : compare(snapshotSql(accountRef,now,runtime.policyDigest,predicate,target.budgetGroupId),state,`
              ${guardCtes},
              pending_budget_guard AS (SELECT 1 FROM pending_guard JOIN budget_guard ON TRUE),
              resumed_row AS (UPDATE toy_si.model_call c SET decision=${encodedDecision},quota_snapshot_id=(${encodedDecision}->>'quotaSnapshotId')::uuid
                WHERE c.id=${sqlText(target.id)}::uuid AND c.account_ref=${sqlText(accountRef)} AND c.call_key=${sqlText(callKey)} AND c.state='denied' AND NOT c.reservation_charged
                  AND c.native_send_count=0 AND NOT c.native_terminal_acknowledged AND c.ended_at IS NULL AND EXISTS (SELECT 1 FROM pending_budget_guard) RETURNING c.*)
              SELECT COALESCE((SELECT ${recordJson("c")} FROM resumed_row c),'null'::jsonb);`);
          if (data!==null) return {ok:true,data:modelAdmissionRecordSchema.parse(data)};
        }
        return denied("DEPENDENCY_UNAVAILABLE");
      } catch (error) { return unavailable(error,"unknown",diagnostic); }
    }
  };
};

const reviewIdentity = (): void => {
  const observed=spawnSync("/usr/bin/id",["-u","_toy_review"],{encoding:"utf8",timeout:1000,maxBuffer:4096,env:{LANG:"C",LC_ALL:"C",PATH:"/usr/bin:/bin:/usr/sbin:/sbin"}});
  const uid=observed.status===0&&!observed.error&&/^[1-9][0-9]*\n$/.test(observed.stdout)?Number(observed.stdout.trim()):null;
  if (uid===null||!Number.isSafeInteger(uid)||process.getuid?.()!==uid||process.geteuid?.()!==uid) throw new Error("ACCOUNTING_OWNER_UNAVAILABLE");
};

export const ModelAdmission = {
  async withTest<Data>(context: OpsControlContextV1, policyDigest: string, run: (owner: ModelAdmissionApi) => Result<Data> | Promise<Result<Data>>, diagnostic?: (check: CheckViewV1) => void): Promise<Result<Data>> {
    const opened = ModelAdmission.forTest(context, policyDigest, diagnostic);
    if (!opened.ok) return opened;
    if (context.environment.kind !== "test" || context.environment.stackId === null) return denied("UNAUTHORIZED");
    try { return await withAccountingFixture(context.environment.stackId, context.timeoutMs, () => run(opened.data)); }
    catch (error) { return unavailable(error,"unknown",diagnostic); }
  },
  open(): Result<ModelAdmissionApi> {
    try {
      reviewIdentity();
      const path="/Library/Application Support/Toy/control/model-accounting.json";
      const file=lstatSync(path);
      if(!file.isFile()||file.isSymbolicLink()||file.uid!==0||(file.mode&0o022)!==0||file.size>8192) return denied("ARTIFACT_MISMATCH");
      const raw:unknown=JSON.parse(readFileSync(path,"utf8"));
      const runtime=modelAdmissionRuntimeSchema.parse(raw);
      return {ok:true,data:openOwner(runtime,()=>new Date().toISOString(),reviewIdentity)};
    } catch { return denied("DEPENDENCY_UNAVAILABLE"); }
  },
  forTest(context:OpsControlContextV1,policyDigest:string,diagnostic?: (check: CheckViewV1) => void):Result<ModelAdmissionApi> {
    try {
      const guard=():void=>{const owned=OpsTestStack.inspect(context);if(!owned.ok||!owned.data.result?.ready||owned.data.result.model!=="fake"||owned.data.result.clock!=="fake")throw new Error("ACCOUNTING_TEST_WORLD_UNAVAILABLE");};
      guard();
      if(context.environment.kind!=="test"||context.environment.stackId===null)return denied("UNAUTHORIZED");
      const connection=accountingTestConnection(context.environment.stackId);
      const runtime=modelAdmissionRuntimeSchema.parse({connection,policyDigest});
      const clock=():string=>{const current=TestClockControl.get(context);if(!current.ok)throw new Error("ACCOUNTING_TEST_CLOCK_UNAVAILABLE");return current.data.virtualWall;};
      return {ok:true,data:openOwner(runtime,clock,guard,diagnostic)};
    } catch (error) { return unavailable(error,"none",diagnostic); }
  }
};
