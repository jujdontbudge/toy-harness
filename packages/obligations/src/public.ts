import { cadenceProjectionQueryV1Schema, cadenceProjectionV1Schema, cadenceSlotV1Schema, opsErrorMessages } from "@toy/contracts";
import type { CadenceProjectionQueryV1, CadenceProjectionReader, CadenceProjectionV1, CadenceSlotState, CadenceSlotV1, ModuleId, Result } from "@toy/contracts";

export type { ModuleId };

const invalid = (): Result<CadenceProjectionV1> => ({
  ok: false,
  error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false }
});

export const CadenceProjection = {
  readSlots(query: CadenceProjectionQueryV1, reader: CadenceProjectionReader): Result<CadenceProjectionV1> {
    const parsed = cadenceProjectionQueryV1Schema.safeParse(query);
    if (!parsed.success) return invalid();
    const source = reader.readSlots(parsed.data);
    if (!source.ok) return { ok: false, error: source.error };
    const rows = source.data.map(slot => {
      const parsedSlot = cadenceSlotV1Schema.safeParse(slot);
      return parsedSlot.success ? parsedSlot.data : null;
    });
    if (rows.some(slot => slot === null)) return invalid();
    const slots = rows.filter((slot): slot is CadenceSlotV1 => slot !== null)
      .filter(slot => (parsed.data.jobKey === null || slot.jobKey === parsed.data.jobKey)
        && Date.parse(slot.slotAt) >= Date.parse(parsed.data.from)
        && Date.parse(slot.slotAt) < Date.parse(parsed.data.to))
      .sort((left, right) => left.slotAt.localeCompare(right.slotAt) || left.jobKey.localeCompare(right.jobKey));
    const counts: Record<CadenceSlotState, bigint> = {
      scheduled: 0n, running: 0n, swept: 0n, reviewed: 0n, deferred_quota: 0n, deferred_auth: 0n,
      deferred_network: 0n, deferred_busy: 0n, maintenance: 0n, failed: 0n, missed: 0n, coalesced_after_outage: 0n
    };
    let acceptedAiReviewed = 0n;
    for (const slot of slots) {
      counts[slot.state] += 1n;
      if (slot.state === "reviewed" && slot.reviewId !== null) acceptedAiReviewed += 1n;
    }
    return {
      ok: true,
      data: cadenceProjectionV1Schema.parse({
        slots,
        counts: {
          scheduled: counts.scheduled.toString(), running: counts.running.toString(), swept: counts.swept.toString(), reviewed: counts.reviewed.toString(),
          deferred_quota: counts.deferred_quota.toString(), deferred_auth: counts.deferred_auth.toString(), deferred_network: counts.deferred_network.toString(),
          deferred_busy: counts.deferred_busy.toString(), maintenance: counts.maintenance.toString(), failed: counts.failed.toString(), missed: counts.missed.toString(),
          coalesced_after_outage: counts.coalesced_after_outage.toString()
        },
        acceptedAiReviewed: acceptedAiReviewed.toString(), swept: counts.swept.toString()
      })
    };
  }
};
