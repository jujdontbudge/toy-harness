import { z } from "zod";
import { cadenceSlotStateSchema, moduleIdSchema, releaseSchema, uuidSchema } from "./primitives.js";
export const cliEnvironmentSchema = z.strictObject({ kind: z.enum(["prod", "test"]), instanceId: uuidSchema.nullable(), stackId: uuidSchema.nullable() });
export const cliAccessSchema = z.enum(["read", "guarded", "test", "engineering", "human"]);
export const cliArgumentKindSchema = z.enum(["UUID", "Instant", "UInt64String", "SHA256", "Duration", "integer", "enum", "registered", "text", "input", "boolean", "life-ref", "name"]);
export const cliArgumentSchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9-]*(?![\s\S])/),
  kind: cliArgumentKindSchema,
  positional: z.boolean(),
  required: z.boolean(),
  values: z.array(z.string()).max(32),
  minimum: z.int().nonnegative().nullable(),
  maximum: z.int().nonnegative().nullable()
});
export const cliDeclarationSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*(?![\s\S])/),
  owner: moduleIdSchema,
  operation: z.string().max(100),
  access: cliAccessSchema,
  firstRelease: releaseSchema,
  implementation: z.enum(["specified", "built"]),
  ownerSchemas: z.enum(["pending", "registered"]),
  inputSchemaId: z.string().regex(/^urn:toy:contracts:v1:CliInputV1:/),
  outputSchemaId: z.string().regex(/^urn:toy:contracts:v1:CliResultV1:/),
  dataSchemaId: z.string().regex(/^urn:toy:contracts:v1:CliDataV1:/),
  featureIds: z.array(z.string()).min(1),
  requirementIds: z.array(z.string()).min(1),
  arguments: z.array(cliArgumentSchema).max(20)
});
export type CliArgument = z.infer<typeof cliArgumentSchema>;
export type CliDeclaration = z.infer<typeof cliDeclarationSchema>;

const arg = (name: string, kind: CliArgument["kind"], required = false, positional = false, values: string[] = [], minimum: number | null = null, maximum: number | null = null): CliArgument =>
  cliArgumentSchema.parse({ name, kind, required, positional, values, minimum, maximum });
const flag = (name: string): CliArgument => arg(name, "boolean");
const choice = (name: string, values: string[], required = false): CliArgument => arg(name, "enum", required, false, values);
const page = (maximum = 100): CliArgument[] => [arg("limit", "integer", false, false, [], 1, maximum), arg("cursor", "text")];
const request = (): CliArgument => arg("request-id", "UUID", true);
const wait = (): CliArgument => arg("wait-ms", "integer", false, false, [], 0, 120000);
const id = (name: string): CliArgument => arg(name, "UUID", true, true);
const input = (): CliArgument => arg("input", "input", true);
const range = (required: boolean): CliArgument[] => [arg("from", "Instant", required), arg("to", "Instant", required)];
const release = (required = false): CliArgument => choice("release", releaseSchema.options, required);
const declaration = <CommandId extends string>(commandId: CommandId, owner: CliDeclaration["owner"], operation: string, access: CliDeclaration["access"], firstRelease: CliDeclaration["firstRelease"], args: CliArgument[]) => cliDeclarationSchema.extend({ id: z.literal(commandId) }).parse({
  id: commandId, owner, operation, access, firstRelease,
  implementation: ["help", "version", "status", "doctor", "stack.up", "stack.down", "clock.show", "clock.freeze", "clock.resume", "clock.advance", "probe.run", "probe.show", "new.connector", "new.tool", "new.skill", "new.migration", "feature-map.check", "feature-map.update", "gardener.run", "research.check", "bootstrap.identities"].includes(commandId) ? "built" : "specified",
  ownerSchemas: ["help", "version", "status", "doctor", "stack.up", "stack.down", "clock.show", "clock.freeze", "clock.resume", "clock.advance", "probe.run", "probe.show", "new.connector", "new.tool", "new.skill", "new.migration", "feature-map.check", "feature-map.update", "gardener.run", "research.check", "bootstrap.identities"].includes(commandId) ? "registered" : "pending",
  inputSchemaId: `urn:toy:contracts:v1:CliInputV1:${commandId}`,
  outputSchemaId: `urn:toy:contracts:v1:CliResultV1:${commandId}`,
  dataSchemaId: `urn:toy:contracts:v1:CliDataV1:${commandId}`,
  featureIds: [`control.${commandId}`], requirementIds: ["0.17"], arguments: args
});

