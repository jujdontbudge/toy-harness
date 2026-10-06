import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Ajv2020, ValidateFunction } from "ajv/dist/2020.js";
import { schemaBundleArtifacts } from "../../generated-bundle.js";
import { instantSchema, uuidSchema } from "../../primitives.js";
import type { obligationToolParameters } from "./tool-schemas.mjs";

const dialect = "https://json-schema.org/draft/2020-12/schema";
const filenames = {
  toy_capture: "toy-capture-parameters-v1.schema.json",
  toy_due: "toy-due-parameters-v1.schema.json",
  toy_resolve: "toy-resolve-parameters-v1.schema.json",
  toy_defer: "toy-defer-parameters-v1.schema.json",
  toy_satisfy: "toy-satisfy-parameters-v1.schema.json"
} satisfies Record<keyof typeof obligationToolParameters, string>;
let ajv: Ajv2020 | undefined;
const validatorOwner = async (): Promise<Ajv2020> => {
  if (ajv !== undefined) return ajv;
  const { Ajv2020 } = await import("ajv/dist/2020.js");
  ajv = new Ajv2020({ coerceTypes: false, removeAdditional: false, useDefaults: false });
  ajv.addFormat("uuid", { type: "string", validate: (value: string) => uuidSchema.safeParse(value).success });
  ajv.addFormat("date-time", { type: "string", validate: (value: string) => instantSchema.safeParse(value).success });
  return ajv;
};
const validators = new Map<keyof typeof obligationToolParameters, ValidateFunction<unknown>>();

const readSchema = (tool: keyof typeof obligationToolParameters): object & { $schema: string } => {
  const filename = filenames[tool];
  const bytes = readFileSync(resolve(import.meta.dirname, "../../../generated/schemas", filename));
  const artifact = schemaBundleArtifacts.find((entry) => entry.path === "packages/contracts/generated/schemas/" + filename);
  if (artifact === undefined || createHash("sha256").update(bytes).digest("hex") !== artifact.digest) throw new Error("OBLIGATION_TOOL_SCHEMA_CHANGED");
  const schema: unknown = JSON.parse(bytes.toString("utf8"));
  if (typeof schema !== "object" || schema === null || Array.isArray(schema) || !("$schema" in schema) || schema.$schema !== dialect) throw new Error("OBLIGATION_TOOL_SCHEMA_DIALECT_MISMATCH");
  return { ...schema, $schema: dialect };
};

export const obligationToolSchemaDialect = (tool: keyof typeof obligationToolParameters): string => readSchema(tool).$schema;

export const validateObligationToolParameters = async (tool: keyof typeof obligationToolParameters, value: unknown): Promise<boolean> => {
  const schema = readSchema(tool);
  let validator = validators.get(tool);
  if (validator === undefined) {
    validator = (await validatorOwner()).compile<unknown>(schema);
    validators.set(tool, validator);
  }
  return validator(value);
};
