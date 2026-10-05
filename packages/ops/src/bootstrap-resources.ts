import { spawnSync } from "node:child_process";
import { endianness, freemem, totalmem } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { bootstrapResourcePreflightSchema, bootstrapResourceSampleSchema } from "@toy/contracts";
import type { BootstrapResourcePreflightV1, BootstrapResourceReasonV1, BootstrapResourceSampleV1 } from "@toy/contracts";

const requiredBytes = 1610612736n;
const sampleGap = 500000000n;
const remainingMilliseconds = (deadline: bigint): number => Math.max(0, Number((deadline - process.hrtime.bigint()) / 1000000n));
const byteCounter = (read: () => number): string | null => {
  try {
    const value = read();
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  } catch {
    return null;
  }
};

const sysctl = (query: "pressure" | "swap", deadline: bigint): Buffer | null => {
  if (process.platform !== "darwin" || process.arch !== "arm64" || process.version !== "v24.21.0" || endianness() !== "LE") return null;
  const timeout = Math.min(250, remainingMilliseconds(deadline));
  if (timeout < 1) return null;
  try {
    const child = spawnSync("/usr/sbin/sysctl", query === "pressure" ? ["-n", "kern.memorystatus_vm_pressure_level"] : ["-b", "vm.swapusage"], {
      env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
      stdio: ["ignore", "pipe", "pipe"], timeout, killSignal: "SIGKILL", maxBuffer: 256
    });
    return child.error === undefined && child.status === 0 && child.stderr.length === 0 && Buffer.isBuffer(child.stdout) ? child.stdout : null;
  } catch {
    return null;
  }
};

const sampleResources = (deadline: bigint): BootstrapResourceSampleV1 => {
  const pressureBytes = sysctl("pressure", deadline);
  const pressure = pressureBytes?.equals(Buffer.from("1\n")) ? "normal" : pressureBytes?.equals(Buffer.from("2\n")) ? "warning" : pressureBytes?.equals(Buffer.from("4\n")) ? "critical" : "unknown";
  const swap = sysctl("swap", deadline);
  let swapTotalBytes: string | null = null;
  let swapUsedBytes: string | null = null;
  let swapPageSize: string | null = null;
  if (swap?.length === 32) {
    const total = swap.readBigUInt64LE(0); const available = swap.readBigUInt64LE(8); const used = swap.readBigUInt64LE(16);
    const pageSize = swap.readUInt32LE(24); const encrypted = swap.readUInt32LE(28);
    if (available + used === total && pageSize >= 4096 && pageSize <= 65536 && (pageSize & (pageSize - 1)) === 0 && encrypted <= 1) {
      swapTotalBytes = String(total); swapUsedBytes = String(used); swapPageSize = String(pageSize);
    }
  }
  return bootstrapResourceSampleSchema.parse({
    observedAt: new Date().toISOString(), monotonicNanoseconds: String(process.hrtime.bigint()),
    physicalBytes: byteCounter(totalmem), freeBytes: byteCounter(freemem), processAvailableBytes: byteCounter(() => process.availableMemory()),
    pressure, swapTotalBytes, swapUsedBytes, swapPageSize
  });
};

