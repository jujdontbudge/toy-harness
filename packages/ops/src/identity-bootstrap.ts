import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { opsControlContextSchema, opsErrorMessages, roleBootstrapInputSchema, roleBootstrapReportSchema } from "@toy/contracts";
import type { OpsControlContextV1, OpsErrorCode, Result, RoleBootstrapInputV1, RoleBootstrapReportV1 } from "@toy/contracts";
import { trustedCheckoutRoot } from "./checkout-root.js";

export const RoleIdentityBootstrap = {
  run(input: RoleBootstrapInputV1, context: OpsControlContextV1): Result<RoleBootstrapReportV1> {
    const failed = (code: OpsErrorCode, effectState: "none" | "unknown" = "none"): Result<RoleBootstrapReportV1> => ({
      ok: false, error: { module: "ops", code, retryable: false, message: opsErrorMessages[code], effectState }
    });
    if (!roleBootstrapInputSchema.safeParse(input).success || !opsControlContextSchema.safeParse(context).success) return failed("INVALID_INPUT");
    if (context.environment.kind !== "prod" || context.environment.instanceId !== null || context.environment.stackId !== null) return failed("UNAUTHORIZED");
    if (process.platform !== "darwin") return failed("DEPENDENCY_UNAVAILABLE");
    if (!input.plan && (process.getuid?.() !== 0 || process.geteuid?.() !== 0)) return failed("UNAUTHORIZED");
    const effectState = input.plan || input.verify ? "none" : "unknown";
    try {
      const child = spawnSync(process.execPath, [join(trustedCheckoutRoot(), "control/dist/bootstrap/main.js"), String(context.timeoutMs)], {
        env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C" }, input: JSON.stringify(input),
        encoding: "utf8", maxBuffer: 131072, timeout: context.timeoutMs, killSignal: "SIGKILL"
      });
      if (child.error || child.status !== 0) return failed(child.error && "code" in child.error && child.error.code === "ETIMEDOUT" ? "TIMEOUT" : "DEPENDENCY_UNAVAILABLE", effectState);
      const report = roleBootstrapReportSchema.safeParse(JSON.parse(child.stdout));
      if (!report.success || report.data.requestId !== input.requestId || report.data.mode !== (input.verify ? "verify" : input.plan ? "plan" : "apply") || report.data.callerUid !== process.getuid?.()) return failed("ARTIFACT_MISMATCH", effectState);
      return { ok: true, data: report.data };
    } catch { return failed("DEPENDENCY_UNAVAILABLE", effectState); }
  }
};
