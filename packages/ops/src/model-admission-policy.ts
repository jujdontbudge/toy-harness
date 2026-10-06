import { modelAdmissionDecisionSchema, modelAdmissionInputSchema } from "@toy/contracts";
import type { ModelAdmissionDecisionV1, ModelAdmissionInputV1 } from "@toy/contracts";

export const ModelAdmissionPolicy = {
  evaluate(raw: ModelAdmissionInputV1): ModelAdmissionDecisionV1 {
    const input = modelAdmissionInputSchema.parse(raw);
    const foreground = input.work.class === "foreground" || input.work.class === "foreground-judge";
    const now = Date.parse(input.now);
    const observed = input.observation;
    const usable = observed !== null && observed.sourceAuthorized
      && observed.accountRef === input.accountRef && Date.parse(observed.reportedAt) <= now
      && now - Date.parse(observed.reportedAt) <= 900000;
    const windows = usable ? observed.windows.filter(window => Date.parse(window.resetAt) > now) : [];
    const fiveHour = windows.filter(window => window.durationMinutes === 300);
    const weekly = windows.filter(window => window.durationMinutes === 10080);
    const measured = usable && observed.schemaValid && observed.status === "available" && fiveHour.length === 1 && weekly.length === 1;
    const accountingReady = input.ledger.ready && input.ledger.accountRef === input.accountRef && input.ledger.utcDay === input.now.slice(0, 10);
    const mode = !accountingReady ? "unavailable" : foreground ? "foreground" : measured ? "measured" : "fixed-count";
    const decision = (reason: ModelAdmissionDecisionV1["reason"], retryAt: string | null = null): ModelAdmissionDecisionV1 => modelAdmissionDecisionSchema.parse({
      eligible: reason === "ELIGIBLE", mode, reason, retryAt, quotaSnapshotId: usable ? observed.id : null,
      foregroundInputAccepted: true, providerSendPermitIssued: false, paidFallbackPermitted: false
    });
    if (!accountingReady) return decision("ACCOUNTING_UNAVAILABLE");
    if (input.ledger.policyDigest !== input.requested.policyDigest) return decision("POLICY_CHANGED");
    if (input.work.class === "foreground" && input.requested.role !== "foreground") return decision("POLICY_CHANGED");
    if (input.work.class === "foreground-judge" && (input.requested.arm !== "original" || input.requested.settings.model !== "gpt-6.1-sol"
      || input.requested.settings.effort !== "max" || input.requested.settings.serviceTier !== "priority")) return decision("POLICY_CHANGED");
    if (input.ledger.providerLeaseActive) return decision("PROVIDER_BUSY");
    if (foreground) return decision("ELIGIBLE");
    if (input.ledger.foregroundWaiting) return decision("FOREGROUND_WAITING");
    if (input.ledger.restoredUnreconciled) return decision("RESTORE_UNRECONCILED");
    if (usable && observed.status === "exhausted") return decision("QUOTA_EXHAUSTED", windows.map(window => window.resetAt).sort().at(-1) ?? null);
    const fiveHourBreach = fiveHour.find(window => window.usedPercent >= 60);
    const weeklyBreach = weekly.find(window => window.usedPercent >= 70);
    if (fiveHourBreach || weeklyBreach) {
      const retryAt = [fiveHourBreach?.resetAt, weeklyBreach?.resetAt].filter(value => value !== undefined).sort().at(-1) ?? null;
      return decision(fiveHourBreach ? "FIVE_HOUR_THRESHOLD" : "WEEKLY_THRESHOLD", retryAt);
    }
    if (!measured) {
      if (input.work.class === "repair" || input.work.class === "replay") return decision("OPTIONAL_WORK_PAUSED");
      if (input.ledger.fallbackJobsReserved >= 8) return decision("DAILY_JOB_CEILING", new Date(Date.parse(input.now.slice(0, 10) + "T00:00:00.000Z") + 86400000).toISOString());
      return decision("ELIGIBLE");
    }
    const short = fiveHour[0];
    const long = weekly[0];
    if (!short || !long || input.expectedFiveHourUpperPercent === null || input.expectedWeeklyUpperPercent === null
      || input.ledger.unreflectedFiveHourUpperPercent === null || input.ledger.unreflectedWeeklyUpperPercent === null) return decision("RESERVATION_UNKNOWN");
    const shortThreat = short.usedPercent + input.ledger.unreflectedFiveHourUpperPercent + input.expectedFiveHourUpperPercent >= 60;
    const longThreat = long.usedPercent + input.ledger.unreflectedWeeklyUpperPercent + input.expectedWeeklyUpperPercent >= 70;
    if (shortThreat || longThreat) {
      const retryAt = [shortThreat ? short.resetAt : undefined, longThreat ? long.resetAt : undefined].filter(value => value !== undefined).sort().at(-1) ?? null;
      return decision("RESERVATION_THRESHOLD", retryAt);
    }
    return decision("ELIGIBLE");
  }
};
