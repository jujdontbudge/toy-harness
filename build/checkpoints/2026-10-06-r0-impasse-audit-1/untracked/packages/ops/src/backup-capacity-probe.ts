import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { backupCapacityInputSchema, checkViewSchema, opsErrorMessages, registeredProbeInputSchema } from "@toy/contracts";
import type {
  BackupCapacityDecisionV1, BackupCapacityDestinationV1, BackupCapacityInputV1, CheckViewV1, OpsControlContextV1,
  RegisteredProbeInputV1, RegisteredProbeOperationV1, Result
} from "@toy/contracts";
import { BackupCapacity } from "./backup-capacity.js";
import { FixtureProbe, fixtureStackInspect } from "./fixture-stack.js";

const checkedAt = "2026-10-06T00:00:00.000Z";
const artifacts = (): string[] => ["./backup-capacity.js", "./backup-capacity-probe.js"].map(path => createHash("sha256").update(readFileSync(new URL(path, import.meta.url))).digest("hex"));
const inventory = (): BackupCapacityInputV1 => {
  const destination = (kind: BackupCapacityDestinationV1["kind"], availableBytes: string): BackupCapacityDestinationV1 => ({
    kind, state: "ready", availableBytes, independentVerified: true, policyEligible: true, noSpendVerified: true,
    escrowVerified: true, restoreVerified: true, checkedAt, links: { recordRefs: [], observations: [], artifactDigests: artifacts() }
  });
  return backupCapacityInputSchema.parse({
    observedAt: checkedAt, primaryAvailableBytes: "40000000000", stagingWriteBytes: "1000000000", stagingFloorBytes: "10000000000",
    forecast: {
      state: "measured", checkedAt, links: { recordRefs: [], observations: [], artifactDigests: artifacts() },
      retainedBytes: "2000000000", dumpBytes: "1000000000", versionBytes: "500000000", stagingBytes: "1000000000",
      pruneScratchBytes: "500000000", restoreWorkspaceBytes: "2000000000", shortGrowthBytesPerDay: "100000000",
      longGrowthBytesPerDay: "200000000", horizonDays: "30"
    },
    destinations: {
      external: destination("external", "60000000000"), b2: destination("b2", "50000000000"),
      internalSnapshot: destination("internal-snapshot", "100000000000")
    }
  });
};
const fixtureCheck = (scenario: string, input: BackupCapacityInputV1, expected: (decision: BackupCapacityDecisionV1) => boolean): CheckViewV1 => {
  const decision = BackupCapacity.evaluate(input);
  const passed = expected(decision) && !decision.purchaseAssumed && !decision.uploadPermitted
    && !decision.deletePermittedData && !decision.deployedCoverageVerified && decision.sealedPartialSets === "reuse-before-new-staging";
  const requirements = Object.fromEntries(Object.entries(input.forecast).filter(([key]) => !["checkedAt", "links"].includes(key)));
  const evidence = {
    fixture: "fixed-external-storage-and-growth", scenario, primaryAvailableBytes: input.primaryAvailableBytes,
    stagingWriteBytes: input.stagingWriteBytes, requirements,
    destinations: Object.values(input.destinations).map(destination => ({ kind: destination.kind, state: destination.state, availableBytes: destination.availableBytes })),
    decision, wholeATComplete: false
  };
  return checkViewSchema.parse({
    id: "backup.capacity", owner: "ops", state: passed ? "PASS" : "FAIL", checkedAt: new Date().toISOString(),
    reasonCode: passed ? "NO_SPEND_CAPACITY_FIXTURE_PASS" : "NO_SPEND_CAPACITY_FIXTURE_FAIL",
    prerequisite: JSON.stringify(evidence), nextCommandId: "probe.show", links: { recordRefs: [], observations: [], artifactDigests: artifacts() }
  });
};

