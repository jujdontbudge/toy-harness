export type { ModuleId } from "@toy/contracts";
export { EngineeringControl } from "./engineering-control.js";
export { ModelAdmission } from "./model-admission.js";
import { opsErrorMessages, registeredProbeInputSchema } from "@toy/contracts";
import type { OpsControlContextV1, RegisteredProbeInputV1, RegisteredProbeOperationV1, RegisteredProbeShowInputV1, Result } from "@toy/contracts";
import { OpsTestStack, TestProbeControl } from "@toy/ops/public";
import { referenceCheck } from "./reference-check.js";
import { accountingProbe } from "./accounting-probe.js";

export const ReplayEnvironment = {
  async runRegisteredProbe(input: RegisteredProbeInputV1, context: OpsControlContextV1): Promise<Result<RegisteredProbeOperationV1>> {
    const owned = OpsTestStack.inspect(context);
    if (!owned.ok) return owned;
    if (!registeredProbeInputSchema.safeParse(input).success) return { ok: false, error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false } };
    if (input.caseId === "model-admission") return accountingProbe(input, context);
    try {
      if (input.probeId === "AT-hermes-config-101" && input.caseId && ["k4a-connector", "k4a-tool", "k4a-skill"].includes(input.caseId)) {
        return TestProbeControl.run(input, context, [await referenceCheck(input.caseId, context)]);
      }
      return TestProbeControl.run(input, context);
    } catch { return { ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } }; }
  },
  registeredProbeStatus(input: RegisteredProbeShowInputV1, context: OpsControlContextV1): Result<RegisteredProbeOperationV1> {
    return TestProbeControl.show(input, context);
  }
};
