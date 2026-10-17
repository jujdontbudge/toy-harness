import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { modelAdmissionClaimSchema, modelAdmissionInputSchema, modelAdmissionRecordSchema, modelAdmissionRequestSchema, modelAdmissionRuntimeSchema, modelAdmissionSettlementSchema, modelAdmissionStoreViewSchema, modelQuotaObservationSchema, opsErrorMessages, uuidSchema } from "@toy/contracts";
import type { ModelAdmissionApi, ModelAdmissionConnectionV1, ModelAdmissionRecordV1, ModelAdmissionRuntimeV1, ModelAdmissionStoreViewV1, OpsControlContextV1, OpsErrorCode, Result } from "@toy/contracts";
import { ModelAdmissionPolicy, OpsTestStack, TestClockControl, trustedCheckoutRoot } from "@toy/ops/public";
import { accountingQuery, sqlJson, sqlText } from "./accounting-postgres.js";

const denied = <Data>(code: OpsErrorCode, effectState: "none" | "unknown" = "none"): Result<Data> => ({ ok: false, error: { module: "ops", code, message: opsErrorMessages[code], retryable: false, effectState } });
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

const openOwner = (runtime: ModelAdmissionRuntimeV1, clock: () => string, guard: () => void): ModelAdmissionApi => {
  const connection = runtime.connection;
  const query = (statement: string, mutation = false): unknown => { guard(); return accountingQuery(connection, statement, mutation); };
  const readCall = (callId: string): ModelAdmissionRecordV1 | null => {
    uuidSchema.parse(callId);
    const raw = query(`SELECT COALESCE((SELECT ${recordJson("c")} FROM toy_si.model_call c WHERE id=${sqlText(callId)}::uuid),'null'::jsonb);`);
    return raw === null ? null : modelAdmissionRecordSchema.parse(raw);
  };
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
          const decision = ModelAdmissionPolicy.evaluate(modelAdmissionInputSchema.parse({ now, accountRef: request.accountRef, requested: request.requested,
            work: request.work, ledger: state.ledger, observation: state.observation, expectedFiveHourUpperPercent: request.expectedFiveHourUpperPercent,
            expectedWeeklyUpperPercent: request.expectedWeeklyUpperPercent }));
          const encodedRequest = sqlJson(request);
          const encodedDecision = sqlJson(decision);
          const data = compare(snapshotSql(request.accountRef, now, runtime.policyDigest, predicate, request.budgetGroupId), state, `
            root_budget AS (INSERT INTO toy_si.budget_group (id,root_contract_id,account_ref,policy_hash,updated_at,model_iterations,unreported_calls,started_at)
              SELECT ${sqlText(request.budgetGroupId)}::uuid,${sqlText(request.rootContractId)}::uuid,${sqlText(request.accountRef)},${sqlText(request.requested.policyDigest)},${sqlText(now)}::timestamptz,${decision.eligible?1:0},${decision.eligible?1:0},${decision.eligible?sqlText(now)+"::timestamptz":"NULL"} FROM unchanged
              ON CONFLICT (id) DO NOTHING RETURNING id),
            call_insert AS (INSERT INTO toy_si.model_call (id,run_id,budget_group_id,call_key,parent_call_id,purpose,requested_route,attempt,state,reserved_input,reserved_output,quota_snapshot_id,started_at,account_ref,policy_hash,generation,utc_day,request_hash,work,decision,reservation_charged,send_lease_active,expected_five_hour_upper_percent,expected_weekly_upper_percent)
              SELECT ${sqlText(id)}::uuid,(${encodedRequest}->>'runId')::uuid,${sqlText(request.budgetGroupId)}::uuid,${sqlText(request.callKey)},(${encodedRequest}->>'parentCallId')::uuid,${sqlText(request.work.class)},${sqlJson(request.requested)},${request.attempt},${sqlText(decision.eligible ? "reserved" : "denied")},${request.reservedInputTokens},4096,
                (${encodedDecision}->>'quotaSnapshotId')::uuid,${sqlText(now)}::timestamptz,${sqlText(request.accountRef)},${sqlText(request.requested.policyDigest)},${sqlText(request.generation)}::bigint,${sqlText(now.slice(0,10))}::date,${sqlText(requestHash)},${sqlJson(request.work)},${encodedDecision},${decision.eligible},${decision.eligible},
                (${encodedRequest}->>'expectedFiveHourUpperPercent')::numeric,(${encodedRequest}->>'expectedWeeklyUpperPercent')::numeric FROM unchanged LEFT JOIN root_budget ON TRUE RETURNING *),
            budget_charge AS (UPDATE toy_si.budget_group SET model_iterations=model_iterations+1,unreported_calls=unreported_calls+1,started_at=COALESCE(started_at,${sqlText(now)}::timestamptz),updated_at=${sqlText(now)}::timestamptz
              WHERE id=${sqlText(request.budgetGroupId)}::uuid AND ${state.budgetBinding!==null} AND EXISTS (SELECT 1 FROM call_insert WHERE reservation_charged) RETURNING id)
            SELECT COALESCE((SELECT ${recordJson("c")} FROM call_insert c),'null'::jsonb);`);
          if (data !== null) return { ok: true, data: modelAdmissionRecordSchema.parse(data) };
        }
        return denied("DEPENDENCY_UNAVAILABLE");
      } catch { return denied("DEPENDENCY_UNAVAILABLE", "unknown"); }
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
      } catch { return denied("DEPENDENCY_UNAVAILABLE","unknown"); }
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
      } catch { return denied("DEPENDENCY_UNAVAILABLE","unknown"); }
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
      } catch { return denied("DEPENDENCY_UNAVAILABLE","unknown"); }
    },
    inspect(accountRef) {
      if (!modelAdmissionInputSchema.shape.accountRef.safeParse(accountRef).success) return denied("INVALID_INPUT");
      try { return {ok:true,data:readSnapshot(accountRef,clock())}; } catch { return denied("DEPENDENCY_UNAVAILABLE"); }
    }
  };
};