export const BackupCapacityProbe = {
  run(input: RegisteredProbeInputV1, context: OpsControlContextV1): Result<RegisteredProbeOperationV1> {
    const invalid: Result<RegisteredProbeOperationV1> = { ok: false, error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false } };
    if (!registeredProbeInputSchema.safeParse(input).success || input.caseId !== "backup-capacity" || !["AT-ops-62", "AT-lifestore-63", "AT-sources-216"].includes(input.probeId)) return invalid;
    const owned = fixtureStackInspect(context);
    if (!owned.ok) return owned;
    const snapshot = owned.data.result;
    if (!snapshot?.ready || snapshot.release !== "R0" || snapshot.clock !== "fake" || snapshot.model !== "fake") return invalid;
    try {
      const ready = inventory();
      const missing = { ...ready, destinations: { ...ready.destinations, external: { ...ready.destinations.external, state: "missing", independentVerified: false, availableBytes: null }, b2: { ...ready.destinations.b2, availableBytes: "10000000000" } } } satisfies BackupCapacityInputV1;
      const unproved = { ...ready, destinations: { ...ready.destinations, b2: { ...ready.destinations.b2, links: { recordRefs: [], observations: [], artifactDigests: [] } } } };
      const outage = { ...ready, primaryAvailableBytes: "10000000000", destinations: { ...ready.destinations, b2: { ...ready.destinations.b2, state: "outage" } } } satisfies BackupCapacityInputV1;
      const crossing = { ...ready, primaryAvailableBytes: "10000001000", stagingWriteBytes: "1001" };
      const unknownForecast = { ...ready, forecast: { ...ready.forecast, state: "unmeasured" } } satisfies BackupCapacityInputV1;
      const overflow = { ...ready, forecast: { ...ready.forecast, retainedBytes: "18446744073709551615" } };
      const checks = [
        fixtureCheck("missing-external-b2-free-cap-exceeded", missing, decision => decision.verdict === "FAIL" && decision.disasterRpo === "unattainable" && decision.independentDestinationCount === 0 && decision.destinations.some(destination => destination.kind === "b2" && destination.reasons.includes("CAPACITY_EXCEEDED"))),
        fixtureCheck("unproved-offsite-capacity", unproved, decision => decision.verdict === "INCOMPLETE" && decision.independentDestinationCount === 1 && decision.pauseLowPriority && decision.gaps.includes("OFFSITE_CAPACITY_UNAVAILABLE")),
        fixtureCheck("outage-and-staging-floor-equality", outage, decision => decision.verdict === "FAIL" && decision.staging === "refused" && decision.pauseLowPriority && decision.gaps.includes("STAGING_FLOOR") && decision.gaps.includes("DESTINATION_OUTAGE")),
        fixtureCheck("next-write-crosses-staging-floor", crossing, decision => decision.staging === "refused" && decision.pauseLowPriority && decision.gaps.includes("STAGING_FLOOR")),
        fixtureCheck("growth-and-all-overhead-control", ready, decision => decision.verdict === "PASS" && decision.requiredBytes === "13000000000" && decision.growthBytesPerDay === "200000000" && decision.independentDestinationCount === 2 && decision.destinations.find(destination => destination.kind === "external")?.remainingDays === "265" && decision.destinations.find(destination => destination.kind === "b2")?.remainingDays === "215" && !decision.pauseLowPriority),
        fixtureCheck("internal-snapshot-never-independent", ready, decision => decision.independentDestinationCount === 2 && decision.destinations.some(destination => destination.kind === "internal-snapshot" && destination.state === "blocked" && destination.reasons.includes("INTERNAL_SNAPSHOT"))),
        fixtureCheck("unmeasured-growth-stays-incomplete", unknownForecast, decision => decision.verdict === "INCOMPLETE" && decision.requiredBytes === null && decision.pauseLowPriority && decision.gaps.includes("FORECAST_UNPROVEN")),
        fixtureCheck("forecast-overflow-refuses", overflow, decision => decision.verdict === "FAIL" && decision.requiredBytes === null && decision.pauseLowPriority && decision.gaps.includes("FORECAST_OVERFLOW"))
      ];
      return FixtureProbe.run(input, context, checks);
    } catch { return { ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } }; }
  }
};
