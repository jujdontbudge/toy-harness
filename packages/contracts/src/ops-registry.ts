import { z } from "zod";
import { digestSchema, moduleIdSchema, releaseSchema } from "./primitives.js";
import { cliCommandIdSchema } from "./cli-declarations.js";
import type { ModuleId } from "./primitives.js";
import type { CliCommandId } from "./cli-declarations.js";

export const serviceIdSchema = z.enum([
  "postgres", "backend", "workers", "hermes", "hermes-interactive", "ops", "authority", "ingress", "approval", "review",
  "attention-delivery", "hands", "backup", "secrets", "publisher", "evaluator", "repair", "tailscale", "recorder"
]);
export type ServiceId = z.infer<typeof serviceIdSchema>;
const acceptanceManifestIdentifierSchema = z.string().min(1).max(80).regex(/^[a-z][a-z0-9-]*(?![\s\S])/);
const acceptanceManifestPhaseSchema = z.string().min(1).max(80).regex(/^[a-z][a-z0-9-]*(?![\s\S])/);
const hermesAuthMandatoryCases = [
  {
    "id": "add",
    "publicOperation": "hermes --profile toy auth add openai-codex --type oauth --no-browser",
    "phase": "add"
  },
  {
    "id": "list",
    "publicOperation": "hermes --profile toy auth list openai-codex",
    "phase": "list"
  },
  {
    "id": "chat",
    "publicOperation": "hermes --profile toy chat --provider openai-codex --model gpt-6.1-sol --toolsets none -q \"Return the fixed fixture marker.\"",
    "phase": "chat"
  },
  {
    "id": "chat-expired",
    "publicOperation": "hermes --profile toy chat --provider openai-codex --model gpt-6.1-sol --toolsets none -q \"Return the fixed fixture marker.\"",
    "phase": "chat-expired"
  },
  {
    "id": "chat-reloaded",
    "publicOperation": "hermes --profile toy chat --provider openai-codex --model gpt-6.1-sol --toolsets none -q \"Return the fixed fixture marker.\"",
    "phase": "chat-reloaded"
  }
] as const;
const hermesAuthObservationBindings = [
  {
    "id": "process-identity-exit",
    "independentReader": "HermesAuthProbe.run: result.processIdentity, exit_code and child/fresh-child/parent/UID/GID matches",
    "caseIds": [
      "add",
      "list",
      "chat",
      "chat-expired",
      "chat-reloaded"
    ]
  },
  {
    "id": "public-argv",
    "independentReader": "HermesAuthProbe.run: result.public_argv",
    "caseIds": [
      "add",
      "list",
      "chat",
      "chat-expired",
      "chat-reloaded"
    ]
  },
  {
    "id": "fake-provider-ledger",
    "independentReader": "HermesAuthProbe.run: result.http_ledger and observations.network_denials",
    "caseIds": [
      "add",
      "list",
      "chat",
      "chat-expired",
      "chat-reloaded"
    ]
  },
  {
    "id": "root-profile-store-readback",
    "independentReader": "HermesAuthProbe.run: rootStoreUnchanged, profileAuthAfterAdd, profileAuthCurrent and root/profile digests",
    "caseIds": [
      "add",
      "list",
      "chat",
      "chat-expired",
      "chat-reloaded"
    ]
  },
  {
    "id": "token-hygiene",
    "independentReader": "HermesAuthProbe.run: result.observations.token_hygiene",
    "caseIds": [
      "add",
      "list",
      "chat",
      "chat-expired",
      "chat-reloaded"
    ]
  },
  {
    "id": "fresh-process-usability",
    "independentReader": "HermesAuthProbe.run: fresh chat CHAT_RESPONSE_OK and observations.access_generation",
    "caseIds": [
      "chat",
      "chat-expired",
      "chat-reloaded"
    ]
  }
] as const;
const hermesSaveFaultMandatoryCases = [
  {
    "id": "add-enospc",
    "publicOperation": "hermes --profile toy auth add openai-codex --type oauth --no-browser",
    "phase": "add-enospc"
  },
  {
    "id": "add-replace-fault",
    "publicOperation": "hermes --profile toy auth add openai-codex --type oauth --no-browser",
    "phase": "add-replace-fault"
  }
] as const;
const hermesSaveFaultControls = [
  {
    "id": "profile-store-enospc",
    "seam": "os",
    "affectedPhases": [
      "add-enospc"
    ]
  },
  {
    "id": "profile-auth-atomic-replace-eio",
    "seam": "os",
    "affectedPhases": [
      "add-replace-fault"
    ]
  }
] as const;
const hermesSaveFaultObservations = [
  {
    "id": "save-denial",
    "independentReader": "HermesAuthProbe.run: nonzero add, AUTH_SAVE_DENIED, triggered OS fault, clean streams and no success claim",
    "caseIds": [
      "add-enospc",
      "add-replace-fault"
    ]
  },
  {
    "id": "unsaved-grant-denial",
    "independentReader": "HermesAuthProbe.run: fresh public list is empty and fresh chat cannot send with an unsaved grant",
    "caseIds": [
      "add-enospc",
      "add-replace-fault"
    ]
  },
  {
    "id": "root-provider-isolation",
    "independentReader": "HermesAuthProbe.run: unchanged root store and strict fake-provider/socket ledgers",
    "caseIds": [
      "add-enospc",
      "add-replace-fault"
    ]
  }
] as const;
export const registeredCliAcceptanceManifestSchema = z.strictObject({
  id: z.string().min(1).max(120).regex(/^AT-[A-Za-z0-9-]+(?![\s\S])/), rung: z.literal("CLI"), sourceAssertionHash: digestSchema,
  commandId: z.literal("probe.run"), scenarioId: z.string().min(1).max(120).regex(/^[a-z][a-z0-9.-]*(?![\s\S])/), owner: moduleIdSchema,
  firstRelease: releaseSchema, kind: z.enum(["static_gate", "behavioral", "mixed"]),
  mandatoryCases: z.array(z.strictObject({
    id: acceptanceManifestIdentifierSchema, publicOperation: z.string().min(1).max(512), phase: acceptanceManifestPhaseSchema
  })).min(1),
  trigger: z.string().min(1).max(2000),
  faultControls: z.array(z.strictObject({
    id: acceptanceManifestIdentifierSchema, seam: z.enum(["provider", "clock", "model-route", "os"]),
    affectedPhases: z.array(acceptanceManifestPhaseSchema).min(1)
  })),
  observations: z.array(z.strictObject({
    id: acceptanceManifestIdentifierSchema, independentReader: z.string().min(1).max(120), caseIds: z.array(acceptanceManifestIdentifierSchema).min(1)
  })).min(1),
  simUnavailableReason: z.string().min(1).max(2000)
}).refine(manifest => {
  const caseIds = manifest.mandatoryCases.map(testCase => testCase.id);
  const phases = manifest.mandatoryCases.map(testCase => testCase.phase);
  const faultIds = manifest.faultControls.map(fault => fault.id);
  const observationIds = manifest.observations.map(observation => observation.id);
  const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;
  const knownCases = new Set(caseIds);
  const knownPhases = new Set(phases);
  const observedCases = new Set(manifest.observations.flatMap(observation => observation.caseIds));
  const hermesAuthBindingsMatch = manifest.id !== "AT-hermes-config-85" || (
    manifest.owner === "hermes" && manifest.scenarioId === "auth.fresh-process" && manifest.firstRelease === "R0" && manifest.kind === "behavioral"
    && JSON.stringify(manifest.mandatoryCases) === JSON.stringify(hermesAuthMandatoryCases)
    && JSON.stringify(manifest.faultControls) === JSON.stringify([{ id: "access-token-expiry", seam: "clock", affectedPhases: ["chat-expired"] }])
    && JSON.stringify(manifest.observations) === JSON.stringify(hermesAuthObservationBindings)
  );
  const hermesSaveFaultBindingsMatch = manifest.id !== "AT-hermes-config-84" || (
    manifest.owner === "hermes" && manifest.scenarioId === "auth.save-fault" && manifest.firstRelease === "R0" && manifest.kind === "behavioral"
    && JSON.stringify(manifest.mandatoryCases) === JSON.stringify(hermesSaveFaultMandatoryCases)
    && JSON.stringify(manifest.faultControls) === JSON.stringify(hermesSaveFaultControls)
    && JSON.stringify(manifest.observations) === JSON.stringify(hermesSaveFaultObservations)
  );
  return hermesSaveFaultBindingsMatch && hermesAuthBindingsMatch && unique(caseIds) && unique(phases) && unique(faultIds) && unique(observationIds)
    && manifest.faultControls.every(fault => unique(fault.affectedPhases) && fault.affectedPhases.every(phase => knownPhases.has(phase)))
    && manifest.observations.every(observation => unique(observation.caseIds) && observation.caseIds.every(id => knownCases.has(id)))
    && caseIds.every(id => observedCases.has(id));
}, "CLI acceptance manifest references must be unique and resolve to mandatory cases");
export type RegisteredCliAcceptanceManifestV1 = z.infer<typeof registeredCliAcceptanceManifestSchema>;
const declaration = <Id extends string>(id: Id, owner: ModuleId, nextCommandId: CliCommandId) => ({ id, owner, nextCommandId });
export const opsControlReadInventory = [
  ...serviceIdSchema.options.map((id) => declaration(`service.${id}`, "ops", "status")),
  declaration("read.model-route", "ops", "doctor"),
  declaration("read.model-route-policy", "hermes", "doctor"),
  declaration("read.ops", "ops", "status"), declaration("read.sources", "sources", "sources.health"),
  declaration("read.attention", "attention", "attention.snapshot"), declaration("read.quota", "ops", "status"),
  declaration("read.cadence", "self-improvement", "review.slots"), declaration("read.release", "ops", "release.status")
];
export const testStackCheckInventory = [
  declaration("engineering.map", "self-improvement", "feature-map.check"), declaration("engineering.static", "self-improvement", "gardener.run"),
  declaration("accounting.model-admission", "self-improvement", "probe.run"),
  declaration("capacity.trial-journal", "self-improvement", "probe.run"),
  declaration("research.component-comparison", "self-improvement", "probe.run"),
  declaration("queue.obligation-faults", "ops", "probe.run"),
  declaration("release.native-eligibility", "ops", "probe.run"),
  declaration("backup.local-inventory", "ops", "doctor"),
  declaration("backup.capacity", "ops", "probe.run"),
  declaration("auth.native-runtime", "hermes", "probe.run"),
  declaration("auth.native-fixture", "hermes", "probe.run"),
  declaration("profile.native-gateway", "hermes", "probe.run"),
  declaration("bootstrap.reference.connector", "sources", "probe.run"), declaration("bootstrap.reference.tool", "self-improvement", "probe.run"),
  declaration("bootstrap.reference.skill", "self-improvement", "probe.run"), declaration("bootstrap.reference.migration", "ops", "probe.run"),
  declaration("bootstrap.fixture-runtime", "ops", "stack.up"), declaration("bootstrap.fixture-identities", "ops", "doctor"),
  declaration("bootstrap.role-identities", "ops", "doctor"), declaration("bootstrap.role-control-denials", "ops", "probe.run"),
  declaration("bootstrap.journal", "ops", "stack.up"),
  declaration("bootstrap.signature", "ops", "stack.up"), declaration("bootstrap.native-entry", "ops", "stack.up"),
  declaration("bootstrap.inherited-child", "ops", "stack.up"), declaration("bootstrap.fs-denial", "ops", "stack.up"),
  declaration("bootstrap.network-denial", "ops", "stack.up"), declaration("bootstrap.keychain-denial", "ops", "stack.up"),
  declaration("bootstrap.container-isolation", "ops", "stack.up"),
  declaration("bootstrap.postgres-unix", "ops", "stack.up"), declaration("bootstrap.controller-peer", "ops", "stack.up"),
  declaration("bootstrap.resource-admission", "ops", "stack.up"), declaration("bootstrap.cleanup", "ops", "stack.down")
];
export const registeredCheckIdSchema = z.enum([...opsControlReadInventory, ...testStackCheckInventory].map((entry) => entry.id));
export const opsControlProbeDeclarationSchema = z.strictObject({
  id: registeredCheckIdSchema, owner: moduleIdSchema, nextCommandId: cliCommandIdSchema
});
for (const entry of opsControlReadInventory) opsControlProbeDeclarationSchema.parse(entry);
for (const entry of testStackCheckInventory) opsControlProbeDeclarationSchema.parse(entry);
export type OpsControlProbeDeclarationV1 = z.infer<typeof opsControlProbeDeclarationSchema>;
export type RegisteredCheckIdV1 = z.infer<typeof registeredCheckIdSchema>;
export const opsRegistrySchemaInventory = {
  ServiceId: serviceIdSchema, OpsControlProbeDeclarationV1: opsControlProbeDeclarationSchema, RegisteredCheckIdV1: registeredCheckIdSchema,
  RegisteredCliAcceptanceManifestV1: registeredCliAcceptanceManifestSchema
};
