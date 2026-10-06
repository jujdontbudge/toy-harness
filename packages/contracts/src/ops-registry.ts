import { z } from "zod";
import { moduleIdSchema } from "./primitives.js";
import { cliCommandIdSchema } from "./cli-declarations.js";
import type { ModuleId } from "./primitives.js";
import type { CliCommandId } from "./cli-declarations.js";

export const serviceIdSchema = z.enum([
  "postgres", "backend", "workers", "hermes", "hermes-interactive", "ops", "authority", "ingress", "approval", "review",
  "attention-delivery", "hands", "backup", "secrets", "publisher", "evaluator", "repair", "tailscale", "recorder"
]);
export type ServiceId = z.infer<typeof serviceIdSchema>;
const declaration = <Id extends string>(id: Id, owner: ModuleId, nextCommandId: CliCommandId) => ({ id, owner, nextCommandId });
export const opsControlReadInventory = [
  ...serviceIdSchema.options.map((id) => declaration(`service.${id}`, "ops", "status")),
  declaration("read.model-route", "ops", "doctor"),
  declaration("read.model-route-policy", "hermes", "doctor"),
  declaration("read.ops", "ops", "status"), declaration("read.sources", "sources", "sources.health"),
  declaration("read.attention", "attention", "attention.snapshot"), declaration("read.quota", "ops", "status"),
  declaration("read.cadence", "self-improvement", "review.slots"), declaration("read.release", "ops", "release.status")
];
export const testStackCheckInventory = [
  declaration("engineering.map", "self-improvement", "feature-map.check"), declaration("engineering.static", "self-improvement", "gardener.run"),
  declaration("accounting.model-admission", "self-improvement", "probe.run"),
  declaration("queue.obligation-faults", "ops", "probe.run"),
  declaration("release.native-eligibility", "ops", "probe.run"),
  declaration("backup.local-inventory", "ops", "doctor"),
  declaration("backup.capacity", "ops", "probe.run"),
  declaration("auth.native-runtime", "hermes", "probe.run"),
  declaration("auth.native-fixture", "hermes", "probe.run"),
  declaration("bootstrap.reference.connector", "sources", "probe.run"), declaration("bootstrap.reference.tool", "self-improvement", "probe.run"),
  declaration("bootstrap.reference.skill", "self-improvement", "probe.run"), declaration("bootstrap.reference.migration", "ops", "probe.run"),
  declaration("bootstrap.fixture-runtime", "ops", "stack.up"), declaration("bootstrap.fixture-identities", "ops", "doctor"),
  declaration("bootstrap.role-identities", "ops", "doctor"), declaration("bootstrap.role-control-denials", "ops", "probe.run"),
  declaration("bootstrap.journal", "ops", "stack.up"),
  declaration("bootstrap.signature", "ops", "stack.up"), declaration("bootstrap.native-entry", "ops", "stack.up"),
  declaration("bootstrap.inherited-child", "ops", "stack.up"), declaration("bootstrap.fs-denial", "ops", "stack.up"),
  declaration("bootstrap.network-denial", "ops", "stack.up"), declaration("bootstrap.keychain-denial", "ops", "stack.up"),
  declaration("bootstrap.container-isolation", "ops", "stack.up"),
  declaration("bootstrap.postgres-unix", "ops", "stack.up"), declaration("bootstrap.controller-peer", "ops", "stack.up"),
  declaration("bootstrap.resource-admission", "ops", "stack.up"), declaration("bootstrap.cleanup", "ops", "stack.down")
];
export const registeredCheckIdSchema = z.enum([...opsControlReadInventory, ...testStackCheckInventory].map((entry) => entry.id));
export const opsControlProbeDeclarationSchema = z.strictObject({
  id: registeredCheckIdSchema, owner: moduleIdSchema, nextCommandId: cliCommandIdSchema
});
for (const entry of opsControlReadInventory) opsControlProbeDeclarationSchema.parse(entry);
for (const entry of testStackCheckInventory) opsControlProbeDeclarationSchema.parse(entry);
export type OpsControlProbeDeclarationV1 = z.infer<typeof opsControlProbeDeclarationSchema>;
export type RegisteredCheckIdV1 = z.infer<typeof registeredCheckIdSchema>;
export const opsRegistrySchemaInventory = { ServiceId: serviceIdSchema, OpsControlProbeDeclarationV1: opsControlProbeDeclarationSchema, RegisteredCheckIdV1: registeredCheckIdSchema };
