import { primitiveSchemaInventory } from "./primitives.js";
import { cliSchemaInventory } from "./cli.js";
import { controlEvidenceSchemaInventory } from "./control-evidence.js";
import { sourceSchemaInventory } from "./sources.js";
import { opsRegistrySchemaInventory } from "./ops-registry.js";
import { opsSchemaInventory } from "./ops.js";
import { attentionSchemaInventory } from "./attention.js";
import { publisherSchemaInventory } from "./publisher.js";
import { testControlSchemaInventory } from "./test-control.js";
import { bootstrapReferenceSchemaInventory } from "./bootstrap-references.js";
import { modelRouteSchemaInventory } from "./model-route.js";
import { engineeringSchemaInventory } from "./engineering-control.js";
import { identityBootstrapSchemaInventory } from "./identity-bootstrap.js";
import { modelAdmissionSchemaInventory } from "./model-admission.js";
import { nativeReleaseEligibilitySchemaInventory } from "./native-release-eligibility.js";
import { hermesRuntimeSchemaInventory } from "./hermes-runtime.js";
import { backupCapacitySchemaInventory } from "./backup-capacity.js";

export * from "./primitives.js";
export * from "./cli.js";
export * from "./generated-bundle.js";
export * from "./control-evidence.js";
export * from "./sources.js";
export * from "./ops-registry.js";
export * from "./ops.js";
export * from "./attention.js";
export * from "./publisher.js";
export * from "./test-control.js";
export * from "./bootstrap-references.js";
export * from "./engineering-control.js";
export * from "./model-route.js";
export * from "./identity-bootstrap.js";
export * from "./model-admission.js";
export * from "./native-release-eligibility.js";
export * from "./hermes-runtime.js";
export * from "./backup-capacity.js";

type SchemaInventory = typeof primitiveSchemaInventory & typeof cliSchemaInventory & typeof controlEvidenceSchemaInventory
  & typeof sourceSchemaInventory & typeof opsRegistrySchemaInventory & typeof opsSchemaInventory & typeof backupCapacitySchemaInventory
  & typeof attentionSchemaInventory & typeof publisherSchemaInventory & typeof testControlSchemaInventory & typeof bootstrapReferenceSchemaInventory & typeof engineeringSchemaInventory & typeof modelRouteSchemaInventory & typeof identityBootstrapSchemaInventory & typeof modelAdmissionSchemaInventory & typeof nativeReleaseEligibilitySchemaInventory & typeof hermesRuntimeSchemaInventory;
export const schemaInventory: SchemaInventory = { ...primitiveSchemaInventory, ...cliSchemaInventory, ...controlEvidenceSchemaInventory, ...sourceSchemaInventory, ...opsRegistrySchemaInventory, ...opsSchemaInventory, ...attentionSchemaInventory, ...publisherSchemaInventory, ...testControlSchemaInventory, ...bootstrapReferenceSchemaInventory, ...engineeringSchemaInventory, ...modelRouteSchemaInventory, ...identityBootstrapSchemaInventory, ...modelAdmissionSchemaInventory, ...nativeReleaseEligibilitySchemaInventory, ...hermesRuntimeSchemaInventory, ...backupCapacitySchemaInventory };
