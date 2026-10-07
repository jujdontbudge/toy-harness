export type { ModuleId } from "@toy/contracts";
export { EngineeringControl } from "./engineering-control.js";
export { ModelAdmission } from "./model-admission.js";
export { CapacityTrialJournal } from "./capacity-trial.js";
export { DurableCadenceOwner } from "./durable-cadence.js";
import { opsErrorMessages, registeredProbeInputSchema } from "@toy/contracts";
import type { OpsControlContextV1, RegisteredProbeInputV1, RegisteredProbeOperationV1, RegisteredProbeShowInputV1, Result } from "@toy/contracts";
import { OpsTestStack, QueueFaultProbe, TestProbeControl } from "@toy/ops/public";
import { referenceCheck } from "./reference-check.js";
import { accountingProbe } from "./accounting-probe.js";
import { componentComparisonProbe } from "./component-comparison-probe.js";
import { capacityTrialProbe } from "./capacity-trial-probe.js";
import { durableCadenceProbe } from "./durable-cadence-probe.js";
import { dtoRoundtripProbe } from "./dto-roundtrip-probe.js";
import { BuildInventoryProbe } from "./build-inventory-probe.js";
import { leastFragileToolsProbe } from "./least-fragile-tools-probe.js";
import { accountingTestConnection, withAccountingFixture } from "./accounting-postgres.js";

export const ReplayEnvironment = {
  async runRegisteredProbe(input: RegisteredProbeInputV1, context: OpsControlContextV1): Promise<Result<RegisteredProbeOperationV1>> {
    const owned = OpsTestStack.inspect(context);
    if (!owned.ok) return owned;
    if (!registeredProbeInputSchema.safeParse(input).success) return { ok: false, error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false } };
    if (input.probeId === "AT-authority-61") return BuildInventoryProbe.exercise(input, context);
    if (input.probeId === "AT-hermes-config-50") return dtoRoundtripProbe(input, context);
    if (input.probeId === "AT-adhd-features-106") return leastFragileToolsProbe(input, context);
    if (["AT-hermes-config-69", "AT-activity-focus-86"].includes(input.probeId)) return durableCadenceProbe(input, context);
    if (["AT-obligations-74", "AT-self-improvement-54", "AT-sources-188", "AT-sources-190", "AT-lifestore-45", "AT-workflows-1"].includes(input.probeId)) return componentComparisonProbe(input, context);
    if (input.caseId === "model-admission" || (input.caseId === undefined && ["AT-ops-10", "AT-ops-11", "AT-ops-49", "AT-ops-50", "AT-ops-51", "AT-ops-52"].includes(input.probeId))) return accountingProbe(input, context);
    if (input.caseId === "capacity-trial" || (input.caseId === undefined && ["AT-ops-47", "AT-self-improvement-59", "AT-self-improvement-60", "AT-RESEARCH-REGISTER-6"].includes(input.probeId))) return capacityTrialProbe(input, context);
    if (input.caseId === "queue-transaction-faults" && input.probeId !== "AT-obligations-76") return { ok: false, error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false } };
    try {
      if ((input.caseId === "queue-transaction-faults" || (input.probeId === "AT-obligations-76" && input.caseId === undefined)) && context.environment.stackId !== null) {
        const stackId = context.environment.stackId;
        const checks = await withAccountingFixture(stackId, context.timeoutMs, () => QueueFaultProbe.exercise(input, context, accountingTestConnection(stackId)));
        return TestProbeControl.run(input, context, checks);
      }
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
