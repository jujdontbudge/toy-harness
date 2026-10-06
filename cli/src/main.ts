#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  cliCommandSchemas, cliCommonArguments, cliDeclarations, cliErrorMessages, cliFailureSchema, cliResultSchema,
  digestSchema, instantSchema, opsErrorExitCodes, opsTestStackResultSchema, schemaBundleDigest, uint64Schema, uuidSchema
} from "@toy/contracts";
import type { CliArgument, CliCommandId, CliDeclaration, CliEnvironment, CliFailure, CliResult, OpsError, OpsTestStackResultV1, RegisteredProbeOperationV1, Result } from "@toy/contracts";
import { BackupCapacityProbe, NativeReleaseEligibilityProbe, OpsControlRead, OpsTestStack, RoleIdentityBootstrap, TestClockControl } from "@toy/ops/public";
import { EngineeringControl, ReplayEnvironment } from "@toy/self-improvement/public";
import { HermesAuthProbe, ModelRoute, ModelRouteProbe } from "@toy/hermes/public";

const args = process.argv.slice(2);
const commonNames = new Set(cliCommonArguments.map((argument) => argument.name));
const declarations: CliDeclaration[] = cliDeclarations;
const invocationId = randomUUID();
const jsonRequested = args.includes("--json") || args.some((argument) => argument.startsWith("--json="));
let commandId: CliCommandId = "help";
let environment: CliEnvironment = { kind: "prod", instanceId: null, stackId: null };

const envelope = (exitCode: number) => ({
  schemaVersion: "toy.cli.v1", commandId, invocationId, generatedAt: new Date().toISOString(),
  cliVersion: "1.0.0", contractsVersion: "1.0.0", schemaDigest: schemaBundleDigest, environment,
  meta: { exitCode, releaseDigest: null, controlDigest: null, evaluatedAt: null, operationId: null, effectState: "none", recordRefs: [], evidence: [] }
});
const failure = (code: CliFailure["error"]["code"], exitCode: number, module: CliFailure["error"]["module"] = "contracts"): CliFailure => {
  return cliFailureSchema.parse({ ...envelope(exitCode), ok: false, error: {
    module, code, message: cliErrorMessages[code], retryable: false, retryAt: null, effectState: "none",
    currentRevision: null, currentGeneration: null, operationRef: null, requiredInteraction: null
  } });
};
const ownerFailure = (error: OpsError): CliFailure => {
  const result = failure(error.code, opsErrorExitCodes[error.code], error.module);
  return cliFailureSchema.parse({ ...result, meta: { ...result.meta, effectState: error.effectState ?? "none" }, error: { ...result.error, ...error } });
};

const validArgument = (argument: CliArgument, value: string | boolean): boolean => {
  if (argument.kind === "boolean") return value === true;
  if (typeof value !== "string") return false;
  switch (argument.kind) {
    case "UUID": return uuidSchema.safeParse(value).success;
    case "Instant": return instantSchema.safeParse(value).success;
    case "UInt64String": return uint64Schema.safeParse(value).success;
    case "SHA256": return digestSchema.safeParse(value).success;
    case "enum": return argument.values.includes(value);
    case "integer": {
      if (!/^(?:0|[1-9][0-9]*)(?![\s\S])/.test(value)) return false;
      const integer = Number(value);
      return Number.isSafeInteger(integer) && (argument.minimum === null || integer >= argument.minimum)
        && (argument.maximum === null || integer <= argument.maximum);
    }
    case "Duration": return /^P(?=\d|T\d)(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d{1,3})?S)?)?(?![\s\S])/.test(value);
    case "registered": return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}(?![\s\S])/.test(value);
    case "name": return /^[a-z][a-z0-9-]{0,63}(?![\s\S])/.test(value);
    case "life-ref": return /^life:\/\/(?:observation|entity|fact|aggregate|conflict)\/[A-Za-z0-9._:-]{1,128}(?![\s\S])/.test(value);
    case "input": return value.length > 0 && value.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value);
    case "text": return value.length >= (argument.minimum ?? 1) && value.length <= (argument.maximum ?? 2000);
  }
};