export const measureBootstrapResources = async (timeoutMs: number): Promise<BootstrapResourcePreflightV1> => {
  const deadline = process.hrtime.bigint() + BigInt(Math.max(0, Math.floor(timeoutMs - 50))) * 1000000n;
  const samples: BootstrapResourceSampleV1[] = [];
  while (samples.length < 3 && remainingMilliseconds(deadline) > 0) {
    const previous = samples.at(-1);
    if (previous) {
      const nextSampleAt = BigInt(previous.monotonicNanoseconds) + sampleGap;
      if (nextSampleAt >= deadline) break;
      while (process.hrtime.bigint() < nextSampleAt) {
        const wait = Number((nextSampleAt - process.hrtime.bigint() + 999999n) / 1000000n);
        await delay(Math.max(1, wait));
      }
      if (remainingMilliseconds(deadline) < 1) break;
    }
    const sample = sampleResources(deadline);
    samples.push(sample);
    if (BigInt(sample.monotonicNanoseconds) >= deadline) break;
  }
  const first = samples.at(0); const last = samples.at(-1);
  const window = first && last ? BigInt(last.monotonicNanoseconds) - BigInt(first.monotonicNanoseconds) : 0n;
  const timedOut = samples.length < 3 || process.hrtime.bigint() >= deadline;
  const completeMeasurements = !timedOut && samples.every((sample) => sample.physicalBytes !== null && sample.freeBytes !== null && sample.processAvailableBytes !== null && sample.pressure !== "unknown" && sample.swapTotalBytes !== null && sample.swapUsedBytes !== null && sample.swapPageSize !== null);
  const free = samples.flatMap((sample) => sample.freeBytes === null ? [] : [BigInt(sample.freeBytes)]);
  const minimumFreeBytes = free.length === samples.length && free.length > 0 ? String(free.reduce((minimum, value) => value < minimum ? value : minimum)) : null;
  let maximumSwapGrowthBytes: bigint | null = samples.length === 3 && samples.every((sample) => sample.swapUsedBytes !== null) ? 0n : null;
  for (let index = 1; index < samples.length && maximumSwapGrowthBytes !== null; index++) {
    const previous = samples[index - 1]?.swapUsedBytes; const current = samples[index]?.swapUsedBytes;
    const previousTotal = samples[index - 1]?.swapTotalBytes; const currentTotal = samples[index]?.swapTotalBytes;
    if (previous === null || previous === undefined || current === null || current === undefined || previousTotal === null || previousTotal === undefined || currentTotal === null || currentTotal === undefined) maximumSwapGrowthBytes = null;
    else {
      const growth = BigInt(current) - BigInt(previous);
      const totalGrowth = BigInt(currentTotal) - BigInt(previousTotal);
      if (growth > maximumSwapGrowthBytes) maximumSwapGrowthBytes = growth;
      if (totalGrowth > maximumSwapGrowthBytes) maximumSwapGrowthBytes = totalGrowth;
    }
  }
  const normalPressureObserved = samples.length === 3 && samples.every((sample) => sample.pressure === "normal");
  const swapStable = maximumSwapGrowthBytes === 0n && window >= sampleGap * 2n;
  const headroomSatisfied = samples.length === 3 && minimumFreeBytes !== null && BigInt(minimumFreeBytes) >= requiredBytes;
  const physicalFitSatisfied = samples.length === 3 && samples.every((sample) => {
    if (sample.physicalBytes === null || sample.freeBytes === null) return false;
    const physical = BigInt(sample.physicalBytes); const free = BigInt(sample.freeBytes);
    return free <= physical && physical - free + requiredBytes <= physical;
  });
  const reasons: BootstrapResourceReasonV1[] = [];
  if (!completeMeasurements) reasons.push("MEASUREMENT_UNAVAILABLE");
  if (timedOut) reasons.push("TIMEOUT");
  if (!normalPressureObserved) reasons.push("NORMAL_PRESSURE_REQUIRED");
  if (!swapStable) reasons.push("STABLE_SWAP_REQUIRED");
  if (!headroomSatisfied) reasons.push("AVAILABLE_MEMORY_TOO_LOW");
  if (!physicalFitSatisfied) reasons.push("PHYSICAL_RAM_FIT_REQUIRED");
  reasons.push("HEAVY_WORK_OWNER_UNAVAILABLE", "AGGREGATE_ENFORCEMENT_UNAVAILABLE");
  return bootstrapResourcePreflightSchema.parse({
    schemaVersion: "toy.bootstrap-resource-preflight.v1", measuredAt: new Date().toISOString(), samples, completeMeasurements,
    provisionalAggregateCeilingBytes: "1073741824", marginBytes: "536870912", requiredFreeBytes: "1610612736",
    minimumFreeBytes, stabilityWindowNanoseconds: String(window), maximumSwapGrowthBytes: maximumSwapGrowthBytes === null ? null : String(maximumSwapGrowthBytes),
    normalPressureObserved, swapStable, headroomSatisfied, physicalFitSatisfied, reasons, resourcePermitIssued: false, admissionState: "blocked"
  });
};
