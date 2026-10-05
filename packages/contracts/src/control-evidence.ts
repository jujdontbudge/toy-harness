import { z } from "zod";
import { digestSchema, instantSchema, moduleIdSchema, releaseSchema, revisionSchema, uuidSchema } from "./primitives.js";
import { cliCommandIdSchema, registeredCapabilityIdSchema } from "./cli-declarations.js";
import { registeredCheckIdSchema, serviceIdSchema } from "./ops-registry.js";

export const acceptanceStateSchema = z.enum(["PASS", "FAIL", "BLOCKED", "DEFERRED_CAPABILITY", "NOT_IMPLEMENTED"]);
export const recordRefSchema = z.strictObject({ module: z.string().min(1).max(80), kind: z.string().min(1).max(100), id: uuidSchema });
const uuidWirePattern = uuidSchema.toJSONSchema({ target: "draft-2020-12", io: "output", unrepresentable: "throw" }).pattern;
if (typeof uuidWirePattern !== "string" || !uuidWirePattern.startsWith("^")) throw new Error("UUID wire pattern is required for immutable observation references");
export const observationRefSchema = z.string().length(55).regex(new RegExp("^life://observation/" + uuidWirePattern.slice(1)));
export const observationEvidenceRefSchema = z.strictObject({
  observationRef: observationRefSchema,
  documentId: uuidSchema.optional(), byteFrom: revisionSchema.optional(), byteTo: revisionSchema.optional(), quote: z.string().optional()
});
export const evidenceLinksSchema = z.strictObject({ recordRefs: z.array(recordRefSchema), observations: z.array(observationEvidenceRefSchema), artifactDigests: z.array(digestSchema) });
export const checkViewSchema = z.strictObject({
  id: registeredCheckIdSchema, owner: moduleIdSchema, state: acceptanceStateSchema, checkedAt: instantSchema,
  reasonCode: z.string().max(2000).nullable(), prerequisite: z.string().max(2000).nullable(),
  nextCommandId: cliCommandIdSchema.nullable(), links: evidenceLinksSchema
});
export const capabilityViewSchema = z.strictObject({
  id: registeredCapabilityIdSchema, firstRelease: releaseSchema, required: z.boolean(),
  implementation: z.enum(["specified", "built", "retired"]), state: acceptanceStateSchema,
  tested: z.boolean(), installed: z.boolean(), deployed: z.boolean(), checkedAt: instantSchema.nullable(),
  prerequisite: z.string().max(2000).nullable(), links: evidenceLinksSchema
});
export const secretReadinessSchema = z.strictObject({
  serviceId: serviceIdSchema, state: z.enum(["ready", "expired", "missing", "blocked", "unknown"]),
  checkedAt: instantSchema, expiresAt: instantSchema.nullable()
});
export type RecordRef = z.infer<typeof recordRefSchema>;
export type ObservationEvidenceRef = z.infer<typeof observationEvidenceRefSchema>;
export type EvidenceLinksV1 = z.infer<typeof evidenceLinksSchema>;
export type CheckViewV1 = z.infer<typeof checkViewSchema>;
export type CapabilityViewV1 = z.infer<typeof capabilityViewSchema>;
export type SecretReadinessV1 = z.infer<typeof secretReadinessSchema>;
export type AcceptanceStateV1 = z.infer<typeof acceptanceStateSchema>;
export const controlEvidenceSchemaInventory = {
  AcceptanceStateV1: acceptanceStateSchema, RecordRef: recordRefSchema, ObservationRef: observationRefSchema,
  ObservationEvidenceRef: observationEvidenceRefSchema, EvidenceLinksV1: evidenceLinksSchema,
  CheckViewV1: checkViewSchema, CapabilityViewV1: capabilityViewSchema, SecretReadinessV1: secretReadinessSchema,
  RegisteredCapabilityIdV1: registeredCapabilityIdSchema
};