const run = async (): Promise<CliResult> => {
  const options: Record<string, { type: "string" | "boolean" }> = {};
  for (const argument of [...cliCommonArguments, ...declarations.flatMap((entry) => entry.arguments)]) {
    if (!argument.positional) options[argument.name] = { type: argument.kind === "boolean" ? "boolean" : "string" };
  }
  let parsed;
  try {
    parsed = parseArgs({ args, options, strict: true, tokens: true, allowPositionals: true });
  } catch {
    return failure("INVALID_INPUT", 2);
  }
  const values = new Map<string, string | boolean>();
  for (const token of parsed.tokens) {
    if (token.kind !== "option") continue;
    if (values.has(token.name)) return failure("INVALID_INPUT", 2);
    values.set(token.name, token.value ?? true);
  }
  for (const argument of cliCommonArguments) {
    const value = values.get(argument.name);
    if (value !== undefined && !validArgument(argument, value)) return failure("INVALID_INPUT", 2);
  }
  const kind = values.get("env") === "test" ? "test" : "prod";
  const stack = values.get("stack");
  environment = { kind, instanceId: null, stackId: typeof stack === "string" ? stack : null };
  if (kind === "prod" && stack !== undefined) return failure("INVALID_INPUT", 2);
  if (values.has("help") && values.has("version")) return failure("INVALID_INPUT", 2);

  const positionals = parsed.positionals;
  const groupPath = positionals.join(".");
  const bareGroup = groupPath.length > 0 && declarations.some((entry) => entry.id.startsWith(groupPath + "."));
  const wantsHelp = values.has("help") || positionals[0] === "help" || bareGroup || positionals.length === 0 && !values.has("version");
  const wantsVersion = values.has("version") || positionals[0] === "version";
  if (wantsHelp && wantsVersion) return failure("INVALID_INPUT", 2);
  if (wantsHelp) {
    const group = (positionals[0] === "help" ? positionals.slice(1) : positionals).join(".");
    if ([...values.keys()].some((key) => !commonNames.has(key))) return failure("INVALID_INPUT", 2);
    const commands = group === "" ? declarations : declarations.filter((entry) => entry.id === group || entry.id.startsWith(group + "."));
    if (commands.length === 0) return failure("INVALID_INPUT", 2);
    cliCommandSchemas.help.input.parse({ group: group || null });
    commandId = "help";
    return cliCommandSchemas.help.result.parse({ ...envelope(0), ok: true, data: {
      group: group || null, commands, commonArguments: cliCommonArguments, schemaDigest: schemaBundleDigest,
      compatibility: { wireVersions: ["toy.cli.v1"], nodeVersion: "24.21.0" }
    } });
  }
  if (wantsVersion) {
    if (positionals.length > (positionals[0] === "version" ? 1 : 0) || [...values.keys()].some((key) => !commonNames.has(key))) return failure("INVALID_INPUT", 2);
    commandId = "version";
    cliCommandSchemas.version.input.parse({});
    const executable = await readFile(new URL("./main.js", import.meta.url));
    const metadata = await readFile(new URL("../package.json", import.meta.url));
    const executableDigest = createHash("sha256").update(executable).digest("hex");
    const packageDigest = createHash("sha256").update(JSON.stringify([
      { path: "dist/main.js", digest: executableDigest },
      { path: "package.json", digest: createHash("sha256").update(metadata).digest("hex") }
    ])).digest("hex");
    return cliCommandSchemas.version.result.parse({ ...envelope(0), ok: true, data: {
      cliVersion: "1.0.0", contractsVersion: "1.0.0", executableDigest, packageDigest, schemaDigest: schemaBundleDigest,
      compatibility: { wireVersions: ["toy.cli.v1"], nodeVersion: "24.21.0" }
    } });
  }
  const declaration = [...cliDeclarations].sort((left, right) => right.id.split(".").length - left.id.split(".").length)
    .find((entry) => entry.id.split(".").every((part, index) => positionals[index] === part));
  if (!declaration) return failure("INVALID_INPUT", 2);
  commandId = declaration.id;
  const positionalArguments = declaration.arguments.filter((argument) => argument.positional);
  const operands = positionals.slice(declaration.id.split(".").length);
  if (operands.length > positionalArguments.length) return failure("INVALID_INPUT", 2);
  for (const [index, argument] of positionalArguments.entries()) {
    const value = operands[index];
    if (value === undefined ? argument.required : !validArgument(argument, value)) return failure("INVALID_INPUT", 2);
  }
  const allowed = new Set([...commonNames, ...declaration.arguments.filter((argument) => !argument.positional).map((argument) => argument.name)]);
  if ([...values.keys()].some((key) => !allowed.has(key))) return failure("INVALID_INPUT", 2);
  for (const argument of declaration.arguments.filter((entry) => !entry.positional)) {
    const value = values.get(argument.name);
    if (value === undefined ? argument.required : !validArgument(argument, value)) return failure("INVALID_INPUT", 2);
  }
  if (declaration.access === "test" && kind === "prod" || commandId === "attention.preview" && values.has("at") && kind === "prod") return failure("TEST_ONLY", 3, declaration.owner);
  if (commandId === "stack.up" && stack !== undefined) return failure("INVALID_INPUT", 2);
  if (kind === "test" && commandId !== "stack.up" && stack === undefined) return failure("INVALID_INPUT", 2);
  const requestId = values.get("request-id");
  const waitMs = Number(values.get("wait-ms") ?? 0);
  const upInput = commandId === "stack.up" ? cliCommandSchemas["stack.up"].input.safeParse({
    release: values.get("release"), requestId, world: values.get("world"), clock: values.get("clock") ?? "fake", model: values.get("model") ?? "fake", waitMs, observedPressure: values.get("observed-pressure")
  }) : null;
  const downInput = commandId === "stack.down" ? cliCommandSchemas["stack.down"].input.safeParse({ requestId, waitMs }) : null;
  if (upInput && !upInput.success || downInput && !downInput.success) return failure("INVALID_INPUT", 2);
  if (commandId === "clock.show" && !cliCommandSchemas["clock.show"].input.safeParse({}).success) return failure("INVALID_INPUT", 2);
  if (commandId === "clock.freeze" && !cliCommandSchemas["clock.freeze"].input.safeParse({ at: values.get("at"), requestId }).success) return failure("INVALID_INPUT", 2);
  if (commandId === "clock.resume" && !cliCommandSchemas["clock.resume"].input.safeParse({ requestId }).success) return failure("INVALID_INPUT", 2);
  if (commandId === "clock.advance" && !cliCommandSchemas["clock.advance"].input.safeParse({ by: values.get("by"), requestId, waitMs }).success) return failure("INVALID_INPUT", 2);
  if (commandId === "probe.run" && !cliCommandSchemas["probe.run"].input.safeParse({ probeId: operands[0], requestId, caseId: values.get("case") }).success) return failure("INVALID_INPUT", 2);
  if (commandId === "probe.show" && !cliCommandSchemas["probe.show"].input.safeParse({ operationId: operands[0] }).success) return failure("INVALID_INPUT", 2);
  const context = { environment, invocationId, timeoutMs: Number(values.get("timeout-ms") ?? 30000) };
  if (commandId === "bootstrap.identities") {
    const input = cliCommandSchemas[commandId].input.safeParse({ plan: values.has("plan"), verify: values.has("verify"), requestId, expectedSnapshotDigest: values.get("expected-snapshot") ?? null });
    if (!input.success) return failure("INVALID_INPUT", 2);
    const result = RoleIdentityBootstrap.run(input.data, context);
    if (!result.ok) return ownerFailure(result.error);
    const exitCode = result.data.state === "created" || result.data.state === "planned" || result.data.state === "verified" ? 0 : result.data.state === "partial" ? 1 : 5;
    const base = envelope(exitCode);
    return cliCommandSchemas[commandId].result.parse({ ...base, commandId, ok: true, data: result.data, meta: { ...base.meta, effectState: result.data.effectState, evaluatedAt: result.data.observedAt } });
  }
  if (commandId === "new.connector" || commandId === "new.tool" || commandId === "new.skill" || commandId === "new.migration") {
    const input = cliCommandSchemas[commandId].input.safeParse({ kind: commandId.slice(4), name: operands[0], owner: values.get("module") ?? "sources", provider: values.get("provider") ?? null, operation: values.get("operation") ?? null, plan: values.has("plan") });
    if (!input.success) return failure("INVALID_INPUT", 2);
    const result = EngineeringControl.generate(input.data, context);
    if (!result.ok) return ownerFailure(result.error);
    return cliCommandSchemas[commandId].result.parse({ ...envelope(0), commandId, ok: true, data: result.data });
  }
  if (commandId === "research.check") {
    const result = EngineeringControl.checkResearch(cliCommandSchemas[commandId].input.parse({ release: values.get("release") ?? null }), context);
    if (!result.ok) return ownerFailure(result.error);
    return cliCommandSchemas[commandId].result.parse({ ...envelope(5), commandId, ok: true, data: result.data });
  }
  if (commandId === "feature-map.check") {
    const result = EngineeringControl.checkFeatureMap(cliCommandSchemas[commandId].input.parse({ release: values.get("release") ?? null }), context);
    if (!result.ok) return ownerFailure(result.error);
    return cliCommandSchemas[commandId].result.parse({ ...envelope(result.data.state === "PASS" ? 0 : 1), commandId, ok: true, data: result.data });
  }
  if (commandId === "feature-map.update") {
    const result = EngineeringControl.updateFeatureMap(cliCommandSchemas[commandId].input.parse({ plan: values.has("plan") }), context);
    if (!result.ok) return ownerFailure(result.error);
    return cliCommandSchemas[commandId].result.parse({ ...envelope(0), commandId, ok: true, data: result.data });
  }
  if (commandId === "gardener.run") {
    const result = EngineeringControl.garden(cliCommandSchemas[commandId].input.parse({ requestId, mode: values.get("mode") ?? "scan", waitMs }), context);
    if (!result.ok) return ownerFailure(result.error);
    return cliCommandSchemas[commandId].result.parse({ ...envelope(result.data.state === "PASS" ? 0 : 1), commandId, ok: true, data: result.data });
  }
  if (commandId === "stack.up" || commandId === "stack.down") {
    let response: OpsTestStackResultV1;
    if (commandId === "stack.up") {
      if (!upInput?.success) return failure("INVALID_INPUT", 2);
      response = await OpsTestStack.up(upInput.data, context);
    } else {
      if (!downInput?.success) return failure("INVALID_INPUT", 2);
      response = await OpsTestStack.down(downInput.data, context);
    }
    const validated = opsTestStackResultSchema.safeParse(response);
    if (!validated.success) return failure("OUTPUT_INVALID", 8, "ops");
    if (!validated.data.ok) return ownerFailure(validated.data.error);
    const data = validated.data.data;
    const exitCode = data.result?.components.some((check) => check.state === "FAIL") ? 1
      : data.operation.state === "queued" || data.operation.state === "running" || data.result?.ready || data.result?.teardown?.complete ? 0 : 5;
    if (data.stackId !== null) environment = { ...environment, stackId: data.stackId };
    const base = envelope(exitCode);
    return cliCommandSchemas[commandId].result.parse({
      ...base, ok: true, data, meta: { ...base.meta, effectState: exitCode === 0 && data.operation.state === "succeeded" ? "confirmed" : "none", operationId: data.operation.operationId, recordRefs: data.links.recordRefs, evidence: data.links.observations }
    });
  }
  if (commandId.startsWith("clock.") || commandId.startsWith("probe.")) {
    if (commandId === "clock.show") {
      const result = TestClockControl.get(context);
      if (!result.ok) return ownerFailure(result.error);
      return cliCommandSchemas["clock.show"].result.parse({ ...envelope(0), commandId, ok: true, data: result.data, meta: { ...envelope(0).meta, effectState: commandId === "clock.show" ? "none" : "confirmed" } });
    }
    if (commandId === "clock.freeze") {
      const result = TestClockControl.freeze(cliCommandSchemas["clock.freeze"].input.parse({ at: values.get("at"), requestId }), context);
      if (!result.ok) return ownerFailure(result.error);
      return cliCommandSchemas["clock.freeze"].result.parse({ ...envelope(0), commandId, ok: true, data: result.data, meta: { ...envelope(0).meta, effectState: "confirmed" } });
    }
    if (commandId === "clock.resume") {
      const result = TestClockControl.resume(cliCommandSchemas["clock.resume"].input.parse({ requestId }), context);
      if (!result.ok) return ownerFailure(result.error);
      return cliCommandSchemas["clock.resume"].result.parse({ ...envelope(0), commandId, ok: true, data: result.data, meta: { ...envelope(0).meta, effectState: "confirmed" } });
    }
    if (commandId === "clock.advance") {
      const result = TestClockControl.advance(cliCommandSchemas["clock.advance"].input.parse({ by: values.get("by"), requestId, waitMs }), context);
      if (!result.ok) return ownerFailure(result.error);
      return cliCommandSchemas["clock.advance"].result.parse({ ...envelope(0), commandId, ok: true, data: result.data, meta: { ...envelope(0).meta, effectState: "confirmed" } });
    }
    if (commandId === "probe.run" || commandId === "probe.show") {
      const probeInput = commandId === "probe.run" ? cliCommandSchemas["probe.run"].input.parse({ probeId: operands[0], requestId, caseId: values.get("case") }) : null;
      let result: Result<RegisteredProbeOperationV1>;
      if (probeInput?.caseId === "backup-capacity") result = BackupCapacityProbe.run(probeInput, context);
      else if (probeInput?.caseId === "native-release-eligibility") result = NativeReleaseEligibilityProbe.run(probeInput, context);
      else if (probeInput?.caseId === "native-auth-cli") result = await HermesAuthProbe.run(probeInput, context);
      else if (probeInput?.caseId === "model-route-policy" || probeInput?.caseId === "model-route-stream") result = await ModelRouteProbe.run(probeInput, context);
      else if (probeInput) result = await ReplayEnvironment.runRegisteredProbe(probeInput, context);
      else result = ReplayEnvironment.registeredProbeStatus(cliCommandSchemas["probe.show"].input.parse({ operationId: operands[0] }), context);
      if (!result.ok) return ownerFailure(result.error);
      const exitCode = result.data.result?.cases.some(check => check.state === "FAIL") ? 1 : result.data.operation.state === "succeeded" ? 0 : 5;
      return cliCommandSchemas[commandId].result.parse({ ...envelope(exitCode), commandId, ok: true, data: result.data, meta: { ...envelope(exitCode).meta, effectState: commandId === "probe.run" ? "confirmed" : "none" } });
    }
  }
  if (commandId === "status" || commandId === "doctor") {
    if (kind === "test") {
      const inspected = OpsTestStack.inspect(context);
      if (!inspected.ok) return ownerFailure(inspected.error);
    }
    const selectedRelease = values.get("release");
    const releaseInput = selectedRelease === undefined ? {} : { release: selectedRelease };
    if (commandId === "status") {
      const data = await OpsControlRead.status(cliCommandSchemas.status.input.parse(releaseInput), context);
      const exitCode = data.probes.some((probe) => probe.state === "FAIL") ? 1 : data.complete ? 0 : 5;
      return cliCommandSchemas.status.result.parse({ ...envelope(exitCode), ok: true, data });
    }
    const data = await OpsControlRead.doctor(cliCommandSchemas.doctor.input.parse({ ...releaseInput, deep: values.has("deep") }), context, values.has("deep") ? [ModelRoute.inspect()] : []);
    const exitCode = data.verdict === "FAIL" ? 1 : data.complete && data.verdict === "PASS" ? 0 : 5;
    return cliCommandSchemas.doctor.result.parse({ ...envelope(exitCode), ok: true, data });
  }
  const unavailable = commandId.startsWith("stack.") || commandId.startsWith("clock.") || commandId.startsWith("probe.");
  return failure(unavailable ? "DEPENDENCY_UNAVAILABLE" : "NOT_IMPLEMENTED", 5, declaration.owner);
};

