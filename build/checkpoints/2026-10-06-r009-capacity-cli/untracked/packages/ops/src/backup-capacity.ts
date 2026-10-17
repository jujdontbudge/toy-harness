import { spawnSync } from "node:child_process";
import { statfsSync } from "node:fs";
import {
  backupCapacityDecisionSchema, backupCapacityInputSchema, backupCapacityInventorySchema, uint64Maximum
} from "@toy/contracts";
import type {
  BackupCapacityDecisionV1, BackupCapacityDestinationDecisionV1, BackupCapacityInputV1,
  BackupCapacityInventoryV1, BackupCapacityReasonV1, EvidenceLinksV1
} from "@toy/contracts";
import { trustedToolEnvironment } from "./checkout-root.js";

const hasEvidence = (links: EvidenceLinksV1): boolean => links.recordRefs.length + links.observations.length + links.artifactDigests.length > 0;

export const BackupCapacity = {
  inspect(timeoutMs: number): BackupCapacityInventoryV1 {
    const observedAt = new Date().toISOString();
    let primaryTotalBytes: string | null = null;
    let primaryAvailableBytes: string | null = null;
    let externalPhysicalDiskCount: number | null = null;
    try {
      const disk = statfsSync("/System/Volumes/Data", { bigint: true });
      const total = disk.blocks * disk.bsize;
      const available = disk.bavail * disk.bsize;
      if (total >= 0n && available >= 0n && available <= total) {
        primaryTotalBytes = total.toString();
        primaryAvailableBytes = available.toString();
      }
    } catch { primaryAvailableBytes = null; }
    if (timeoutMs > 0) {
      const disks = spawnSync("/usr/sbin/diskutil", ["list", "external", "physical"], {
        encoding: "utf8", timeout: Math.min(timeoutMs, 5000), maxBuffer: 65536, env: trustedToolEnvironment()
      });
      if (disks.status === 0 && !disks.error) {
        const matches = [...disks.stdout.matchAll(/^\/dev\/disk[0-9]+ \(external, physical\):\s*$/gm)];
        if (matches.length > 0 || /^No disks found\.?\s*$/.test(disks.stdout)) externalPhysicalDiskCount = matches.length;
      }
    }
    return backupCapacityInventorySchema.parse({
      observedAt, dataFilesystemPath: "/System/Volumes/Data", primaryTotalBytes, primaryAvailableBytes, externalPhysicalDiskCount,
      localCapacityState: primaryAvailableBytes === null ? "unavailable" : "measured",
      externalMetadataState: externalPhysicalDiskCount === null ? "unavailable" : "measured",
      independentDestinationCapacityVerified: false, remoteAccountInspected: false, restoreVerified: false
    });
  },
  evaluate(raw: BackupCapacityInputV1): BackupCapacityDecisionV1 {
    const input = backupCapacityInputSchema.parse(raw);
    const forecast = input.forecast;
    const forecastVerified = forecast.state === "measured" && hasEvidence(forecast.links)
      && Date.parse(forecast.checkedAt) <= Date.parse(input.observedAt) && BigInt(forecast.horizonDays) > 0n;
    const short = BigInt(forecast.shortGrowthBytesPerDay);
    const long = BigInt(forecast.longGrowthBytesPerDay);
    const growth = short > long ? short : long;
    const base = [forecast.retainedBytes, forecast.dumpBytes, forecast.versionBytes, forecast.stagingBytes, forecast.pruneScratchBytes, forecast.restoreWorkspaceBytes].reduce((sum, bytes) => sum + BigInt(bytes), 0n);
    const required = base + growth * BigInt(forecast.horizonDays);
    const overflow = required > BigInt(uint64Maximum);
    const requiredBytes = forecastVerified && !overflow ? required.toString() : null;
    const destinations = Object.values(input.destinations).map((destination): BackupCapacityDestinationDecisionV1 => {
      const reasons: BackupCapacityReasonV1[] = [];
      if (destination.kind === "internal-snapshot") reasons.push("INTERNAL_SNAPSHOT");
      if (destination.state === "missing") reasons.push("DESTINATION_MISSING");
      if (destination.state === "outage") reasons.push("DESTINATION_OUTAGE");
      const attested = destination.independentVerified && hasEvidence(destination.links) && Date.parse(destination.checkedAt) <= Date.parse(input.observedAt);
      if (!attested || destination.state === "unknown" || destination.availableBytes === null) reasons.push("INVENTORY_UNPROVEN");
      if (!destination.policyEligible) reasons.push("POLICY_UNPROVEN");
      if (!destination.noSpendVerified) reasons.push("NO_SPEND_UNPROVEN");
      if (!destination.escrowVerified) reasons.push("ESCROW_UNPROVEN");
      if (!destination.restoreVerified) reasons.push("RESTORE_UNPROVEN");
      if (!forecastVerified) reasons.push("FORECAST_UNPROVEN");
      if (overflow) reasons.push("FORECAST_OVERFLOW");
      const capacity = destination.availableBytes === null ? null : BigInt(destination.availableBytes);
      if (requiredBytes !== null && capacity !== null && capacity < required) reasons.push("CAPACITY_EXCEEDED");
      const unavailable = destination.state === "unknown" || !attested || capacity === null || !forecastVerified;
      return {
        kind: destination.kind,
        state: reasons.length === 0 ? "eligible-for-testing" : destination.state === "missing" || destination.state === "outage" || destination.kind === "internal-snapshot" ? "blocked" : unavailable ? "unavailable" : "blocked",
        reasons,
        remainingDays: forecastVerified && capacity !== null && capacity >= base && growth > 0n ? ((capacity - base) / growth).toString() : null
      };
    });
    const independentDestinationCount = destinations.filter(destination => destination.kind !== "internal-snapshot" && destination.state === "eligible-for-testing").length;
    const available = input.primaryAvailableBytes === null ? null : BigInt(input.primaryAvailableBytes);
    const floor = BigInt(input.stagingFloorBytes);
    const staging = available !== null && available > floor && available - BigInt(input.stagingWriteBytes) >= floor ? "eligible-for-testing" : "refused";
    const gaps: BackupCapacityDecisionV1["gaps"] = [];
    if (!forecastVerified) gaps.push("FORECAST_UNPROVEN");
    if (overflow) gaps.push("FORECAST_OVERFLOW");
    if (staging === "refused") gaps.push("STAGING_FLOOR");
    if (available !== null && available < 10737418240n) gaps.push("NONCRITICAL_DISK_FLOOR");
    if (destinations.some(destination => destination.reasons.includes("DESTINATION_OUTAGE"))) gaps.push("DESTINATION_OUTAGE");
    if (independentDestinationCount < 2) gaps.push("OFFSITE_CAPACITY_UNAVAILABLE");
    const definitiveFailure = overflow || available !== null && staging === "refused"
      || destinations.some(destination => destination.kind !== "internal-snapshot" && (["DESTINATION_MISSING", "DESTINATION_OUTAGE", "CAPACITY_EXCEEDED"] as const).some(reason => destination.reasons.includes(reason)));
    const verdict = independentDestinationCount === 2 && requiredBytes !== null && staging === "eligible-for-testing" ? "PASS" : definitiveFailure ? "FAIL" : "INCOMPLETE";
    return backupCapacityDecisionSchema.parse({
      observedAt: input.observedAt, verdict, requiredBytes, growthBytesPerDay: forecastVerified ? growth.toString() : null,
      destinations, independentDestinationCount,
      disasterRpo: independentDestinationCount === 2 ? "eligible-for-testing" : definitiveFailure ? "unattainable" : "unproven",
      staging, pauseLowPriority: gaps.length > 0, gaps, sealedPartialSets: "reuse-before-new-staging",
      deletePermittedData: false, purchaseAssumed: false, uploadPermitted: false, deployedCoverageVerified: false
    });
  }
};
