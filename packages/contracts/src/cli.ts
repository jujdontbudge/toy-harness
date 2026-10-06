import { z } from "zod";
import { digestSchema, instantSchema, moduleIdSchema, revisionSchema, uuidSchema } from "./primitives.js";
import { cliAccessSchema, cliArgumentKindSchema, cliArgumentSchema, cliCommandIdSchema, cliDeclarationSchema, cliEnvironmentSchema } from "./cli-declarations.js";
import { observationEvidenceRefSchema, recordRefSchema } from "./control-evidence.js";
import { controlStatusInputSchema, controlStatusSchema, doctorInputSchema, doctorReportSchema, opsErrorCodeSchema, opsErrorMessages, opsSafeMessageSchema } from "./ops.js";
import {
  clockAdvanceOperationSchema, registeredProbeInputSchema, registeredProbeOperationSchema, registeredProbeShowInputSchema,
  testClockAdvanceInputSchema, testClockFreezeInputSchema, testClockReceiptSchema, testClockResumeInputSchema, testClockShowInputSchema,
  testClockStateSchema, testStackDownInputSchema, testStackOperationSchema, testStackUpInputSchema
} from "./test-control.js";
import { generatorInputSchema, generatorPlanSchema, mapCheckInputSchema, mapUpdateInputSchema, featureMapCheckSchema, featureMapUpdateSchema, gardenerInputSchema, gardenerReportSchema, researchRegisterInspectionSchema } from "./engineering-control.js";
import { roleBootstrapInputSchema, roleBootstrapReportSchema } from "./identity-bootstrap.js";
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
  "The owner response did not match the registered output schema.",
  ...opsSafeMessageSchema.options
]);
export const cliSafeMessages = cliSafeMessageSchema.options;
export const cliErrorCodeSchema = z.enum([...new Set([
  "INVALID_INPUT", "TEST_ONLY", "UNAUTHORIZED", "NOT_IMPLEMENTED", "DEPENDENCY_UNAVAILABLE", "ATTESTATION_INVALID", "INTERNAL_ERROR", "OUTPUT_INVALID",
  ...opsErrorCodeSchema.options
] as const)]);
export const cliErrorMessages = {
  ...opsErrorMessages,
  TEST_ONLY: "This command requires a named disposable test environment.",
  NOT_IMPLEMENTED: "The registered owner operation is not implemented.",
  INTERNAL_ERROR: "The command could not produce a valid result.",
  OUTPUT_INVALID: "The owner response did not match the registered output schema."
} as const satisfies Record<z.infer<typeof cliErrorCodeSchema>, z.infer<typeof cliSafeMessageSchema>>;
export const cliErrorSchema = z.strictObject({
  module: moduleIdSchema,
  code: cliErrorCodeSchema,
  message: cliSafeMessageSchema, retryable: z.boolean(), retryAt: instantSchema.nullable(),
  effectState: z.enum(["none", "confirmed", "unknown"]), currentRevision: revisionSchema.nullable(), currentGeneration: revisionSchema.nullable(),
  operationRef: recordRefSchema.nullable(), requiredInteraction: z.null(), incidentId: uuidSchema.optional()
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
export const cliStackUpResultSchema = cliEnvelopeSchema.extend({ commandId: z.literal("stack.up"), ok: z.literal(true), data: testStackOperationSchema });
export const cliStackDownResultSchema = cliEnvelopeSchema.extend({ commandId: z.literal("stack.down"), ok: z.literal(true), data: testStackOperationSchema });
export const cliClockShowResultSchema = cliEnvelopeSchema.extend({ commandId: z.literal("clock.show"), ok: z.literal(true), data: testClockStateSchema });
export const cliClockFreezeResultSchema = cliEnvelopeSchema.extend({ commandId: z.literal("clock.freeze"), ok: z.literal(true), data: testClockReceiptSchema });
export const cliClockResumeResultSchema = cliEnvelopeSchema.extend({ commandId: z.literal("clock.resume"), ok: z.literal(true), data: testClockReceiptSchema });
export const cliClockAdvanceResultSchema = cliEnvelopeSchema.extend({ commandId: z.literal("clock.advance"), ok: z.literal(true), data: clockAdvanceOperationSchema });
export const cliProbeRunResultSchema = cliEnvelopeSchema.extend({ commandId: z.literal("probe.run"), ok: z.literal(true), data: registeredProbeOperationSchema });
export const cliProbeShowResultSchema = cliEnvelopeSchema.extend({ commandId: z.literal("probe.show"), ok: z.literal(true), data: registeredProbeOperationSchema });
export const cliNewConnectorResultSchema = cliEnvelopeSchema.extend({ commandId: z.literal("new.connector"), ok: z.literal(true), data: generatorPlanSchema });
export const cliNewConnectorCommandResultSchema = z.union([cliNewConnectorResultSchema, cliFailureSchema.extend({ commandId: z.literal("new.connector") })]);
export const cliNewToolResultSchema = cliEnvelopeSchema.extend({ commandId: z.literal("new.tool"), ok: z.literal(true), data: generatorPlanSchema });
export const cliNewToolCommandResultSchema = z.union([cliNewToolResultSchema, cliFailureSchema.extend({ commandId: z.literal("new.tool") })]);
export const cliNewSkillResultSchema = cliEnvelopeSchema.extend({ commandId: z.literal("new.skill"), ok: z.literal(true), data: generatorPlanSchema });
export const cliNewSkillCommandResultSchema = z.union([cliNewSkillResultSchema, cliFailureSchema.extend({ commandId: z.literal("new.skill") })]);
export const cliNewMigrationResultSchema = cliEnvelopeSchema.extend({ commandId: z.literal("new.migration"), ok: z.literal(true), data: generatorPlanSchema });
export const cliNewMigrationCommandResultSchema = z.union([cliNewMigrationResultSchema, cliFailureSchema.extend({ commandId: z.literal("new.migration") })]);
export const cliMapCheckResultSchema = cliEnvelopeSchema.extend({ commandId: z.literal("feature-map.check"), ok: z.literal(true), data: featureMapCheckSchema });
export const cliMapCheckCommandResultSchema = z.union([cliMapCheckResultSchema, cliFailureSchema.extend({ commandId: z.literal("feature-map.check") })]);
export const cliMapUpdateResultSchema = cliEnvelopeSchema.extend({ commandId: z.literal("feature-map.update"), ok: z.literal(true), data: featureMapUpdateSchema });
export const cliMapUpdateCommandResultSchema = z.union([cliMapUpdateResultSchema, cliFailureSchema.extend({ commandId: z.literal("feature-map.update") })]);
export const cliGardenResultSchema = cliEnvelopeSchema.extend({ commandId: z.literal("gardener.run"), ok: z.literal(true), data: gardenerReportSchema });
export const cliGardenCommandResultSchema = z.union([cliGardenResultSchema, cliFailureSchema.extend({ commandId: z.literal("gardener.run") })]);
export const cliResearchCheckResultSchema = cliEnvelopeSchema.extend({ commandId: z.literal("research.check"), ok: z.literal(true), data: researchRegisterInspectionSchema });
export const cliResearchCheckCommandResultSchema = z.union([cliResearchCheckResultSchema, cliFailureSchema.extend({ commandId: z.literal("research.check") })]);
export const cliBootstrapIdentitiesResultSchema = cliEnvelopeSchema.extend({ commandId: z.literal("bootstrap.identities"), ok: z.literal(true), data: roleBootstrapReportSchema });
export const cliBootstrapIdentitiesCommandResultSchema = z.union([cliBootstrapIdentitiesResultSchema, cliFailureSchema.extend({ commandId: z.literal("bootstrap.identities") })]);
export const cliResultSchema = z.union([
  cliBootstrapIdentitiesResultSchema,
  cliResearchCheckResultSchema,
  cliFailureSchema, cliHelpResultSchema, cliVersionResultSchema, cliStatusResultSchema, cliDoctorResultSchema,
  cliStackUpResultSchema, cliStackDownResultSchema, cliClockShowResultSchema, cliClockFreezeResultSchema,
  cliClockResumeResultSchema, cliClockAdvanceResultSchema, cliProbeRunResultSchema, cliProbeShowResultSchema, cliNewConnectorResultSchema, cliNewToolResultSchema, cliNewSkillResultSchema, cliNewMigrationResultSchema, cliMapCheckResultSchema, cliMapUpdateResultSchema, cliGardenResultSchema
]);
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
export const cliStackUpCommandResultSchema = z.union([cliStackUpResultSchema, cliFailureSchema.extend({ commandId: z.literal("stack.up") })]);
export const cliStackDownCommandResultSchema = z.union([cliStackDownResultSchema, cliFailureSchema.extend({ commandId: z.literal("stack.down") })]);
export const cliClockShowCommandResultSchema = z.union([cliClockShowResultSchema, cliFailureSchema.extend({ commandId: z.literal("clock.show") })]);
export const cliClockFreezeCommandResultSchema = z.union([cliClockFreezeResultSchema, cliFailureSchema.extend({ commandId: z.literal("clock.freeze") })]);
export const cliClockResumeCommandResultSchema = z.union([cliClockResumeResultSchema, cliFailureSchema.extend({ commandId: z.literal("clock.resume") })]);
export const cliClockAdvanceCommandResultSchema = z.union([cliClockAdvanceResultSchema, cliFailureSchema.extend({ commandId: z.literal("clock.advance") })]);
export const cliProbeRunCommandResultSchema = z.union([cliProbeRunResultSchema, cliFailureSchema.extend({ commandId: z.literal("probe.run") })]);
export const cliProbeShowCommandResultSchema = z.union([cliProbeShowResultSchema, cliFailureSchema.extend({ commandId: z.literal("probe.show") })]);
export const cliCommandSchemas = {
  "bootstrap.identities": { input: roleBootstrapInputSchema, data: roleBootstrapReportSchema, result: cliBootstrapIdentitiesCommandResultSchema },
  "research.check": { input: mapCheckInputSchema, data: researchRegisterInspectionSchema, result: cliResearchCheckCommandResultSchema },
  "new.connector": { input: generatorInputSchema, data: generatorPlanSchema, result: cliNewConnectorCommandResultSchema },
  "new.tool": { input: generatorInputSchema, data: generatorPlanSchema, result: cliNewToolCommandResultSchema },
  "new.skill": { input: generatorInputSchema, data: generatorPlanSchema, result: cliNewSkillCommandResultSchema },
  "new.migration": { input: generatorInputSchema, data: generatorPlanSchema, result: cliNewMigrationCommandResultSchema },
  "feature-map.check": { input: mapCheckInputSchema, data: featureMapCheckSchema, result: cliMapCheckCommandResultSchema },
  "feature-map.update": { input: mapUpdateInputSchema, data: featureMapUpdateSchema, result: cliMapUpdateCommandResultSchema },
  "gardener.run": { input: gardenerInputSchema, data: gardenerReportSchema, result: cliGardenCommandResultSchema },
  help: { input: cliHelpInputSchema, data: cliHelpSchema, result: cliHelpCommandResultSchema },
  version: { input: cliVersionInputSchema, data: cliVersionSchema, result: cliVersionCommandResultSchema },
  status: { input: controlStatusInputSchema, data: controlStatusSchema, result: cliStatusCommandResultSchema },
  doctor: { input: doctorInputSchema, data: doctorReportSchema, result: cliDoctorCommandResultSchema },
  "stack.up": { input: testStackUpInputSchema, data: testStackOperationSchema, result: cliStackUpCommandResultSchema },
  "stack.down": { input: testStackDownInputSchema, data: testStackOperationSchema, result: cliStackDownCommandResultSchema },
  "clock.show": { input: testClockShowInputSchema, data: testClockStateSchema, result: cliClockShowCommandResultSchema },
  "clock.freeze": { input: testClockFreezeInputSchema, data: testClockReceiptSchema, result: cliClockFreezeCommandResultSchema },
  "clock.resume": { input: testClockResumeInputSchema, data: testClockReceiptSchema, result: cliClockResumeCommandResultSchema },
  "clock.advance": { input: testClockAdvanceInputSchema, data: clockAdvanceOperationSchema, result: cliClockAdvanceCommandResultSchema },
  "probe.run": { input: registeredProbeInputSchema, data: registeredProbeOperationSchema, result: cliProbeRunCommandResultSchema },
  "probe.show": { input: registeredProbeShowInputSchema, data: registeredProbeOperationSchema, result: cliProbeShowCommandResultSchema }
};
export type CliInputV1<C extends keyof typeof cliCommandSchemas> = z.infer<(typeof cliCommandSchemas)[C]["input"]>;
export type CliDataV1<C extends keyof typeof cliCommandSchemas> = z.infer<(typeof cliCommandSchemas)[C]["data"]>;
export type CliResultV1<C extends keyof typeof cliCommandSchemas> = z.infer<(typeof cliCommandSchemas)[C]["result"]>;

export const cliSchemaInventory = {
  CliBootstrapIdentitiesResult: cliBootstrapIdentitiesResultSchema, CliBootstrapIdentitiesCommandResult: cliBootstrapIdentitiesCommandResultSchema,
  CliResearchCheckResult: cliResearchCheckResultSchema, CliResearchCheckCommandResult: cliResearchCheckCommandResultSchema,
  CliNewConnectorResult: cliNewConnectorResultSchema, CliNewConnectorCommandResult: cliNewConnectorCommandResultSchema,
  CliNewToolResult: cliNewToolResultSchema, CliNewToolCommandResult: cliNewToolCommandResultSchema,
  CliNewSkillResult: cliNewSkillResultSchema, CliNewSkillCommandResult: cliNewSkillCommandResultSchema,
  CliNewMigrationResult: cliNewMigrationResultSchema, CliNewMigrationCommandResult: cliNewMigrationCommandResultSchema,
  CliMapCheckResult: cliMapCheckResultSchema, CliMapCheckCommandResult: cliMapCheckCommandResultSchema,
  CliMapUpdateResult: cliMapUpdateResultSchema, CliMapUpdateCommandResult: cliMapUpdateCommandResultSchema,
  CliGardenResult: cliGardenResultSchema, CliGardenCommandResult: cliGardenCommandResultSchema,

  CliAccess: cliAccessSchema, CliArgumentKind: cliArgumentKindSchema, CliCommandId: cliCommandIdSchema,
  CliArgument: cliArgumentSchema, CliDeclaration: cliDeclarationSchema,
  CliHelpV1: cliHelpSchema, CliVersionV1: cliVersionSchema, CliEnvironment: cliEnvironmentSchema,
  CliSafeMessage: cliSafeMessageSchema, CliErrorCode: cliErrorCodeSchema, CliError: cliErrorSchema, CliMetadata: cliMetadataSchema, CliFailure: cliFailureSchema,
  CliHelpResult: cliHelpResultSchema, CliVersionResult: cliVersionResultSchema, CliStatusResult: cliStatusResultSchema, CliDoctorResult: cliDoctorResultSchema, CliResult: cliResultSchema,
  CliHelpInput: cliHelpInputSchema, CliVersionInput: cliVersionInputSchema,
  CliHelpCommandResult: cliHelpCommandResultSchema, CliVersionCommandResult: cliVersionCommandResultSchema,
  CliStatusCommandResult: cliStatusCommandResultSchema, CliDoctorCommandResult: cliDoctorCommandResultSchema,
  CliStackUpResult: cliStackUpResultSchema, CliStackDownResult: cliStackDownResultSchema,
  CliClockShowResult: cliClockShowResultSchema, CliClockFreezeResult: cliClockFreezeResultSchema,
  CliClockResumeResult: cliClockResumeResultSchema, CliClockAdvanceResult: cliClockAdvanceResultSchema,
  CliProbeRunResult: cliProbeRunResultSchema, CliProbeShowResult: cliProbeShowResultSchema,
  CliStackUpCommandResult: cliStackUpCommandResultSchema, CliStackDownCommandResult: cliStackDownCommandResultSchema,
  CliClockShowCommandResult: cliClockShowCommandResultSchema, CliClockFreezeCommandResult: cliClockFreezeCommandResultSchema,
  CliClockResumeCommandResult: cliClockResumeCommandResultSchema, CliClockAdvanceCommandResult: cliClockAdvanceCommandResultSchema,
  CliProbeRunCommandResult: cliProbeRunCommandResultSchema, CliProbeShowCommandResult: cliProbeShowCommandResultSchema
};
