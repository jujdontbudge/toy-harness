import { primitiveSchemaInventory } from "./primitives.js";
import { cliSchemaInventory } from "./cli.js";

export * from "./primitives.js";
export * from "./cli.js";
export * from "./generated-bundle.js";

export const schemaInventory = { ...primitiveSchemaInventory, ...cliSchemaInventory };
