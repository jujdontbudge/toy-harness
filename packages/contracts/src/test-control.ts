import { z } from "zod";
import { digestSchema, instantSchema, releaseSchema, revisionSchema, uint64Schema, uuidSchema } from "./primitives.js";
import { acceptanceStateSchema, checkViewSchema, evidenceLinksSchema, recordRefSchema } from "./control-evidence.js";
import { cadenceCoverageSchema, operationRefSchema, opsResultSchema } from "./ops.js";
import { registeredCliProbeInventory } from "./generated-probe-registry.js";

export { registeredCliProbeInventory, acceptanceSourceDigest } from "./generated-probe-registry.js";
export const registeredCliProbeIdSchema = z.enum(registeredCliProbeInventory.map((entry) => entry.id));
export const registeredTestWorldSchema = z.enum(["r0-bootstrap"]);
export const registeredTestCaseSchema = z.enum(["native-entry", "native-denials", "postgres-unix", "stack-lifecycle"]);
export const testStackClockSchema = z.enum(["fake", "real"]);
export const testStackModelSchema = z.enum(["fake", "supported"]);
export const elapsedDurationSchema = z.string().min(3).max(80).regex(/^P(?=\d|T\d)(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d{1,3})?S)?)?(?![\s\S])/);
const waitMsSchema = z.int().min(0).max(120000);
export const artifactBindingSchema = z.strictObject({
  releaseDigest: digestSchema, controlDigest: digestSchema, schemaDigest: digestSchema, fixtureDigest: digestSchema.nullable()
});
export const testStackTeardownSchema = z.strictObject({
  stackId: uuidSchema, checkpointRefs: z.array(recordRefSchema), fenceRefs: z.array(recordRefSchema),
  stoppedResourceRefs: z.array(recordRefSchema), retainedArtifactRefs: z.array(recordRefSchema),
  unresolvedResourceRefs: z.array(recordRefSchema), complete: z.boolean()
});
export const testStackViewSchema = z.strictObject({
  stackId: uuidSchema, release: releaseSchema, manifestDigest: digestSchema, clock: testStackClockSchema, model: testStackModelSchema,
  ready: z.boolean(), components: z.array(checkViewSchema), ownedResourceRefs: z.array(recordRefSchema),
  evidenceLocation: uuidSchema, teardown: testStackTeardownSchema.nullable()
});
export const testStackOperationSchema = z.strictObject({
  operation: operationRefSchema, requestId: uuidSchema, stackId: uuidSchema.nullable(), result: testStackViewSchema.nullable(), links: evidenceLinksSchema
});
export const opsTestStackResultSchema = opsResultSchema(testStackOperationSchema);
export const testClockStateSchema = z.strictObject({
  stackId: uuidSchema, revision: revisionSchema, virtualWall: instantSchema, awakeSeconds: uint64Schema, activeSeconds: uint64Schema,
  realMonotonicMs: uint64Schema, frozen: z.boolean(), pendingWorkRefs: z.array(recordRefSchema), coverage: cadenceCoverageSchema
});
export const testClockReceiptSchema = z.strictObject({
  requestId: uuidSchema, before: testClockStateSchema, after: testClockStateSchema, barrierRef: recordRefSchema
});
export const clockAdvanceOperationSchema = z.strictObject({
  operation: operationRefSchema, requestId: uuidSchema, stackId: uuidSchema.nullable(), result: testClockReceiptSchema.nullable(),
  links: evidenceLinksSchema, requestedThrough: instantSchema, reachedAt: instantSchema,
  barrier: z.enum(["settled", "pending", "blocked"]), unsettledRefs: z.array(recordRefSchema)
});
export const registeredProbeReportSchema = z.strictObject({
  probeId: registeredCliProbeIdSchema, caseManifestDigest: digestSchema, cases: z.array(checkViewSchema),
  state: acceptanceStateSchema, complete: z.boolean(), links: evidenceLinksSchema
});
export const registeredProbeOperationSchema = z.strictObject({
  operation: operationRefSchema, requestId: uuidSchema, stackId: uuidSchema.nullable(), result: registeredProbeReportSchema.nullable(),
  links: evidenceLinksSchema, probeId: registeredCliProbeIdSchema, binding: artifactBindingSchema, caseManifestDigest: digestSchema
});
export const testStackUpInputSchema = z.strictObject({
  release: releaseSchema, requestId: uuidSchema, world: registeredTestWorldSchema.optional(),
  clock: testStackClockSchema, model: testStackModelSchema, waitMs: waitMsSchema
});
export const testStackDownInputSchema = z.strictObject({ requestId: uuidSchema, waitMs: waitMsSchema });
export const testClockShowInputSchema = z.strictObject({});
export const testClockFreezeInputSchema = z.strictObject({ at: instantSchema, requestId: uuidSchema });
export const testClockResumeInputSchema = z.strictObject({ requestId: uuidSchema });
export const testClockAdvanceInputSchema = z.strictObject({ by: elapsedDurationSchema, requestId: uuidSchema, waitMs: waitMsSchema });
export const registeredProbeInputSchema = z.strictObject({
  probeId: registeredCliProbeIdSchema, requestId: uuidSchema, caseId: registeredTestCaseSchema.optional()
});
export const registeredProbeShowInputSchema = z.strictObject({ operationId: uuidSchema });
export const nativeProcessIdentitySchema = z.strictObject({
  pid: z.int().positive(), parentPid: z.int().nonnegative(), uid: z.int().nonnegative(), gid: z.int().nonnegative(),
  birthSeconds: uint64Schema, birthMicroseconds: z.int().min(0).max(999999)
});
export const nativeEntryReceiptSchema = z.strictObject({
  protocol: z.literal("toy.bootstrap-native.v1"), parent: nativeProcessIdentitySchema, child: nativeProcessIdentitySchema.nullable(),
  entered: z.literal(true), inheritedChildEntered: z.boolean(), containerHomeReady: z.boolean()
});
export const nativeBuildManifestSchema = z.strictObject({
  schemaVersion: z.literal("toy.bootstrap-native-build.v1"), generatedAt: instantSchema, schemaDigest: digestSchema,
  compilerVersion: z.literal("6.3.3"), compilerDigest: digestSchema, sdk: z.literal("MacOSX26.5.sdk"), sdkSettingsDigest: digestSchema,
  sourceDigests: z.strictObject({ contracts: digestSchema, entry: digestSchema, builder: digestSchema }),
  artifacts: z.strictObject({ parent: digestSchema, child: digestSchema })
});
export const nativeEntryReceiptV2Schema = z.strictObject({
  protocol: z.literal("toy.bootstrap-native.v2"), parent: nativeProcessIdentitySchema, child: nativeProcessIdentitySchema,
  entered: z.literal(true), inheritedChildEntered: z.literal(true), containerHomeReady: z.literal(false)
});
export const nativeBuildManifestV2Schema = z.strictObject({
  schemaVersion: z.literal("toy.bootstrap-native-build.v2"), generatedAt: instantSchema, schemaDigest: digestSchema,
  compilerVersion: z.literal("6.3.3"), compilerDigest: digestSchema, sdk: z.literal("MacOSX26.5.sdk"), sdkSettingsDigest: digestSchema,
  sourceDigests: z.strictObject({ contracts: digestSchema, entry: digestSchema, supervisor: digestSchema, builder: digestSchema }),
  artifacts: z.strictObject({ parent: digestSchema, child: digestSchema, supervisor: digestSchema })
});
export const nativeSupervisorRequestSchema = z.strictObject({
  protocol: z.literal("toy.bootstrap-supervisor.request.v1"), requestId: uuidSchema, operationId: uuidSchema, stackId: uuidSchema,
  generation: uint64Schema, schemaDigest: digestSchema, nativeBuildDigest: digestSchema,
  artifacts: z.strictObject({ parent: digestSchema, child: digestSchema, supervisor: digestSchema })
});
export const nativeSignatureObservationSchema = z.strictObject({
  role: z.enum(["supervisor", "parent", "child"]), identifier: z.string().min(1).max(120), artifactDigest: digestSchema,
  codeIdentifierHex: z.string().regex(/^[a-f0-9]{40}(?![\s\S])/), signatureFlags: z.int().min(0).max(4294967295),
  adHoc: z.literal(true), teamIdentifier: z.null(), hardenedRuntime: z.literal(true), libraryValidation: z.literal(true),
  entitlementProfile: z.enum(["none", "app-sandbox", "app-sandbox-inherit"])
});
export const nativeSupervisorReceiptSchema = z.strictObject({
  protocol: z.literal("toy.bootstrap-supervisor.receipt.v1"), requestId: uuidSchema, operationId: uuidSchema, stackId: uuidSchema,
  generation: uint64Schema, schemaDigest: digestSchema, nativeBuildDigest: digestSchema,
  supervisor: nativeProcessIdentitySchema,
  signatures: z.strictObject({
    supervisor: nativeSignatureObservationSchema.nullable(), parent: nativeSignatureObservationSchema.nullable(),
    child: nativeSignatureObservationSchema.nullable()
  }),
  entry: nativeEntryReceiptV2Schema.nullable(), observedParent: nativeProcessIdentitySchema.nullable(),
  failure: z.enum(["SIGNATURE_INVALID", "ARTIFACT_MISMATCH", "SPAWN_FAILED", "ENTRY_INVALID", "IDENTITY_MISMATCH", "TIMEOUT", "REAP_UNCONFIRMED"]).nullable(),
  spawnErrno: z.int().min(0).max(2147483647).nullable(), exitCode: z.int().min(0).max(255).nullable(),
  signal: z.int().min(1).max(127).nullable(), stdoutBytes: z.int().min(0).max(12288), stderrBytes: z.null(), parentReaped: z.boolean(),
  completeDescendantCleanup: z.literal(false), ready: z.literal(false)
});
export const bootstrapJournalOwnerSchema = z.strictObject({
  schemaVersion: z.literal("toy.bootstrap-journal-owner.v1"), storeId: uuidSchema,
  uid: z.int().nonnegative(), gid: z.int().nonnegative(), device: uint64Schema, inode: uint64Schema, createdAt: instantSchema
});
export const bootstrapJournalStateSchema = z.strictObject({
  schemaVersion: z.literal("toy.bootstrap-journal-state.v1"), storeId: uuidSchema, nextGeneration: uint64Schema
});
export const bootstrapUpRequestSchema = z.strictObject({
  schemaVersion: z.literal("toy.bootstrap-up-request.v1"), requestId: uuidSchema,
  release: releaseSchema, world: registeredTestWorldSchema, clock: testStackClockSchema, model: testStackModelSchema
});
export const bootstrapOperationRecordSchema = z.strictObject({
  schemaVersion: z.literal("toy.bootstrap-operation-record.v1"), storeId: uuidSchema,
  operationId: uuidSchema, requestId: uuidSchema, stackId: uuidSchema, generation: uint64Schema, requestDigest: digestSchema,
  acceptedAt: instantSchema, state: z.literal("blocked"), errorCode: z.literal("DEPENDENCY_UNAVAILABLE"),
  nativeExecutionPerformed: z.literal(false), resourcePermitIssued: z.literal(false)
});
export type RegisteredCliProbeIdV1 = z.infer<typeof registeredCliProbeIdSchema>;
export type RegisteredTestCaseV1 = z.infer<typeof registeredTestCaseSchema>;
export type ArtifactBindingV1 = z.infer<typeof artifactBindingSchema>;
export type TestStackTeardownV1 = z.infer<typeof testStackTeardownSchema>;
export type TestStackViewV1 = z.infer<typeof testStackViewSchema>;
export type TestStackOperationV1 = z.infer<typeof testStackOperationSchema>;
export type OpsTestStackResultV1 = z.infer<typeof opsTestStackResultSchema>;
export type TestClockStateV1 = z.infer<typeof testClockStateSchema>;
export type TestClockReceiptV1 = z.infer<typeof testClockReceiptSchema>;
export type ClockAdvanceOperationV1 = z.infer<typeof clockAdvanceOperationSchema>;
export type RegisteredProbeReportV1 = z.infer<typeof registeredProbeReportSchema>;
export type RegisteredProbeOperationV1 = z.infer<typeof registeredProbeOperationSchema>;
export type TestStackUpInputV1 = z.infer<typeof testStackUpInputSchema>;
export type TestStackDownInputV1 = z.infer<typeof testStackDownInputSchema>;
export type TestClockFreezeInputV1 = z.infer<typeof testClockFreezeInputSchema>;
export type TestClockResumeInputV1 = z.infer<typeof testClockResumeInputSchema>;
export type TestClockAdvanceInputV1 = z.infer<typeof testClockAdvanceInputSchema>;
export type RegisteredProbeInputV1 = z.infer<typeof registeredProbeInputSchema>;
export type RegisteredProbeShowInputV1 = z.infer<typeof registeredProbeShowInputSchema>;
export type NativeProcessIdentityV1 = z.infer<typeof nativeProcessIdentitySchema>;
export type NativeEntryReceiptV1 = z.infer<typeof nativeEntryReceiptSchema>;
export type NativeBuildManifestV1 = z.infer<typeof nativeBuildManifestSchema>;
export type NativeEntryReceiptV2 = z.infer<typeof nativeEntryReceiptV2Schema>;
export type NativeBuildManifestV2 = z.infer<typeof nativeBuildManifestV2Schema>;
export type NativeSupervisorRequestV1 = z.infer<typeof nativeSupervisorRequestSchema>;
export type NativeSignatureObservationV1 = z.infer<typeof nativeSignatureObservationSchema>;
export type NativeSupervisorReceiptV1 = z.infer<typeof nativeSupervisorReceiptSchema>;
export type BootstrapJournalOwnerV1 = z.infer<typeof bootstrapJournalOwnerSchema>;
export type BootstrapJournalStateV1 = z.infer<typeof bootstrapJournalStateSchema>;
export type BootstrapUpRequestV1 = z.infer<typeof bootstrapUpRequestSchema>;
export type BootstrapOperationRecordV1 = z.infer<typeof bootstrapOperationRecordSchema>;
export const testControlSchemaInventory = {
  RegisteredCliProbeIdV1: registeredCliProbeIdSchema, RegisteredTestWorldV1: registeredTestWorldSchema,
  RegisteredTestCaseV1: registeredTestCaseSchema, TestStackClockV1: testStackClockSchema, TestStackModelV1: testStackModelSchema,
  ElapsedDurationV1: elapsedDurationSchema, ArtifactBindingV1: artifactBindingSchema, TestStackTeardownV1: testStackTeardownSchema,
  TestStackViewV1: testStackViewSchema, TestStackOperationV1: testStackOperationSchema, OpsTestStackResultV1: opsTestStackResultSchema,
  TestClockStateV1: testClockStateSchema,
  TestClockReceiptV1: testClockReceiptSchema, ClockAdvanceOperationV1: clockAdvanceOperationSchema,
  RegisteredProbeReportV1: registeredProbeReportSchema, RegisteredProbeOperationV1: registeredProbeOperationSchema,
  TestStackUpInputV1: testStackUpInputSchema, TestStackDownInputV1: testStackDownInputSchema,
  TestClockFreezeInputV1: testClockFreezeInputSchema, TestClockResumeInputV1: testClockResumeInputSchema,
  TestClockAdvanceInputV1: testClockAdvanceInputSchema, RegisteredProbeInputV1: registeredProbeInputSchema,
  RegisteredProbeShowInputV1: registeredProbeShowInputSchema, NativeProcessIdentityV1: nativeProcessIdentitySchema,
  NativeEntryReceiptV1: nativeEntryReceiptSchema, NativeBuildManifestV1: nativeBuildManifestSchema,
  NativeEntryReceiptV2: nativeEntryReceiptV2Schema, NativeBuildManifestV2: nativeBuildManifestV2Schema,
  NativeSupervisorRequestV1: nativeSupervisorRequestSchema, NativeSignatureObservationV1: nativeSignatureObservationSchema,
  NativeSupervisorReceiptV1: nativeSupervisorReceiptSchema,
  BootstrapJournalOwnerV1: bootstrapJournalOwnerSchema, BootstrapJournalStateV1: bootstrapJournalStateSchema,
  BootstrapUpRequestV1: bootstrapUpRequestSchema, BootstrapOperationRecordV1: bootstrapOperationRecordSchema
};
