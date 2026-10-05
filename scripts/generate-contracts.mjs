import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const mode = process.argv[2] === "--check" ? "check" : "write";
const sourceModule = resolve(root, "packages/contracts/dist/public.js");
const { schemaInventory, uint64Maximum } = await import(pathToFileURL(sourceModule).href);
const artifactManifest = JSON.parse(await readFile(resolve(root, "scripts/generated-artifacts.json"), "utf8"));
const jsonSchemaOptions = { target: "draft-2020-12", io: "output", unrepresentable: "throw" };

const uint64Pattern = (maximum) => {
  const alternatives = ["0"];
  if (maximum.length > 1) alternatives.push(`[1-9][0-9]{0,${maximum.length - 2}}`);
  let prefix = "";
  for (let index = 0; index < maximum.length; index += 1) {
    const digit = Number(maximum[index]);
    const remaining = maximum.length - index - 1;
    if (index > 0 && digit > 0) {
      const range = digit === 1 ? "0" : `[0-${digit - 1}]`;
      alternatives.push(`${prefix}${range}${remaining === 0 ? "" : `[0-9]{${remaining}}`}`);
    }
    prefix += maximum[index];
  }
  alternatives.push(maximum);
  return `^(?:${alternatives.join("|")})(?![\\s\\S])`;
};

const schemaName = (name) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const schemas = Object.entries(schemaInventory);
const schemaNames = schemas.map(([name]) => name);
if (schemaNames.length === 0 || new Set(schemaNames).size !== schemaNames.length) throw new Error("schemaInventory must have unique named schemas");
const validateCase = (name, value, valid) => {
  if (schemaInventory[name].safeParse(value).success !== valid) throw new Error(`Frozen primitive case failed for ${name}`);
};
validateCase("UUID", "550e8400-e29b-41d4-a716-446655440000", true);
validateCase("UUID", "550e8400-e29b-41d4-a716-446655440000\n", false);
validateCase("Instant", "2026-10-04T12:34:56.789Z", true);
validateCase("Instant", "2026-10-04T12:34:56.789Z\n", false);
validateCase("Digest", "a".repeat(64), true);
validateCase("Digest", `${"a".repeat(64)}\n`, false);
validateCase("Revision", "0", true);
validateCase("Revision", "5\n", false);
validateCase("UInt64String", "18446744073709551615", true);
validateCase("UInt64String", "18446744073709551616", false);
validateCase("UInt64String", "18446744073709551615\n", false);
validateCase("UInt64String", "01", false);
validateCase("UInt64String", "not-a-decimal", false);
validateCase("UInt64String", "Infinity", false);
validateCase("UInt64String", "-1", false);
const validateSupportedShape = (name, jsonSchema) => {
  if (jsonSchema.type !== "string" || ["properties", "items", "oneOf", "anyOf", "allOf", "not", "prefixItems"].some((key) => key in jsonSchema)) {
    throw new Error(`Unsupported schema shape for ${name}; extend DTO generation before adding this schema`);
  }
  if (name === "ModuleId") {
    if (!Array.isArray(jsonSchema.enum) || jsonSchema.enum.some((value) => typeof value !== "string")) throw new Error("ModuleId must remain a string enum");
  } else if ("enum" in jsonSchema) {
    throw new Error(`Unsupported enum schema shape for ${name}; extend DTO generation before adding this schema`);
  }
};
const exportedSchemaAccepts = (jsonSchema, value) => {
  if (typeof value !== "string") return false;
  if (jsonSchema.minLength !== undefined && value.length < jsonSchema.minLength) return false;
  if (jsonSchema.maxLength !== undefined && value.length > jsonSchema.maxLength) return false;
  if (Array.isArray(jsonSchema.enum) && !jsonSchema.enum.includes(value)) return false;
  return jsonSchema.pattern === undefined || new RegExp(jsonSchema.pattern).test(value);
};
const verifyExportedCases = (name, jsonSchema, values) => {
  for (const value of values) {
    const runtime = schemaInventory[name].safeParse(value).success;
    if (exportedSchemaAccepts(jsonSchema, value) !== runtime) throw new Error(`Generated JSON Schema case differs from public ${name} schema`);
  }
};
const jsonSchemaFor = (name, schema) => {
  const jsonSchema = name === "UInt64String"
    ? { ...schemaInventory.Revision.toJSONSchema(jsonSchemaOptions), pattern: uint64Pattern(uint64Maximum) }
    : schema.toJSONSchema(jsonSchemaOptions);
  validateSupportedShape(name, jsonSchema);
  return name === "UInt64String" ? { ...jsonSchema, pattern: uint64Pattern(uint64Maximum) } : jsonSchema;
};
const uint64Previous = (BigInt(uint64Maximum) - 1n).toString();
const uint64Next = (BigInt(uint64Maximum) + 1n).toString();
const jsonSchemaCases = {
  ModuleId: ["contracts", "unknown"],
  UUID: ["550e8400-e29b-41d4-a716-446655440000", "550e8400-e29b-41d4-a716-446655440000\n"],
  Digest: ["a".repeat(64), `${"a".repeat(64)}\n`],
  Instant: ["2026-10-04T12:34:56.789Z", "2026-10-04T12:34:56.789Z\n"],
  Revision: ["0", "5\n"],
  UInt64String: ["0", "1", uint64Previous, uint64Maximum, uint64Next, `${uint64Maximum}\n`, "01", "not-a-decimal", "Infinity", "-1"]
};
const tsLines = [
  "// @generated by scripts/generate-contracts.mjs",
  'import type { z } from "zod";',
  'import type { schemaInventory } from "../src/public.js";',
  ""
];
for (const [name] of schemas) tsLines.push(`export type ${name} = z.infer<typeof schemaInventory.${name}>;`);
tsLines.push("");

