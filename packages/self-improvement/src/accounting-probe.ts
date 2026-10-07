import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkViewSchema, modelAdmissionRequestSchema, modelQuotaObservationSchema, modelRoutePolicySchema, opsErrorMessages, registeredCliAcceptanceManifestInventory } from "@toy/contracts";
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
  if (record.nativeSendCount === 0) {
    const claim = take(owner.claimSend(record.id));
    if (!claim.claimed || claim.record.nativeSendCount !== 1 || !claim.record.leaseActive) throw new Error("ACCOUNTING_FIXTURE_CLAIM_REFUSED");
  } else if (record.state !== "sending" || !record.leaseActive) throw new Error("ACCOUNTING_FIXTURE_SENDING_RECORD_REQUIRED");
  if (take(owner.claimSend(record.id)).claimed) throw new Error("ACCOUNTING_FIXTURE_DUPLICATE_SEND");
  const partial = take(owner.settle(known
    ? {callId:record.id,nativeTerminalAcknowledged:false,usage:{inputTokens:1,outputTokens:1,reasoningTokens:0},reportedTotalTokens:"2"}
    : {callId:record.id,nativeTerminalAcknowledged:false,usage:null,reportedTotalTokens:null}));
  if (!partial.leaseActive || !partial.reservationCharged) throw new Error("ACCOUNTING_FIXTURE_UNCERTAINTY_RELEASED");
  return take(owner.settle({callId:record.id,nativeTerminalAcknowledged:true,usage:null,reportedTotalTokens:null}));
};

