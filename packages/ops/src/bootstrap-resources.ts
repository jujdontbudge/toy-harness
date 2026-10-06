import { spawnSync } from "node:child_process";
import { totalmem } from "node:os";
import { bootstrapResourcePreflightSchema, bootstrapResourceSampleSchema } from "@toy/contracts";
import type { BootstrapResourcePreflightV1, BootstrapResourceReasonV1, TestStackUpInputV1 } from "@toy/contracts";

const marginBytes = 536870912n;
const readOs = (file: string, args: string[], deadline: bigint) => {
  if (process.platform !== "darwin") return null;
  const timeout = Math.min(250, Number((deadline - process.hrtime.bigint()) / 1000000n));
  if (timeout < 1) return null;
  try {
    const child = spawnSync(file, args, {
      env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
      stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout, killSignal: "SIGKILL", maxBuffer: 8192
    });
    return { output: child.error === undefined && child.status === 0 ? child.stdout : null, denied: /Operation not permitted|Permission denied/i.test(child.stderr) };
  } catch {
    return null;
  }
};

export const measureBootstrapResources = (timeoutMs: number, jobNeedBytes = 1073741824n, observedPressure: TestStackUpInputV1["observedPressure"] = undefined): Promise<BootstrapResourcePreflightV1> => {
  const deadline = process.hrtime.bigint() + BigInt(Math.max(0, Math.floor(timeoutMs - 50))) * 1000000n;
  const stats = readOs("/usr/bin/vm_stat", [], deadline)?.output;
  const pageSize = stats?.match(/page size of ([0-9]+) bytes/)?.[1];
  const pageSizeBytes = pageSize && BigInt(pageSize) > 0n ? pageSize : null;
  const category = (name: string): string | null => {
    const count = stats?.match(new RegExp("^Pages " + name + ":\\s+([0-9]+)\\.\\s*$", "m"))?.[1];
    return count !== undefined && pageSizeBytes !== null ? String(BigInt(count) * BigInt(pageSizeBytes)) : null;
  };
  const freeBytes = category("free"); const inactiveBytes = category("inactive");
  const purgeableBytes = category("purgeable"); const speculativeBytes = category("speculative");
  const availableBytes = freeBytes !== null && inactiveBytes !== null && purgeableBytes !== null && speculativeBytes !== null
    ? String(BigInt(freeBytes) + BigInt(inactiveBytes) + BigInt(purgeableBytes) + BigInt(speculativeBytes)) : null;
  const pressureRead = readOs("/usr/sbin/sysctl", ["-n", "kern.memorystatus_vm_pressure_level"], deadline);
  const pressureValue = pressureRead?.output;
  const queriedPressure = pressureValue === "1\n" ? "normal" : pressureValue === "2\n" ? "warning" : pressureValue === "4\n" ? "critical" : null;
  const query = queriedPressure === null ? readOs("/usr/bin/memory_pressure", ["-Q"], deadline)?.output : null;
  const explicitLevel = query?.match(/(?:memory pressure(?: level)?|pressure level)\s*:\s*(normal|warning|critical)\b/i)?.[1]?.toLowerCase();
  const osPressure = queriedPressure ?? (explicitLevel === "normal" || explicitLevel === "warning" || explicitLevel === "critical" ? explicitLevel : "unknown");
  const pressure = osPressure === "unknown" ? observedPressure ?? "unknown" : osPressure;
  const sample = bootstrapResourceSampleSchema.parse({
    observedAt: new Date().toISOString(), monotonicNanoseconds: String(process.hrtime.bigint()), physicalBytes: String(totalmem()),
    pageSizeBytes, freeBytes, inactiveBytes, purgeableBytes, speculativeBytes, availableBytes, pressure,
    pressureSource: osPressure !== "unknown" ? "os" : observedPressure === "normal" ? "operator-observation" : "unavailable",
    pressureQueryOutput: pressureValue ?? query ?? undefined
  });
  const timedOut = process.hrtime.bigint() >= deadline;
  const completeMeasurements = !timedOut && availableBytes !== null && pressure !== "unknown";
  const requiredAvailableBytes = jobNeedBytes + marginBytes;
  const normalPressureObserved = pressure === "normal";
  const headroomSatisfied = availableBytes !== null && BigInt(availableBytes) >= requiredAvailableBytes;
  const reasons: BootstrapResourceReasonV1[] = [];
  if (!completeMeasurements) reasons.push("MEASUREMENT_UNAVAILABLE");
  if (timedOut) reasons.push("TIMEOUT");
  if (!normalPressureObserved) reasons.push("NORMAL_PRESSURE_REQUIRED");
  if (pressure === "unknown" && pressureRead?.denied) reasons.push("PRESSURE_QUERY_DENIED");
  if (!headroomSatisfied) reasons.push("AVAILABLE_MEMORY_TOO_LOW");
  return Promise.resolve(bootstrapResourcePreflightSchema.parse({
    schemaVersion: "toy.bootstrap-resource-preflight.v2", measuredAt: sample.observedAt, samples: [sample], completeMeasurements,
    jobNeedBytes: String(jobNeedBytes), marginBytes: String(marginBytes), requiredAvailableBytes: String(requiredAvailableBytes),
    minimumAvailableBytes: availableBytes, normalPressureObserved, headroomSatisfied, reasons,
    resourcePermitIssued: false, admissionState: reasons.length === 0 ? "admitted" : "blocked"
  }));
};
