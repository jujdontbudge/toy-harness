import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkViewSchema, modelAdmissionRequestSchema, modelQuotaObservationSchema, modelRoutePolicySchema, opsErrorMessages } from "@toy/contracts";
import type { CheckViewV1, ModelAdmissionApi, ModelAdmissionRecordV1, ModelAdmissionRequestV1, ModelAdmissionWorkV1, ModelQuotaWindowV1, ModelRoleV1, OpsControlContextV1, OpsError, RegisteredProbeInputV1, RegisteredProbeOperationV1, Result } from "@toy/contracts";
import { TestClockControl, TestProbeControl, trustedCheckoutRoot } from "@toy/ops/public";
import { ModelAdmission } from "./model-admission.js";

class ProbeRefusal extends Error {
  constructor(readonly error: OpsError) { super("ACCOUNTING_PROBE_REFUSED"); }
}
const take = <Data>(result: Result<Data>): Data => {
  if (!result.ok) throw new ProbeRefusal(result.error);
  return result.data;
};
const exercise = (work: () => void): Result<void> => {
  try { work(); return {ok:true,data:undefined}; }
  catch (error) { return error instanceof ProbeRefusal ? {ok:false,error:error.error} : {ok:false,error:{module:"ops",code:"ATTESTATION_INVALID",message:opsErrorMessages.ATTESTATION_INVALID,retryable:false,effectState:"unknown"}}; }
};
const identity = (key: string): string => {
  const value = createHash("sha256").update(key).digest("hex");
  return `${value.slice(0,8)}-${value.slice(8,12)}-4${value.slice(13,16)}-8${value.slice(17,20)}-${value.slice(20,32)}`;
};
const check = (name: string, passed: boolean, evidence: unknown): CheckViewV1 => checkViewSchema.parse({
  id: "accounting.model-admission", owner: "self-improvement", state: passed ? "PASS" : "FAIL", checkedAt: new Date().toISOString(),
  reasonCode: passed ? "REAL_ACCOUNTING_FIXTURE_PASS" : "REAL_ACCOUNTING_FIXTURE_FAIL", prerequisite: JSON.stringify({name,evidence}), nextCommandId: "probe.show",
  links: { recordRefs: [], observations: [], artifactDigests: [createHash("sha256").update(readFileSync(new URL("./accounting-probe.js",import.meta.url))).digest("hex")] }
} satisfies CheckViewV1);
const finish = (owner: ModelAdmissionApi, record: ModelAdmissionRecordV1, known: boolean): ModelAdmissionRecordV1 => {
  if (record.nativeSendCount === 1 && record.nativeTerminalAcknowledged) return record;
  const claim = take(owner.claimSend(record.id));
  if (!claim.claimed || claim.record.nativeSendCount !== 1 || !claim.record.leaseActive) throw new Error("ACCOUNTING_FIXTURE_CLAIM_REFUSED");
  if (take(owner.claimSend(record.id)).claimed) throw new Error("ACCOUNTING_FIXTURE_DUPLICATE_SEND");
  const partial = take(owner.settle(known
    ? {callId:record.id,nativeTerminalAcknowledged:false,usage:{inputTokens:1,outputTokens:1,reasoningTokens:0},reportedTotalTokens:"2"}
    : {callId:record.id,nativeTerminalAcknowledged:false,usage:null,reportedTotalTokens:null}));
  if (!partial.leaseActive || !partial.reservationCharged) throw new Error("ACCOUNTING_FIXTURE_UNCERTAINTY_RELEASED");
  return take(owner.settle({callId:record.id,nativeTerminalAcknowledged:true,usage:null,reportedTotalTokens:null}));
};