export const accountingProbe = async (input: RegisteredProbeInputV1, context: OpsControlContextV1): Promise<Result<RegisteredProbeOperationV1>> => {
  if ((input.caseId !== undefined && input.caseId !== "model-admission") || !["AT-ops-49","AT-ops-51","AT-ops-52"].includes(input.probeId))
    return {ok:false,error:{module:"ops",code:"INVALID_INPUT",message:opsErrorMessages.INVALID_INPUT,retryable:false,effectState:"none"}};
  const phases = input.probeId === "AT-ops-49" ? ["named-window-equality-0", "named-window-equality-1", "named-window-equality-2", "foreground-contention-recovery"] : input.probeId === "AT-ops-51" ? ["eight-durable-background-reservations", "restart-new-goal-ninth-refused-foreground-exempt"] : ["fresh-known-veto-0", "fresh-known-veto-1", "fresh-known-veto-2", "fresh-known-veto-3"];
  const manifest = registeredCliAcceptanceManifestInventory.find(entry => entry.id === input.probeId);
  if (!manifest || manifest.scenarioId !== "accounting.model-admission" || JSON.stringify(manifest.mandatoryCases) !== JSON.stringify(phases.map(phase => ({ id: phase, publicOperation: "ReplayEnvironment.runRegisteredProbe", phase })))) return {ok:false,error:{module:"ops",code:"ATTESTATION_INVALID",message:opsErrorMessages.ATTESTATION_INVALID,retryable:false,effectState:"none"}};
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
        const accountRef = "fixture.contention."+prefix;
        const key = prefix+":contention";
        const authenticatedRequestIdA = identity(key+":human-a");
        const authenticatedRequestIdB = identity(key+":human-b");
        observe(owner,accountRef,key,windows(20,20));
        const eventReservation = take(owner.reserve(request(accountRef,key+":event",{class:"event"},"background",true)));
        const eventClaim = take(owner.claimSend(eventReservation.id));
        const eventSending = eventClaim.record;
        const foregroundRequestA = request(accountRef,key+":foreground-a",{class:"foreground",authenticatedRequestId:authenticatedRequestIdA},"foreground",true);
        const foregroundRequestB = request(accountRef,key+":foreground-b",{class:"foreground",authenticatedRequestId:authenticatedRequestIdB},"foreground",true);
        const foregroundBusyA = take(owner.reserve(foregroundRequestA));
        const foregroundBusyB = take(owner.reserve(foregroundRequestB));
        const duringContention = take(owner.inspect(accountRef)).ledger;
        const eventTerminal = eventClaim.claimed ? finish(owner,eventSending,true) : eventSending;
        const afterEvent = take(owner.inspect(accountRef)).ledger;
        const continuationDenied = take(owner.reserve(request(accountRef,key+":continuation",{class:"continuation"},"background",true)));
        const afterContinuationDenied = take(owner.inspect(accountRef)).ledger;
        const foregroundRetryA = take(owner.reserve(request(accountRef,key+":foreground-a:retry",{class:"foreground",authenticatedRequestId:authenticatedRequestIdA},"foreground",true)));
        const foregroundRetryATerminal = foregroundRetryA.decision.eligible ? finish(owner,foregroundRetryA,true) : foregroundRetryA;
        const foregroundAAfterFirstRetry = take(owner.reserve(foregroundRequestA));
        const foregroundBBeforeRetry = take(owner.reserve(foregroundRequestB));
        const afterForegroundRetryA = take(owner.inspect(accountRef)).ledger;
        const continuationAfterForegroundRetryA = take(owner.reserve(request(accountRef,key+":continuation-after-a",{class:"continuation"},"background",true)));
        const afterContinuationAfterForegroundRetryA = take(owner.inspect(accountRef)).ledger;
        const foregroundRetryB = take(owner.reserve(request(accountRef,key+":foreground-b:retry",{class:"foreground",authenticatedRequestId:authenticatedRequestIdB},"foreground",true)));
        const foregroundRetryBTerminal = foregroundRetryB.decision.eligible ? finish(owner,foregroundRetryB,true) : foregroundRetryB;
        const foregroundAFinal = take(owner.reserve(foregroundRequestA));
        const foregroundBFinal = take(owner.reserve(foregroundRequestB));
        const afterForegroundRetryB = take(owner.inspect(accountRef)).ledger;
        const continuationRetry = take(owner.reserve(request(accountRef,key+":continuation:retry",{class:"continuation"},"background",true)));
        const continuationRetryTerminal = continuationRetry.decision.eligible ? finish(owner,continuationRetry,true) : continuationRetry;
        const finalLedger = take(owner.inspect(accountRef)).ledger;
        const decisionFlags = (record: ModelAdmissionRecordV1) => [record.decision.eligible,record.decision.reason,record.decision.foregroundInputAccepted,record.decision.providerSendPermitIssued,record.decision.paidFallbackPermitted];
        const recordFlags = (record: ModelAdmissionRecordV1) => [record.state,record.reservationCharged,record.leaseActive,record.nativeSendCount,record.nativeTerminalAcknowledged,record.endedAt!==null];
        const unchangedWaiter = (original: ModelAdmissionRecordV1, readback: ModelAdmissionRecordV1): boolean => original.id === readback.id
          && original.callKey === readback.callKey && original.requestHash === readback.requestHash && original.accountRef === readback.accountRef && original.utcDay === readback.utcDay
          && JSON.stringify(original.work) === JSON.stringify(readback.work) && JSON.stringify(original.requested) === JSON.stringify(readback.requested)
          && JSON.stringify(original.decision) === JSON.stringify(readback.decision) && original.state === "denied" && readback.state === "denied"
          && !original.reservationCharged && !readback.reservationCharged && original.nativeSendCount === 0 && readback.nativeSendCount === 0
          && !original.nativeTerminalAcknowledged && !readback.nativeTerminalAcknowledged && original.usage === null && readback.usage === null
          && original.reportedTotalTokens === null && readback.reportedTotalTokens === null;
        const eventSettled = eventTerminal.state === "settled" && eventTerminal.reservationCharged && !eventTerminal.leaseActive && eventTerminal.nativeSendCount === 1 && eventTerminal.nativeTerminalAcknowledged;
        const foregroundRetryASettled = foregroundRetryATerminal.state === "settled" && foregroundRetryATerminal.reservationCharged && !foregroundRetryATerminal.leaseActive && foregroundRetryATerminal.nativeSendCount === 1 && foregroundRetryATerminal.nativeTerminalAcknowledged;
        const foregroundRetryBSettled = foregroundRetryBTerminal.state === "settled" && foregroundRetryBTerminal.reservationCharged && !foregroundRetryBTerminal.leaseActive && foregroundRetryBTerminal.nativeSendCount === 1 && foregroundRetryBTerminal.nativeTerminalAcknowledged;
        const continuationRetrySettled = continuationRetryTerminal.state === "settled" && continuationRetryTerminal.reservationCharged && !continuationRetryTerminal.leaseActive && continuationRetryTerminal.nativeSendCount === 1 && continuationRetryTerminal.nativeTerminalAcknowledged;
        const firstWaiterRetiredOnly = foregroundBusyA.endedAt === null && foregroundBusyB.endedAt === null && foregroundAAfterFirstRetry.endedAt !== null && foregroundBBeforeRetry.endedAt === null
          && unchangedWaiter(foregroundBusyA,foregroundAAfterFirstRetry) && unchangedWaiter(foregroundBusyB,foregroundBBeforeRetry);
        const bothWaitersRetired = foregroundAFinal.endedAt !== null && foregroundBFinal.endedAt !== null
          && unchangedWaiter(foregroundBusyA,foregroundAFinal) && unchangedWaiter(foregroundBusyB,foregroundBFinal);
        const sameUtcDay = [foregroundBusyA,foregroundBusyB,foregroundRetryA,foregroundRetryB].every(record=>record.utcDay===eventReservation.utcDay);
        const passed = eventReservation.decision.eligible && eventReservation.decision.reason === "ELIGIBLE" && eventReservation.leaseActive && eventReservation.reservationCharged
          && !eventReservation.decision.providerSendPermitIssued && !eventReservation.decision.paidFallbackPermitted
          && eventClaim.claimed && !eventClaim.providerSendPermitIssued && eventSending.state === "sending" && eventSending.nativeSendCount === 1 && eventSending.leaseActive
          && foregroundBusyA.state === "denied" && !foregroundBusyA.decision.eligible && !foregroundBusyA.reservationCharged && foregroundBusyA.decision.reason === "PROVIDER_BUSY"
          && foregroundBusyA.decision.foregroundInputAccepted && !foregroundBusyA.decision.providerSendPermitIssued
          && !foregroundBusyA.decision.paidFallbackPermitted && foregroundBusyA.nativeSendCount === 0
          && foregroundBusyB.state === "denied" && !foregroundBusyB.decision.eligible && !foregroundBusyB.reservationCharged && foregroundBusyB.decision.reason === "PROVIDER_BUSY"
          && foregroundBusyB.decision.foregroundInputAccepted && !foregroundBusyB.decision.providerSendPermitIssued
          && !foregroundBusyB.decision.paidFallbackPermitted && foregroundBusyB.nativeSendCount === 0
          && authenticatedRequestIdA !== authenticatedRequestIdB && sameUtcDay
          && duringContention.foregroundWaiting && duringContention.providerLeaseActive
          && eventSettled && afterEvent.foregroundWaiting && !afterEvent.providerLeaseActive
          && !continuationDenied.decision.eligible && continuationDenied.decision.reason === "FOREGROUND_WAITING" && continuationDenied.decision.foregroundInputAccepted && !continuationDenied.reservationCharged
          && !continuationDenied.decision.providerSendPermitIssued && !continuationDenied.decision.paidFallbackPermitted && continuationDenied.nativeSendCount === 0
          && afterContinuationDenied.foregroundWaiting && afterContinuationDenied.fallbackJobsReserved === afterEvent.fallbackJobsReserved
          && foregroundRetryA.work.class === "foreground" && foregroundRetryA.work.authenticatedRequestId === authenticatedRequestIdA
          && foregroundRetryA.decision.eligible && foregroundRetryA.decision.reason === "ELIGIBLE" && foregroundRetryA.decision.foregroundInputAccepted && !foregroundRetryA.decision.providerSendPermitIssued
          && !foregroundRetryA.decision.paidFallbackPermitted && foregroundRetryASettled && firstWaiterRetiredOnly && afterForegroundRetryA.foregroundWaiting
          && afterForegroundRetryA.fallbackJobsReserved === afterContinuationDenied.fallbackJobsReserved
          && !continuationAfterForegroundRetryA.decision.eligible && continuationAfterForegroundRetryA.decision.reason === "FOREGROUND_WAITING"
          && !continuationAfterForegroundRetryA.reservationCharged && continuationAfterForegroundRetryA.nativeSendCount === 0
          && !continuationAfterForegroundRetryA.decision.providerSendPermitIssued && !continuationAfterForegroundRetryA.decision.paidFallbackPermitted
          && afterContinuationAfterForegroundRetryA.foregroundWaiting && afterContinuationAfterForegroundRetryA.fallbackJobsReserved === afterForegroundRetryA.fallbackJobsReserved
          && foregroundRetryB.work.class === "foreground" && foregroundRetryB.work.authenticatedRequestId === authenticatedRequestIdB
          && foregroundRetryB.decision.eligible && foregroundRetryB.decision.reason === "ELIGIBLE" && foregroundRetryB.decision.foregroundInputAccepted && !foregroundRetryB.decision.providerSendPermitIssued
          && !foregroundRetryB.decision.paidFallbackPermitted && foregroundRetryBSettled && bothWaitersRetired && !afterForegroundRetryB.foregroundWaiting
          && afterForegroundRetryB.fallbackJobsReserved === afterContinuationAfterForegroundRetryA.fallbackJobsReserved
          && continuationRetry.decision.eligible && continuationRetry.decision.reason === "ELIGIBLE" && !continuationRetry.decision.providerSendPermitIssued
          && !continuationRetry.decision.paidFallbackPermitted && continuationRetrySettled
          && finalLedger.fallbackJobsReserved === afterForegroundRetryB.fallbackJobsReserved + 1
          && !finalLedger.foregroundWaiting && !finalLedger.providerLeaseActive;
        checks.push(check("foreground-contention-recovery",passed,{
          counterScope:"accounting-fixture",
          decisionFields:["eligible","reason","foregroundInputAccepted","providerSendPermitIssued","paidFallbackPermitted"],
          recordFields:["state","reservationCharged","leaseActive","nativeSendCount","nativeTerminalAcknowledged","endedAtPresent"],
          ledgerFields:["foregroundWaiting","providerLeaseActive","fallbackJobsReserved"],
          decisions:{event:decisionFlags(eventReservation),busyA:decisionFlags(foregroundBusyA),busyB:decisionFlags(foregroundBusyB),continuation:decisionFlags(continuationDenied),retryA:decisionFlags(foregroundRetryA),continuationAfterA:decisionFlags(continuationAfterForegroundRetryA),retryB:decisionFlags(foregroundRetryB),continuationRetry:decisionFlags(continuationRetry)},
          records:{eventHeld:recordFlags(eventSending),eventTerminal:recordFlags(eventTerminal),busyA:recordFlags(foregroundBusyA),busyB:recordFlags(foregroundBusyB),continuation:recordFlags(continuationDenied),retryATerminal:recordFlags(foregroundRetryATerminal),busyAAfterA:recordFlags(foregroundAAfterFirstRetry),busyBBeforeB:recordFlags(foregroundBBeforeRetry),continuationAfterA:recordFlags(continuationAfterForegroundRetryA),retryBTerminal:recordFlags(foregroundRetryBTerminal),busyAFinal:recordFlags(foregroundAFinal),busyBFinal:recordFlags(foregroundBFinal),continuationTerminal:recordFlags(continuationRetryTerminal)},
          ledgerReadbacks:[duringContention,afterEvent,afterContinuationDenied,afterForegroundRetryA,afterContinuationAfterForegroundRetryA,afterForegroundRetryB,finalLedger].map(ledger=>[ledger.foregroundWaiting,ledger.providerLeaseActive,ledger.fallbackJobsReserved]),
          identities:{distinct:authenticatedRequestIdA!==authenticatedRequestIdB,retryAMatchesA:foregroundRetryA.work.class==="foreground"&&foregroundRetryA.work.authenticatedRequestId===authenticatedRequestIdA,retryBMatchesB:foregroundRetryB.work.class==="foreground"&&foregroundRetryB.work.authenticatedRequestId===authenticatedRequestIdB},
          waiterRetirement:{firstOnly:firstWaiterRetiredOnly,both:bothWaitersRetired,immutableRows:[unchangedWaiter(foregroundBusyA,foregroundAFinal),unchangedWaiter(foregroundBusyB,foregroundBFinal)]}
        }));
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
          const swappedMetadata = index === 1 ? [windows(20,70), windows(60,20)].map((normal, swappedIndex) => {
            const swapped = normal.map(window => ({ ...window, bucketId: window.bucketId === "primary" ? "secondary" : "primary" }));
            const swappedAccount = accountRef + ":swapped:" + swappedIndex;
            const swappedKey = key + ":swapped:" + swappedIndex;
            observe(owner,swappedAccount,swappedKey,swapped);
            const record = take(owner.reserve(request(swappedAccount,swappedKey+":background",{class:"event"})));
            return { windows: swapped, eligible: record.decision.eligible, reason: record.decision.reason };
          }) : [];
          const swappedPassed = swappedMetadata.every((observation, swappedIndex) => !observation.eligible && observation.reason === (swappedIndex === 0 ? "WEEKLY_THRESHOLD" : "FIVE_HOUR_THRESHOLD"));
          checks.push(check("fresh-known-veto-"+index,!result.decision.eligible&&result.decision.reason===expected&&swappedPassed,{windows:values,status:index===3?"unavailable":"available",decision:result.decision,...(index===1?{swappedMetadata}:{})}));
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
