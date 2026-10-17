import type { ControlStatusInputV1, ControlStatusV1, OpsControlContextV1 } from "@toy/contracts";
import { OpsControlRead } from "@toy/ops/public";

export const opsStatusToolRegistration = {
  name: "toy_ops_status", owner: "ops", plugin: "toy", version: "1.0.0",
  inputSchema: "ControlStatusInputV1", resultSchema: "ControlStatusV1"
};

export const toyOpsStatus = (input: ControlStatusInputV1, context: OpsControlContextV1): Promise<ControlStatusV1> => OpsControlRead.status(input, context);