export const accountingProbe = async (input: RegisteredProbeInputV1, context: OpsControlContextV1): Promise<Result<RegisteredProbeOperationV1>> => {
  if (input.caseId !== "model-admission" || !["AT-ops-49","AT-ops-51","AT-ops-52"].includes(input.probeId))
    return {ok:false,error:{module:"ops",code:"INVALID_INPUT",message:opsErrorMessages.INVALID_INPUT,retryable:false,effectState:"none"}};
  try {
    const content = readFileSync(join(trustedCheckoutRoot(),"behavior/models.yaml"));
    const policy = modelRoutePolicySchema.parse(JSON.parse(content.toString("utf8")));
    const policyDigest = createHash("sha256").update(content).digest("hex");
    const now = take(TestClockControl.get(context)).virtualWall;
    const prefix = context.environment.stackId + ":" + input.requestId;
    const request = (accountRef: string, key: string, work: ModelAdmissionWorkV1, role: ModelRoleV1 = "background", measured = false): ModelAdmissionRequestV1 => modelAdmissionRequestSchema.parse({
      callKey:key,budgetGroupId:identity(key+":budget"),rootContractId:identity(key+":root"),runId:identity(key+":run"),generation:"1",parentCallId:null,attempt:key.endsWith(":retry")?2:1,
      accountRef,requested:{role,arm:"original",provider:policy.provider,settings:policy.original[role],policyDigest,localOutputReservationTokens:4096,outputLimitKind:"estimate",providerOutputCap:null,paidFallbackPermitted:false},
      work,reservedInputTokens:1,expectedFiveHourUpperPercent:measured?0.001:null,expectedWeeklyUpperPercent:measured?0.001:null
    });
    const windows = (fiveHour: number | null, weekly: number | null): ModelQuotaWindowV1[] => [
      ...(fiveHour===null?[]:[{bucketId:"primary",durationMinutes:300,usedPercent:fiveHour,resetAt:new Date(Date.parse(now)+18000000).toISOString()}]),
      ...(weekly===null?[]:[{bucketId:"secondary",durationMinutes:10080,usedPercent:weekly,resetAt:new Date(Date.parse(now)+604800000).toISOString()}])
    ];
    const observe = (owner: ModelAdmissionApi, accountRef: string, key: string, values: ModelQuotaWindowV1[], unavailable = false): void => {
      take(owner.observe(modelQuotaObservationSchema.parse({id:identity(key+":quota"),provider:"siwc_responses",accountRef,reportedAt:now,sourceAuthorized:true,schemaValid:!unavailable,status:unavailable?"unavailable":"available",windows:values,bodyRef:"fixed-external-quota-fixture:"+key})));
    };
    const checks: CheckViewV1[] = [];
    const diagnostic = (value: CheckViewV1): void => { checks.push(value); };
    const reportFailure = (error: OpsError): Result<RegisteredProbeOperationV1> => {
      checks.push(check("public-accounting-interface-refused",false,{errorCode:error.code,effectState:error.effectState}));
      return TestProbeControl.run(input,context,checks);
    };
    if (input.probeId === "AT-ops-49") {
      const run = await ModelAdmission.withTest(context,policyDigest,owner => exercise(() => {
        for (const [index,pair] of [[59.9,69.9],[60,20],[20,70]].entries()) {
          const accountRef = "fixture.threshold."+prefix+":"+index;
          const key = prefix+":"+index;
          observe(owner,accountRef,key,windows(pair[0]??null,pair[1]??null));
          const autonomous: ModelAdmissionRecordV1[] = [];
          for (const workClass of ["event","quiet-tick","repair","replay","continuation","child","research","judge","auxiliary"] as const) {
            const role = workClass==="child"?"child":workClass==="research"?"research":"background";
            const background = take(owner.reserve(request(accountRef,key+":"+workClass,{class:workClass},role,true)));
            autonomous.push(background);
            if (background.decision.eligible) finish(owner,background,true);
          }
          const foreground = take(owner.reserve(request(accountRef,key+":foreground",{class:"foreground",authenticatedRequestId:identity(key+":human")},"foreground",true)));
          if (foreground.decision.eligible) finish(owner,foreground,true);
          const expectedReason = index===0?"ELIGIBLE":index===1?"FIVE_HOUR_THRESHOLD":"WEEKLY_THRESHOLD";
          checks.push(check("named-window-equality-"+index,autonomous.every(record=>record.decision.eligible===(index===0)&&record.decision.reason===expectedReason)&&foreground.decision.eligible&&foreground.decision.foregroundInputAccepted,
            {fiveHour:pair[0],weekly:pair[1],autonomous:autonomous.map(record=>({class:record.work.class,eligible:record.decision.eligible,reason:record.decision.reason})),foreground:foreground.decision}));
        }
      }),diagnostic);
      if (!run.ok) return reportFailure(run.error);
    } else if (input.probeId === "AT-ops-52") {
      const run = await ModelAdmission.withTest(context,policyDigest,owner => exercise(() => {
        const cases = [windows(null,70),windows(20,70).reverse(),windows(60,null),windows(null,70)];
        for (const [index,values] of cases.entries()) {
          const accountRef = "fixture.partial."+prefix+":"+index;
          const key = prefix+":"+index;
          observe(owner,accountRef,key,values,index===3);
          const result = take(owner.reserve(request(accountRef,key+":background",{class:"event"})));
          const expected = index===2?"FIVE_HOUR_THRESHOLD":"WEEKLY_THRESHOLD";
          checks.push(check("fresh-known-veto-"+index,!result.decision.eligible&&result.decision.reason===expected,{windows:values,status:index===3?"unavailable":"available",decision:result.decision}));
        }
      }),diagnostic);
      if (!run.ok) return reportFailure(run.error);
    } else {
      const accountRef = "fixture.daily."+prefix;
      const first = await ModelAdmission.withTest(context,policyDigest,owner => exercise(() => {
        const classes = ["event","judge","child","continuation","auxiliary","research","quiet-tick","event"] as const;
        const states: ModelAdmissionRecordV1[] = [];
        for (const [index,workClass] of classes.entries()) {
          const role = workClass==="child"?"child":workClass==="research"?"research":"background";
          const key = prefix+":"+index+(index===1?":retry":"");
          const reserved = take(owner.reserve(request(accountRef,key,{class:workClass},role)));
          if (!reserved.decision.eligible) throw new Error("ACCOUNTING_FIXTURE_EARLY_DAILY_DENIAL");
          const settled = finish(owner,reserved,index%2===0);
          states.push(settled);
        }
        const readback = take(owner.inspect(accountRef));
        checks.push(check("eight-durable-background-reservations",readback.observation===null&&readback.ledger.fallbackJobsReserved===8&&states.every(state=>state.reservationCharged&&!state.leaseActive),{states:states.map(state=>({class:state.work.class,state:state.state,charged:state.reservationCharged,leaseActive:state.leaseActive})),ledger:readback.ledger,observation:readback.observation}));
      }),diagnostic);
      if (!first.ok) return reportFailure(first.error);
      const restarted = await ModelAdmission.withTest(context,policyDigest,owner => exercise(() => {
        const ninth = take(owner.reserve(request(accountRef,prefix+":new-goal-ninth",{class:"event"})));
        const foreground = take(owner.reserve(request(accountRef,prefix+":foreground",{class:"foreground",authenticatedRequestId:identity(prefix+":human")},"foreground")));
        if (foreground.decision.eligible) finish(owner,foreground,true);
        const readback = take(owner.inspect(accountRef));
        checks.push(check("restart-new-goal-ninth-refused-foreground-exempt",!ninth.decision.eligible&&ninth.decision.reason==="DAILY_JOB_CEILING"&&foreground.decision.eligible&&readback.ledger.fallbackJobsReserved===8,
          {postgresqlRestarted:true,ninth:ninth.decision,foreground:foreground.decision,ledger:readback.ledger,observation:readback.observation}));
      }),diagnostic);
      if (!restarted.ok) return reportFailure(restarted.error);
    }
    return TestProbeControl.run(input,context,checks);
  } catch { return {ok:false,error:{module:"ops",code:"ATTESTATION_INVALID",message:opsErrorMessages.ATTESTATION_INVALID,retryable:false,effectState:"unknown"}}; }
};