export const cliDeclarations = [
  declaration("help", "contracts", "CliHelpV1", "read", "R0", [arg("group", "registered", false, true)]),
  declaration("version", "contracts", "CliVersionV1", "read", "R0", []),
  declaration("status", "ops", "OpsControlRead.status", "read", "R0", [release()]),
  declaration("research.check", "self-improvement", "EngineeringControl.checkResearch", "read", "R0", [release()]),
  declaration("bootstrap.identities", "ops", "RoleIdentityBootstrap.run", "human", "R0", [flag("plan"), flag("verify"), request(), arg("expected-snapshot", "SHA256")]),
  declaration("doctor", "ops", "OpsControlRead.doctor", "read", "R0", [release(), flag("deep")]),
  declaration("capture", "obligations", "Obligations.capture", "guarded", "R1", [input()]),
  declaration("due", "obligations", "Obligations.due", "read", "R1", [choice("view", ["due", "open", "waiting", "upcoming", "resolved"]), choice("owner", ["johan", "toy", "all"]), arg("through", "Instant"), ...page()]),
  declaration("obligations.show", "obligations", "Obligations.due", "read", "R1", [id("commitment-id")]),
  declaration("obligations.resolve", "obligations", "Obligations.resolve", "guarded", "R1", [id("commitment-id"), input()]),
  declaration("obligations.defer", "obligations", "Obligations.defer", "guarded", "R1", [id("commitment-id"), input()]),
  declaration("obligations.satisfy", "obligations", "Obligations.satisfy", "guarded", "R1", [id("dependency-id"), input()]),
  declaration("attention.snapshot", "attention", "AttentionRead.snapshot", "read", "R1", []),
  declaration("attention.preview", "attention", "AttentionControlRead.preview", "read", "R1", [arg("commitment", "UUID", true), arg("at", "Instant"), arg("horizon", "Duration")]),
  declaration("attention.simulate-ack", "attention", "TestIngressControl.ack", "test", "R1", [input(), arg("human-fixture", "registered")]),
  declaration("authority.pending", "authority", "AuthorityControlRead.pending", "read", "R1", page()),
  declaration("authority.outbox", "authority", "AuthorityControlRead.outbox", "read", "R1", [arg("action", "UUID"), arg("state", "registered"), ...page()]),
  declaration("authority.status", "authority", "Authority.status", "read", "R1", [id("action-id")]),
  declaration("authority.receipts", "authority", "Authority.receipts", "read", "R1", [id("action-id")]),
  declaration("authority.review", "authority", "AuthorityControlRead.reviewLink", "read", "R1", [id("card-id"), flag("open")]),
  declaration("sources.health", "sources", "Sources.inventory", "read", "R1", [arg("source-id", "UUID", false, true)]),
  declaration("sources.sync.now", "sources", "Sources.sync", "guarded", "R1", [id("source-id"), request(), choice("mode", ["incremental", "reconcile", "backfill"]), arg("budget-ms", "integer", false, false, [], 1000, 120000), wait()]),
  declaration("sources.cursor", "sources", "SourcesControlRead.cursor", "read", "R1", [id("source-id"), arg("partition", "UUID")]),
  declaration("life.search", "lifestore", "LifeStore.search", "read", "R2", [arg("query", "text", true, true, [], 1, 512), choice("mode", ["web", "literal"]), arg("filters-input", "input"), ...page(50)]),
  declaration("life.timeline", "lifestore", "LifeStore.timeline", "read", "R2", [...range(true), choice("time-basis", ["event", "recorded"]), choice("granularity", ["raw", "hour", "day"]), choice("order", ["asc", "desc"]), arg("filters-input", "input"), ...page(200)]),
  declaration("life.get", "lifestore", "LifeStore.get", "read", "R2", [arg("life-ref", "life-ref", true, true), arg("document", "UUID"), arg("start-byte", "integer", false, false, [], 0), arg("end-byte", "integer", false, false, [], 0)]),
  declaration("review.slots", "self-improvement", "RunControlRead.slots", "read", "R1", [...range(true), arg("job", "registered"), choice("state", cadenceSlotStateSchema.options), ...page()]),
  declaration("review.runs", "self-improvement", "RunControlRead.runs", "read", "R1", [arg("slot", "UUID"), ...range(false), ...page()]),
  declaration("review.verdicts", "self-improvement", "TurnReview.get", "read", "R1", [id("run-id")]),
  declaration("review.request", "self-improvement", "TurnReview.review", "guarded", "R1", [id("run-id"), request(), wait()]),
  declaration("trace", "self-improvement", "RunControlRead.trace", "read", "R1", [id("run-id"), arg("after-sequence", "UInt64String"), arg("limit", "integer", false, false, [], 1, 100)]),
  declaration("evidence", "self-improvement", "RunControlRead.evidence", "read", "R1", [id("run-id"), arg("criterion", "registered"), ...page()]),
  declaration("replay", "self-improvement", "ReplayEnvironment.reproduce", "test", "R1", [id("run-id"), request(), arg("artifact", "SHA256"), arg("fixture", "registered"), wait()]),
  declaration("sim.run", "self-improvement", "SimControl.run", "test", "R1", [arg("scenario-id", "registered", true, true), request(), arg("artifact", "SHA256"), arg("seed", "UInt64String"), choice("user", ["scripted", "adaptive"]), choice("clock", ["exact_cadence", "projected_behavior"]), wait()]),
  declaration("sim.suite", "self-improvement", "SimControl.suite", "test", "R1", [arg("suite-id", "registered", true, true), request(), release(), arg("artifact", "SHA256"), wait()]),
  declaration("sim.show", "self-improvement", "SimControl.show", "test", "R1", [id("campaign-or-trial-id"), choice("section", ["summary", "transcript", "grades", "all"]), ...page()]),
  declaration("hands.status", "hands", "Hands.status", "read", "R2", [arg("session", "UUID")]),
  declaration("hands.smoke", "hands", "HandsSmokeControl.run", "test", "R2", [arg("kind", "enum", true, true, ["browser", "computer"]), request(), arg("fixture", "registered"), wait()]),
  declaration("clock.show", "ops", "TestClockControl.get", "test", "R0", []),
  declaration("clock.freeze", "ops", "TestClockControl.freeze", "test", "R0", [arg("at", "Instant", true), request()]),
  declaration("clock.advance", "ops", "TestClockControl.advance", "test", "R0", [arg("by", "Duration", true), request(), wait()]),
  declaration("clock.resume", "ops", "TestClockControl.resume", "test", "R0", [request()]),
  declaration("stack.up", "ops", "OpsTestStack.up", "test", "R0", [release(true), request(), arg("world", "registered"), choice("clock", ["fake", "real"]), choice("model", ["fake", "supported"]), choice("observed-pressure", ["normal"]), wait()]),
  declaration("stack.down", "ops", "OpsTestStack.down", "test", "R0", [request(), wait()]),
  declaration("probe.run", "self-improvement", "ReplayEnvironment.runRegisteredProbe", "test", "R0", [arg("at-id", "registered", true, true), request(), arg("case", "registered"), wait()]),
  declaration("probe.show", "self-improvement", "ReplayEnvironment.registeredProbeStatus", "test", "R0", [id("operation-id")]),
  declaration("new.connector", "self-improvement", "EngineeringControl.generate", "engineering", "R0", [arg("name", "name", true, true), arg("provider", "registered", true), flag("plan")]),
  declaration("new.tool", "self-improvement", "EngineeringControl.generate", "engineering", "R0", [arg("name", "name", true, true), arg("module", "enum", true, false, moduleIdSchema.options), arg("operation", "registered", true), flag("plan")]),
  declaration("new.skill", "self-improvement", "EngineeringControl.generate", "engineering", "R0", [arg("name", "name", true, true), arg("module", "enum", true, false, moduleIdSchema.options), flag("plan")]),
  declaration("new.migration", "self-improvement", "EngineeringControl.generate", "engineering", "R0", [arg("name", "name", true, true), arg("module", "enum", true, false, moduleIdSchema.options), flag("plan")]),
  declaration("feature-map.check", "self-improvement", "EngineeringControl.checkFeatureMap", "engineering", "R0", [release()]),
  declaration("feature-map.update", "self-improvement", "EngineeringControl.updateFeatureMap", "engineering", "R0", [flag("plan")]),
  declaration("gardener.run", "self-improvement", "EngineeringControl.garden", "engineering", "R0", [request(), choice("mode", ["scan", "fix"]), wait()]),
  declaration("release.status", "ops", "PublisherControlRead.status", "read", "R1", [arg("digest", "SHA256")]),
  declaration("release.rollback", "ops", "ReleaseHumanControl.prepareRollback", "human", "R1", [arg("target", "SHA256", true), arg("expected-current", "SHA256", true), arg("incident", "UUID", true), request(), wait()])
];

export const cliCommonArguments = [
  choice("env", ["prod", "test"]), arg("stack", "UUID"), flag("json"),
  arg("timeout-ms", "integer", false, false, [], 1000, 120000), flag("help"), flag("version")
];
export const cliCommandIdSchema = z.enum(cliDeclarations.map((entry) => entry.id));
export type CliCommandId = z.infer<typeof cliCommandIdSchema>;
export const registeredCapabilityIdSchema = z.enum(cliDeclarations.map((entry) => `control.${entry.id}` as const));
export type RegisteredCapabilityIdV1 = z.infer<typeof registeredCapabilityIdSchema>;