const escapeTerminal = (value: string): string => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, (character) => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"));
const renderHuman = (result: CliResult): string => {
  if (!result.ok) return `${result.environment.kind}: ${result.error.code}: ${result.error.message}\n`;
  if (result.commandId === "version") return `Toy ${result.data.cliVersion} / contracts ${result.data.contractsVersion}\nExecutable ${result.data.executableDigest}\nPackage ${result.data.packageDigest}\nSchemas ${result.data.schemaDigest}\n`;
  if (result.commandId === "status") return `${result.environment.kind}: ${result.data.requiredRelease}; coverage ${result.data.complete ? "complete" : "incomplete"}\n` + JSON.stringify(result.data, null, 2) + "\n";
  if (result.commandId === "doctor") return `${result.environment.kind}: ${result.data.requiredRelease}; ${result.data.verdict}; coverage ${result.data.complete ? "complete" : "incomplete"}\n` + JSON.stringify(result.data, null, 2) + "\n";
  if (result.commandId !== "help") return `${result.environment.kind}: ${result.commandId}\n` + JSON.stringify(result.data, null, 2) + "\n";
  const lines = ["Toy command inventory", "Usage: toy [--env prod|test] [--stack UUID] [--json] [--timeout-ms N] <command> [arguments]", "Common: --help; --version; --env defaults prod; --timeout-ms defaults 30000 (1000–120000)", ""];
  for (const entry of result.data.commands) {
    const operands = entry.arguments.map((argument) => {
      const value = `${argument.positional ? "" : "--"}${argument.name}${argument.kind === "boolean" ? "" : " <" + (argument.values.length > 0 ? argument.values.join("|") : argument.kind) + ">"}`;
      return argument.required ? value : "[" + value + "]";
    }).join(" ");
    lines.push(`${entry.id.replaceAll(".", " ")} ${operands}`, `  ${entry.owner} / ${entry.operation}; ${entry.access}; ${entry.firstRelease}; ${entry.implementation}; schemas ${entry.ownerSchemas}`, `  ${entry.inputSchemaId}`, `  ${entry.dataSchemaId}`, `  ${entry.outputSchemaId}`);
  }
  return lines.join("\n") + "\n";
};

let result: CliResult;
try {
  result = cliResultSchema.parse(await run());
} catch {
  result = failure("INTERNAL_ERROR", 8);
}
const render = (value: CliResult): string => jsonRequested ? JSON.stringify(value) + "\n" : escapeTerminal(renderHuman(value));
let output = render(result);
if (Buffer.byteLength(output, "utf8") > 2 * 1024 * 1024) {
  result = failure("OUTPUT_INVALID", 8);
  output = render(result);
}
process.stdout.write(output);
process.exitCode = result.meta.exitCode;
