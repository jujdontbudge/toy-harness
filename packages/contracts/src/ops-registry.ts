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
  declaration("read.ops", "ops", "status"), declaration("read.sources", "sources", "sources.health"),
  declaration("read.attention", "attention", "attention.snapshot"), declaration("read.quota", "ops", "status"),
  declaration("read.cadence", "self-improvement", "review.slots"), declaration("read.release", "ops", "release.status")
];
export const registeredCheckIdSchema = z.enum(opsControlReadInventory.map((entry) => entry.id));
export const opsControlProbeDeclarationSchema = z.strictObject({
  id: registeredCheckIdSchema, owner: moduleIdSchema, nextCommandId: cliCommandIdSchema
});
for (const entry of opsControlReadInventory) opsControlProbeDeclarationSchema.parse(entry);
export type OpsControlProbeDeclarationV1 = z.infer<typeof opsControlProbeDeclarationSchema>;
export type RegisteredCheckIdV1 = z.infer<typeof registeredCheckIdSchema>;
export const opsRegistrySchemaInventory = { ServiceId: serviceIdSchema, OpsControlProbeDeclarationV1: opsControlProbeDeclarationSchema, RegisteredCheckIdV1: registeredCheckIdSchema };
