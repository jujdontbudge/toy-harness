import { primitiveSchemaInventory } from "./primitives.js";
import { cliSchemaInventory } from "./cli.js";
import { controlEvidenceSchemaInventory } from "./control-evidence.js";
import { sourceSchemaInventory } from "./sources.js";
import { opsRegistrySchemaInventory } from "./ops-registry.js";
import { opsSchemaInventory } from "./ops.js";
import { attentionSchemaInventory } from "./attention.js";
import { publisherSchemaInventory } from "./publisher.js";

export * from "./primitives.js";
export * from "./cli.js";
export * from "./generated-bundle.js";
export * from "./control-evidence.js";
export * from "./sources.js";
export * from "./ops-registry.js";
export * from "./ops.js";
export * from "./attention.js";
export * from "./publisher.js";

export const schemaInventory = { ...primitiveSchemaInventory, ...cliSchemaInventory, ...controlEvidenceSchemaInventory, ...sourceSchemaInventory, ...opsRegistrySchemaInventory, ...opsSchemaInventory, ...attentionSchemaInventory, ...publisherSchemaInventory };
