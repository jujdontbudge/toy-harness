#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  cliCommandSchemas, cliCommonArguments, cliDeclarations, cliFailureSchema, cliResultSchema, cliSafeMessages,
  digestSchema, instantSchema, schemaBundleDigest, uint64Schema, uuidSchema
} from "@toy/contracts";
import type { CliArgument, CliCommandId, CliDeclaration, CliEnvironment, CliFailure, CliResult } from "@toy/contracts";

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
  const messages = {
    INVALID_INPUT: cliSafeMessages[0], TEST_ONLY: cliSafeMessages[1], UNAUTHORIZED: cliSafeMessages[2],
    NOT_IMPLEMENTED: cliSafeMessages[3], DEPENDENCY_UNAVAILABLE: cliSafeMessages[4], ATTESTATION_INVALID: cliSafeMessages[5],
    INTERNAL_ERROR: cliSafeMessages[6], OUTPUT_INVALID: cliSafeMessages[7]
  };
  return cliFailureSchema.parse({ ...envelope(exitCode), ok: false, error: {
    module, code, message: messages[code], retryable: false, retryAt: null, effectState: "none",
    currentRevision: null, currentGeneration: null, operationRef: null, requiredInteraction: null
  } });
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
  const unavailable = commandId.startsWith("stack.") || commandId.startsWith("clock.") || commandId.startsWith("probe.");
  return failure(unavailable ? "DEPENDENCY_UNAVAILABLE" : "NOT_IMPLEMENTED", 5, declaration.owner);
};

const escapeTerminal = (value: string): string => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, (character) => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"));
const renderHuman = (result: CliResult): string => {
  if (!result.ok) return `${result.environment.kind}: ${result.error.code}: ${result.error.message}\n`;
  if (result.commandId === "version") return `Toy ${result.data.cliVersion} / contracts ${result.data.contractsVersion}\nExecutable ${result.data.executableDigest}\nPackage ${result.data.packageDigest}\nSchemas ${result.data.schemaDigest}\n`;
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
process.stdout.write(jsonRequested ? JSON.stringify(result) + "\n" : escapeTerminal(renderHuman(result)));
process.exitCode = result.meta.exitCode;