const reviewIdentity = (): void => {
  const observed=spawnSync("/usr/bin/id",["-u","_toy_review"],{encoding:"utf8",timeout:1000,maxBuffer:4096,env:{LANG:"C",LC_ALL:"C",PATH:"/usr/bin:/bin:/usr/sbin:/sbin"}});
  const uid=observed.status===0&&!observed.error&&/^[1-9][0-9]*\n$/.test(observed.stdout)?Number(observed.stdout.trim()):null;
  if (uid===null||!Number.isSafeInteger(uid)||process.getuid?.()!==uid||process.geteuid?.()!==uid) throw new Error("ACCOUNTING_OWNER_UNAVAILABLE");
};

export const ModelAdmission = {
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
  forTest(context:OpsControlContextV1,policyDigest:string):Result<ModelAdmissionApi> {
    try {
      const guard=():void=>{const owned=OpsTestStack.inspect(context);if(!owned.ok||!owned.data.result?.ready||owned.data.result.model!=="fake"||owned.data.result.clock!=="fake")throw new Error("ACCOUNTING_TEST_WORLD_UNAVAILABLE");};
      guard();
      if(context.environment.kind!=="test"||context.environment.stackId===null)return denied("UNAUTHORIZED");
      const socketDirectory=join(trustedCheckoutRoot(),"build/.toy-r0-fixtures",context.environment.stackId,"postgres-socket");
      const connection:ModelAdmissionConnectionV1={socketDirectory,database:"toy",peerRole:userInfo().username,clientDigest:createHash("sha256").update(readFileSync("/opt/homebrew/opt/postgresql@17/bin/psql")).digest("hex")};
      const runtime=modelAdmissionRuntimeSchema.parse({connection,policyDigest});
      const clock=():string=>{const current=TestClockControl.get(context);if(!current.ok)throw new Error("ACCOUNTING_TEST_CLOCK_UNAVAILABLE");return current.data.virtualWall;};
      return {ok:true,data:openOwner(runtime,clock,guard)};
    } catch { return denied("DEPENDENCY_UNAVAILABLE"); }
  }
};