const moduleIds = schemaInventory.ModuleId.options;
const pythonNames = schemas.map(([name]) => name);
const pythonImportNames = [...pythonNames].sort((left, right) => Number(right === right.toUpperCase()) - Number(left === left.toUpperCase()) || left.toLowerCase().localeCompare(right.toLowerCase()));
const pythonLines = [
  "# @generated by scripts/generate-contracts.mjs",
  "from typing import Literal, NewType",
  "",
  "ModuleId = Literal[",
  ...moduleIds.map((value) => `    ${JSON.stringify(value)},`),
  "]"
];
for (const [name] of schemas) {
  if (name !== "ModuleId") pythonLines.push(`${name} = NewType(${JSON.stringify(name)}, str)`);
}
pythonLines.push("");
const pythonPackageLines = [
  "# @generated by scripts/generate-contracts.mjs",
  `from toy_contracts.generated import ${pythonImportNames.join(", ")}`,
  "",
  `__all__ = ${JSON.stringify(pythonNames)}`,
  ""
];

const swiftCase = (value) => {
  const parts = value.split("-");
  return parts.map((part, index) => index === 0 ? part : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join("");
};
const swiftLines = ["// @generated by scripts/generate-contracts.mjs", "public enum ModuleId: String, Codable, CaseIterable, Sendable {"];
for (const value of moduleIds) swiftLines.push(`    case ${swiftCase(value)} = ${JSON.stringify(value)}`);
swiftLines.push("}", "");
for (const [name] of schemas) {
  if (name !== "ModuleId") swiftLines.push(`public typealias ${name} = String`);
}
swiftLines.push("");

const outputs = new Map([
  ["packages/contracts/generated/types.ts", tsLines.join("\n")],
  ["python/toy_contracts/__init__.py", pythonPackageLines.join("\n")],
  ["python/toy_contracts/generated.py", pythonLines.join("\n")],
  ["swift/ToyContracts/Contracts.swift", swiftLines.join("\n")]
]);

for (const [name, schema] of schemas) {
  const jsonSchema = jsonSchemaFor(name, schema);
  verifyExportedCases(name, jsonSchema, jsonSchemaCases[name] ?? []);
  const artifact = {
    ...jsonSchema,
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `urn:toy:contracts:v1:${name}`,
    ...(name === "UInt64String" ? { pattern: uint64Pattern(uint64Maximum) } : {})
  };
  outputs.set(`packages/contracts/generated/schemas/${schemaName(name)}.schema.json`, `${JSON.stringify(artifact, null, 2)}\n`);
}

const codeOutputs = [...outputs.keys()].filter((path) => !path.endsWith(".schema.json")).sort();
if (artifactManifest.generator !== "scripts/generate-contracts.mjs" || JSON.stringify([...artifactManifest.codeArtifacts].sort()) !== JSON.stringify(codeOutputs)) {
  throw new Error("scripts/generated-artifacts.json does not match generated code artifacts");
}
const generatedRoot = resolve(root, "packages/contracts/generated");
const generatedFiles = [];
const scanGenerated = async (path) => {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) await scanGenerated(child);
    else generatedFiles.push(relative(root, child).replaceAll("\\", "/"));
  }
};
await scanGenerated(generatedRoot);
const generatedExpected = [...outputs.keys()].filter((path) => path.startsWith("packages/contracts/generated/")).sort();
const orphaned = generatedFiles.filter((path) => !generatedExpected.includes(path));
if (orphaned.length > 0) throw new Error(`Unexpected generated contract artifacts: ${orphaned.join(", ")}`);

const drift = [];
for (const [relativePath, expected] of outputs) {
  const path = resolve(root, relativePath);
  if (mode === "check") {
    let actual;
    try {
      actual = await readFile(path, "utf8");
    } catch {
      drift.push(`${relativePath}: missing generated artifact`);
      continue;
    }
    if (actual !== expected) drift.push(`${relativePath}: generated artifact drift`);
  } else {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, expected, "utf8");
  }
}

if (drift.length > 0) {
  process.stderr.write(`${drift.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${mode === "check" ? "Verified" : "Generated"} ${outputs.size} contract artifacts\n`);
}
