import { z } from "zod";
import { digestSchema, instantSchema, moduleIdSchema, revisionSchema, uuidSchema } from "./primitives.js";
import { cliAccessSchema, cliArgumentKindSchema, cliArgumentSchema, cliCommandIdSchema, cliDeclarationSchema, cliEnvironmentSchema } from "./cli-declarations.js";
import { observationEvidenceRefSchema, recordRefSchema } from "./control-evidence.js";
import { controlStatusInputSchema, controlStatusSchema, doctorInputSchema, doctorReportSchema } from "./ops.js";
export * from "./cli-declarations.js";

export const cliHelpSchema = z.strictObject({
  group: z.string().max(80).nullable(),
  commands: z.array(cliDeclarationSchema).min(1),
  commonArguments: z.array(cliArgumentSchema),
  schemaDigest: digestSchema,
  compatibility: z.strictObject({ wireVersions: z.array(z.literal("toy.cli.v1")), nodeVersion: z.literal("24.21.0") })
});
export const cliVersionSchema = z.strictObject({
  cliVersion: z.literal("1.0.0"), contractsVersion: z.literal("1.0.0"),
  executableDigest: digestSchema, packageDigest: digestSchema, schemaDigest: digestSchema,
  compatibility: z.strictObject({ wireVersions: z.array(z.literal("toy.cli.v1")), nodeVersion: z.literal("24.21.0") })
});
export const cliSafeMessageSchema = z.enum([
  "The invocation does not match the registered command schema.",
  "This command requires a named disposable test environment.",
  "The calling identity is not authorized for this operation.",
  "The registered owner operation is not implemented.",
  "The required installed owner or launcher is unavailable.",
  "The environment attestation is missing or invalid.",
  "The command could not produce a valid result.",
  "The owner response did not match the registered output schema."
]);
export const cliSafeMessages = cliSafeMessageSchema.options;
export const cliErrorSchema = z.strictObject({
  module: moduleIdSchema,
  code: z.enum(["INVALID_INPUT", "TEST_ONLY", "UNAUTHORIZED", "NOT_IMPLEMENTED", "DEPENDENCY_UNAVAILABLE", "ATTESTATION_INVALID", "INTERNAL_ERROR", "OUTPUT_INVALID"]),
  message: cliSafeMessageSchema, retryable: z.boolean(), retryAt: instantSchema.nullable(),
  effectState: z.enum(["none", "confirmed", "unknown"]), currentRevision: revisionSchema.nullable(), currentGeneration: revisionSchema.nullable(),
  operationRef: recordRefSchema.nullable(), requiredInteraction: z.null()
});
export const cliMetadataSchema = z.strictObject({
  exitCode: z.int().min(0).max(143), releaseDigest: digestSchema.nullable(), controlDigest: digestSchema.nullable(),
  evaluatedAt: instantSchema.nullable(), operationId: uuidSchema.nullable(), effectState: z.enum(["none", "confirmed", "unknown"]),
  recordRefs: z.array(recordRefSchema), evidence: z.array(observationEvidenceRefSchema)
});
const cliEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal("toy.cli.v1"), commandId: cliCommandIdSchema,
  invocationId: uuidSchema, generatedAt: instantSchema,
  cliVersion: z.literal("1.0.0"), contractsVersion: z.literal("1.0.0"), schemaDigest: digestSchema,
  environment: cliEnvironmentSchema, meta: cliMetadataSchema
});
export const cliFailureSchema = cliEnvelopeSchema.extend({ ok: z.literal(false), error: cliErrorSchema });
export const cliHelpResultSchema = cliEnvelopeSchema.extend({ commandId: z.literal("help"), ok: z.literal(true), data: cliHelpSchema });
export const cliVersionResultSchema = cliEnvelopeSchema.extend({ commandId: z.literal("version"), ok: z.literal(true), data: cliVersionSchema });
export const cliStatusResultSchema = cliEnvelopeSchema.extend({ commandId: z.literal("status"), ok: z.literal(true), data: controlStatusSchema });
export const cliDoctorResultSchema = cliEnvelopeSchema.extend({ commandId: z.literal("doctor"), ok: z.literal(true), data: doctorReportSchema });
export const cliResultSchema = z.union([cliFailureSchema, cliHelpResultSchema, cliVersionResultSchema, cliStatusResultSchema, cliDoctorResultSchema]);
export type CliResult = z.infer<typeof cliResultSchema>;
export type CliFailure = z.infer<typeof cliFailureSchema>;
export type CliEnvironment = z.infer<typeof cliEnvironmentSchema>;
export type CliHelp = z.infer<typeof cliHelpSchema>;
export type CliVersion = z.infer<typeof cliVersionSchema>;
export const cliHelpInputSchema = z.strictObject({ group: z.string().max(80).nullable() });
export const cliVersionInputSchema = z.strictObject({});
export const cliHelpCommandResultSchema = z.union([cliHelpResultSchema, cliFailureSchema.extend({ commandId: z.literal("help") })]);
export const cliVersionCommandResultSchema = z.union([cliVersionResultSchema, cliFailureSchema.extend({ commandId: z.literal("version") })]);
export const cliStatusCommandResultSchema = z.union([cliStatusResultSchema, cliFailureSchema.extend({ commandId: z.literal("status") })]);
export const cliDoctorCommandResultSchema = z.union([cliDoctorResultSchema, cliFailureSchema.extend({ commandId: z.literal("doctor") })]);
export const cliCommandSchemas = {
  help: { input: cliHelpInputSchema, data: cliHelpSchema, result: cliHelpCommandResultSchema },
  version: { input: cliVersionInputSchema, data: cliVersionSchema, result: cliVersionCommandResultSchema },
  status: { input: controlStatusInputSchema, data: controlStatusSchema, result: cliStatusCommandResultSchema },
  doctor: { input: doctorInputSchema, data: doctorReportSchema, result: cliDoctorCommandResultSchema }
};
export type CliInputV1<C extends keyof typeof cliCommandSchemas> = z.infer<(typeof cliCommandSchemas)[C]["input"]>;
export type CliDataV1<C extends keyof typeof cliCommandSchemas> = z.infer<(typeof cliCommandSchemas)[C]["data"]>;
export type CliResultV1<C extends keyof typeof cliCommandSchemas> = z.infer<(typeof cliCommandSchemas)[C]["result"]>;

export const cliSchemaInventory = {
  CliAccess: cliAccessSchema, CliArgumentKind: cliArgumentKindSchema, CliCommandId: cliCommandIdSchema,
  CliArgument: cliArgumentSchema, CliDeclaration: cliDeclarationSchema,
  CliHelpV1: cliHelpSchema, CliVersionV1: cliVersionSchema, CliEnvironment: cliEnvironmentSchema,
  CliSafeMessage: cliSafeMessageSchema, CliError: cliErrorSchema, CliMetadata: cliMetadataSchema, CliFailure: cliFailureSchema,
  CliHelpResult: cliHelpResultSchema, CliVersionResult: cliVersionResultSchema, CliStatusResult: cliStatusResultSchema, CliDoctorResult: cliDoctorResultSchema, CliResult: cliResultSchema,
  CliHelpInput: cliHelpInputSchema, CliVersionInput: cliVersionInputSchema,
  CliHelpCommandResult: cliHelpCommandResultSchema, CliVersionCommandResult: cliVersionCommandResultSchema,
  CliStatusCommandResult: cliStatusCommandResultSchema, CliDoctorCommandResult: cliDoctorCommandResultSchema
};
