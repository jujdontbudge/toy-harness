import { z } from "zod";
import { digestSchema } from "./primitives.js";
import { observationRefSchema } from "./control-evidence.js";

export const codexProtocolInspectionSchema = z.strictObject({
  state: z.enum(["observed", "unavailable"]), schemaDigest: digestSchema.nullable(), experimentalIncluded: z.boolean(),
  threadFields: z.array(z.string().max(100)), turnFields: z.array(z.string().max(100)),
  dynamicToolFields: z.array(z.string().max(100)), defaultToolsCanBeDisabled: z.boolean(),
  inferenceAttested: z.literal(false), authorizationInspected: z.literal(false)
});
export const installedCodexRuntimeSchema = z.strictObject({ expectedVersion: z.literal("0.160.0"), observedVersion: z.string().regex(/^\d+\.\d+\.\d+(?![\s\S])/).nullable(), executableDigest: digestSchema.nullable(), versionMatches: z.boolean(), protocol: codexProtocolInspectionSchema, inferenceAttested: z.literal(false), authorizationInspected: z.literal(false), paidFallbackPermitted: z.literal(false) });
export type CodexProtocolInspectionV1 = z.infer<typeof codexProtocolInspectionSchema>;
export type InstalledCodexRuntimeV1 = z.infer<typeof installedCodexRuntimeSchema>;
export const modelRoleSchema = z.enum(["foreground", "background", "cron", "auxiliary", "continuation", "research", "child"]);
export const modelArmSchema = z.enum(["original", "experimental-background-high-standard"]);
export const modelRouteSettingsSchema = z.strictObject({ model: z.enum(["gpt-6.1-sol", "gpt-6-luna"]), effort: z.enum(["max", "medium", "high"]), serviceTier: z.enum(["priority", "default"]) });
const originalSol = z.strictObject({ model: z.literal("gpt-6.1-sol"), effort: z.literal("max"), serviceTier: z.literal("priority") });
export const modelRoutePolicySchema = z.strictObject({
  schemaVersion: z.literal("toy.models.v1"), provider: z.literal("siwc_responses"), paidFallbackPermitted: z.literal(false),
  original: z.strictObject({ foreground: originalSol, background: originalSol, cron: originalSol, auxiliary: originalSol, continuation: originalSol,
    research: z.strictObject({ model: z.literal("gpt-6.1-sol"), effort: z.literal("medium"), serviceTier: z.literal("priority") }),
    child: z.strictObject({ model: z.literal("gpt-6-luna"), effort: z.literal("max"), serviceTier: z.literal("priority") }) }),
  experimentalBackgroundHighStandard: z.strictObject({ model: z.literal("gpt-6.1-sol"), effort: z.literal("high"), serviceTier: z.literal("default") })
});
export const modelRouteSelectInputSchema = z.strictObject({ role: modelRoleSchema, arm: modelArmSchema });
const modelRouteSelectionBaseSchema = z.strictObject({
  role: modelRoleSchema, arm: modelArmSchema, provider: z.literal("siwc_responses"), settings: modelRouteSettingsSchema,
  policyDigest: digestSchema, localOutputReservationTokens: z.literal(4096), outputLimitKind: z.literal("estimate"),
  providerOutputCap: z.null(), paidFallbackPermitted: z.literal(false)
});
const originalSelection = <Role extends z.infer<typeof modelRoleSchema>>(role: Role) => modelRouteSelectionBaseSchema.extend({
  role: z.literal(role), arm: z.literal("original"), settings: modelRoutePolicySchema.shape.original.shape[role]
});
const experimentalSelection = <Role extends "background" | "cron">(role: Role) => modelRouteSelectionBaseSchema.extend({
  role: z.literal(role), arm: z.literal("experimental-background-high-standard"), settings: modelRoutePolicySchema.shape.experimentalBackgroundHighStandard
});
export const modelRouteSelectionSchema = z.union([
  originalSelection(modelRoleSchema.enum.foreground), originalSelection(modelRoleSchema.enum.background),
  originalSelection(modelRoleSchema.enum.cron), originalSelection(modelRoleSchema.enum.auxiliary),
  originalSelection(modelRoleSchema.enum.continuation), originalSelection(modelRoleSchema.enum.research), originalSelection(modelRoleSchema.enum.child),
  experimentalSelection(modelRoleSchema.enum.background), experimentalSelection(modelRoleSchema.enum.cron)
]);
export type ModelRoleV1 = z.infer<typeof modelRoleSchema>;
export type ModelArmV1 = z.infer<typeof modelArmSchema>;
export type ModelRouteSettingsV1 = z.infer<typeof modelRouteSettingsSchema>;
export type ModelRoutePolicyV1 = z.infer<typeof modelRoutePolicySchema>;
export type ModelRouteSelectInputV1 = z.infer<typeof modelRouteSelectInputSchema>;
export type ModelRouteSelectionV1 = z.infer<typeof modelRouteSelectionSchema>;
export const modelRouteUsageSchema = z.strictObject({ inputTokens: z.int().nonnegative(), outputTokens: z.int().nonnegative(), reasoningTokens: z.int().nonnegative() });
export const modelRouteProviderEventSchema = z.union([
  z.strictObject({ type: z.literal("route"), settings: modelRouteSettingsSchema }),
  z.strictObject({ type: z.literal("output"), text: z.string().max(65536) }),
  z.strictObject({ type: z.literal("tool-call"), callId: z.string().min(1).max(200), name: z.string().min(1).max(100), namespace: z.string().min(1).max(100).optional(), argumentsJson: z.string().max(65536) }),
  z.strictObject({ type: z.literal("usage"), usage: modelRouteUsageSchema }),
  z.strictObject({ type: z.literal("completed") }),
  z.strictObject({ type: z.literal("failed"), code: z.enum(["quota_exhausted", "authentication_unavailable", "provider_failed", "protocol_invalid"]) }),
  z.strictObject({ type: z.literal("interrupted") })
]);
export const modelRouteReceiptSchema = z.strictObject({
  requested: modelRouteSelectionSchema, observed: modelRouteSettingsSchema.nullable(),
  terminal: z.enum(["completed", "failed", "interrupted"]), completion: z.enum(["complete", "pending"]),
  usage: modelRouteUsageSchema.nullable(), usageState: z.enum(["known", "uncertain"]),
  reservationTokens: z.union([z.literal(0), z.literal(4096)]), outputStarted: z.boolean(),
  reasonCode: z.enum(["quota_exhausted", "authentication_unavailable", "provider_failed", "protocol_invalid", "route_mismatch", "route_unobserved", "usage_unavailable", "stream_interrupted"]).nullable(),
  paidFallbackAttempted: z.literal(false)
});
export const modelRouteStreamEventSchema = z.union([modelRouteProviderEventSchema, z.strictObject({ type: z.literal("receipt"), receipt: modelRouteReceiptSchema })]);
export type ModelRouteUsageV1 = z.infer<typeof modelRouteUsageSchema>;
export type ModelRouteProviderEventV1 = z.infer<typeof modelRouteProviderEventSchema>;
export type ModelRouteReceiptV1 = z.infer<typeof modelRouteReceiptSchema>;
export type ModelRouteStreamEventV1 = z.infer<typeof modelRouteStreamEventSchema>;
const toolName = z.string().regex(/^[A-Za-z0-9_-]{1,100}(?![\s\S])/);
export const modelRouteInputItemSchema = z.union([
  z.strictObject({ type: z.literal("message"), role: z.enum(["developer", "user", "assistant"]), content: z.union([z.string().max(1048576), z.array(z.union([
    z.strictObject({ type: z.literal("input_text"), text: z.string().max(1048576) }),
    z.strictObject({ type: z.literal("output_text"), text: z.string().max(1048576) }),
    z.strictObject({ type: z.literal("input_image"), image_url: z.string().max(8388608).regex(/^(?:https:\/\/|data:image\/(?:png|jpeg|webp|gif);base64,)/), detail: z.enum(["auto", "low", "high", "original"]) })
  ]))]), phase: z.enum(["commentary", "final_answer"]).optional(), id: z.string().min(1).max(200).optional(), status: z.enum(["in_progress", "completed", "incomplete"]).optional() }),
  z.strictObject({ type: z.literal("function_call"), call_id: z.string().min(1).max(200), name: toolName, namespace: toolName.optional(), arguments: z.string().max(65536) }),
  z.strictObject({ type: z.literal("function_call_output"), call_id: z.string().min(1).max(200), output: z.string().max(1048576) }),
  z.strictObject({ type: z.literal("reasoning"), id: z.string().min(1).max(200).optional(), encrypted_content: z.string().max(1048576), summary: z.array(z.strictObject({ type: z.literal("summary_text"), text: z.string().max(65536) })) })
]);
export const modelRouteNamespaceToolSchema = z.strictObject({ type: z.literal("namespace"), name: toolName, description: z.string().max(65536), tools: z.array(z.strictObject({
  type: z.literal("function"), name: toolName, description: z.string().max(65536), parameters: z.record(z.string(), z.unknown()), strict: z.literal(true)
})).min(1) });
export const modelRouteConversationSchema = z.strictObject({ input: z.array(modelRouteInputItemSchema).min(1), instructions: z.string().max(1048576).optional(), tools: z.array(modelRouteNamespaceToolSchema) });
export const modelRouteResponsesRequestSchema = z.strictObject({
  model: modelRouteSettingsSchema.shape.model, reasoning: z.strictObject({ effort: modelRouteSettingsSchema.shape.effort }), service_tier: modelRouteSettingsSchema.shape.serviceTier,
  input: modelRouteConversationSchema.shape.input, instructions: modelRouteConversationSchema.shape.instructions, tools: modelRouteConversationSchema.shape.tools,
  store: z.literal(false), stream: z.literal(true), include: z.array(z.literal("reasoning.encrypted_content")).length(1)
});
export type ModelRouteInputItemV1 = z.infer<typeof modelRouteInputItemSchema>;
export type ModelRouteNamespaceToolV1 = z.infer<typeof modelRouteNamespaceToolSchema>;
export type ModelRouteConversationV1 = z.infer<typeof modelRouteConversationSchema>;
export type ModelRouteResponsesRequestV1 = z.infer<typeof modelRouteResponsesRequestSchema>;
export type ModelRouteHttpTransport = (request: ModelRouteResponsesRequestV1, signal: AbortSignal) => Promise<Response>;
export type SiwcPlanAccess = { accessToken: string; expiresAt: number; grantedScopes: readonly string[]; clientId: string; zeroCreditVerified: boolean };
export type SiwcPlanAccessReader = () => Promise<SiwcPlanAccess | null>;
export const siwcAuthorizationStatusSchema = z.strictObject({
  state: z.enum(["idle", "starting", "waiting", "exchanging", "saved", "refused", "cancelled"]),
  code: z.enum(["authorization_required", "attempt_active", "waiting_for_browser", "validating_authorization", "authorization_saved", "authorization_denied", "callback_invalid", "registration_invalid", "token_exchange_failed", "identity_invalid", "credential_owner_unavailable", "credential_readback_failed", "attempt_expired", "cancelled"]),
  planPermissionGranted: z.boolean(), zeroCreditVerified: z.literal(false), inferencePermitted: z.literal(false)
});
export const siwcTokenResponseSchema = z.object({
  access_token: z.string().min(1).max(32768), refresh_token: z.string().min(1).max(32768), id_token: z.string().min(1).max(65536),
  token_type: z.literal("Bearer"), expires_in: z.int().positive().max(31536000), scope: z.string().min(1).max(2048)
});
export const siwcJwtHeaderSchema = z.object({ alg: z.literal("RS256"), kid: z.string().min(1).max(200) });
export const siwcIdentityClaimsSchema = z.object({
  iss: z.literal("https://auth.openai.com"), sub: z.string().min(1).max(512),
  aud: z.union([z.string().min(1).max(512), z.array(z.string().min(1).max(512)).min(1)]),
  exp: z.int().positive(), iat: z.int().positive(), nbf: z.int().nonnegative().optional(),
  nonce: z.string().min(1).max(512), azp: z.string().min(1).max(512).optional()
});
export const siwcJwksSchema = z.object({ keys: z.array(z.unknown()).max(100) });
export const siwcRsaKeySchema = z.object({ kty: z.literal("RSA"), kid: z.string().min(1).max(200), n: z.string().min(1).max(8192), e: z.string().min(1).max(32), use: z.literal("sig").optional(), alg: z.literal("RS256").optional() });
export type SiwcAuthorizationStatusV1 = z.infer<typeof siwcAuthorizationStatusSchema>;
export type SiwcTokenResponse = z.infer<typeof siwcTokenResponseSchema>;
export const siwcRegistrationSchema = z.strictObject({ clientId: z.string().min(1).max(512).refine(value => value !== "dynamic_agent_client"), subject: z.string().min(1).max(512) });
const siwcHostIdSchema = z.string().regex(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/i);
export const siwcStoredGrantSchema = z.strictObject({ registration: siwcRegistrationSchema, hostId: siwcHostIdSchema, issuer: z.literal("https://auth.openai.com"), audience: z.literal("https://api.openai.com/v1"), accessToken: siwcTokenResponseSchema.shape.access_token, refreshToken: siwcTokenResponseSchema.shape.refresh_token, idToken: siwcTokenResponseSchema.shape.id_token, expiresAt: z.int().positive().max(Number.MAX_SAFE_INTEGER), scopes: z.array(z.string().min(1).max(256)).max(100), identityVerified: z.literal(true), zeroCreditVerified: z.literal(false) });
export const siwcGrantVaultSchema = z.strictObject({ schemaVersion: z.literal("toy.siwc-grant-vault.v1"), hostId: siwcHostIdSchema, registration: siwcRegistrationSchema.nullable(), pendingClientId: siwcRegistrationSchema.shape.clientId.nullable(), grant: siwcStoredGrantSchema.nullable() }).refine(value => value.grant === null || value.grant.hostId === value.hostId && value.registration !== null && value.grant.registration.clientId === value.registration.clientId && value.grant.registration.subject === value.registration.subject).refine(value => value.registration === null || value.pendingClientId === value.registration.clientId);
export type SiwcRegistration = z.infer<typeof siwcRegistrationSchema>;
export type SiwcStoredGrant = z.infer<typeof siwcStoredGrantSchema>;
export type SiwcGrantVaultV1 = z.infer<typeof siwcGrantVaultSchema>;
export type SiwcKeychainStore = { read: () => Promise<Uint8Array | null>; compareAndWrite: (expectedDigest: string | null, value: Uint8Array) => Promise<boolean> };
export const siwcKeychainLauncherSchema = z.strictObject({ pythonExecutable: z.string().min(2).max(4096).refine(value => value.startsWith("/") && !/[\u0000-\u001f\u007f]/.test(value) && !value.split("/").some(part => part === "." || part === "..")), pythonDigest: digestSchema, helperDigest: digestSchema });
export type SiwcKeychainLauncherV1 = z.infer<typeof siwcKeychainLauncherSchema>;
export type SiwcCredentialOwner = {
  load: () => Promise<{ hostId: string; registration: SiwcRegistration | null; pendingClientId: string | null }>;
  retainClientId: (clientId: string) => Promise<void>;
  save: (grant: SiwcStoredGrant) => Promise<void>;
  read: (registration: SiwcRegistration) => Promise<SiwcStoredGrant | null>;
};
export type SiwcAuthorizationHttp = (operation: "exchange" | "jwks", form: URLSearchParams | null, signal: AbortSignal) => Promise<Response>;
export type SiwcBrowserOpener = (authorizationUrl: string) => Promise<void>;
export const researchSkillResourcePathSchema = z.enum(["SKILL.md", "LICENSE", "agents/openai.yaml"]);
export const researchSkillPinSchema = z.strictObject({
  schemaVersion: z.literal("toy.research-skill-pin.v1"), repository: z.literal("https://github.com/mattpocock/skills"),
  sourcePath: z.literal("skills/engineering/research/SKILL.md"), sourceCommit: z.string().regex(/^[a-f0-9]{40}(?![\s\S])/),
  contentDigest: digestSchema, semanticVersion: z.string().min(1).max(100).nullable(),
  resources: z.array(z.strictObject({ path: z.enum(["LICENSE", "agents/openai.yaml"]), digest: digestSchema })).length(2)
}).refine(pin => new Set(pin.resources.map(resource => resource.path)).size === 2);
export const loadedResearchSkillSchema = z.strictObject({
  repository: researchSkillPinSchema.shape.repository, sourcePath: researchSkillPinSchema.shape.sourcePath,
  sourceCommit: researchSkillPinSchema.shape.sourceCommit, contentDigest: digestSchema, loadedDigest: digestSchema,
  semanticVersion: researchSkillPinSchema.shape.semanticVersion, resources: researchSkillPinSchema.shape.resources
}).refine(skill => skill.contentDigest === skill.loadedDigest);
export const modelRouteDelegationInputSchema = z.strictObject({
  requestId: z.uuid(), purpose: z.enum(["research", "implementation"]), objective: z.string().min(1).max(8192)
});
export const codexDelegationTaskSchema = z.strictObject({
  requestId: z.uuid(), objective: modelRouteDelegationInputSchema.shape.objective, role: z.enum(["research", "child"]),
  route: modelRouteSettingsSchema, skill: loadedResearchSkillSchema.nullable(), scope: z.literal("r0-feasibility"), depth: z.literal(1)
}).refine(task => task.role === "research" ? task.skill !== null : task.skill === null);
const delegationArtifactPathSchema = z.string().max(208).regex(/^reports\/[A-Za-z0-9._/-]{1,200}(?![\s\S])/).refine(path => path.startsWith("reports/")
  && path.split("/").every(part => part.length > 0 && part !== "." && part !== "..")
  && !path.includes("\\") && !/[\u0000-\u001f\u007f]/.test(path));
export const delegationArtifactManifestEntrySchema = z.strictObject({
  path: delegationArtifactPathSchema, media_type: z.enum(["text/markdown", "application/json", "text/csv", "application/pdf", "image/png"]),
  bytes: z.int().min(0).max(2 * 1024 * 1024), sha256: digestSchema, input_observations: z.array(observationRefSchema)
});
export const codexDelegationRequestSchema = z.strictObject({
  requestId: z.uuid(), purpose: modelRouteDelegationInputSchema.shape.purpose, executionBackend: z.literal("codex_exec"),
  workspace: z.string().min(2).max(4096), arguments: z.array(z.string().max(4096)).min(1),
  requested: modelRouteSelectionSchema, taskDigest: digestSchema, skill: loadedResearchSkillSchema.nullable()
}).refine(request => request.requested.arm === "original" && request.requested.role === (request.purpose === "research" ? "research" : "child") && (request.purpose === "research" ? request.skill !== null : request.skill === null));
export const codexDelegationEventSchema = z.union([
  z.strictObject({ type: z.literal("route"), model: modelRouteSettingsSchema.shape.model, effort: modelRouteSettingsSchema.shape.effort, serviceTier: z.enum(["fast", "default"]) }),
  modelRouteProviderEventSchema.options[1], modelRouteProviderEventSchema.options[2],
  modelRouteProviderEventSchema.options[3], modelRouteProviderEventSchema.options[4],
  modelRouteProviderEventSchema.options[5], modelRouteProviderEventSchema.options[6]
]);
export const modelRouteDelegationReceiptSchema = z.strictObject({
  requestId: z.uuid(), purpose: modelRouteDelegationInputSchema.shape.purpose, executionBackend: z.literal("codex_exec"),
  state: z.enum(["observed", "refused"]), reasonCode: z.enum(["DELEGATION_ROUTE_OBSERVED", "DELEGATION_ROUTE_REFUSED", "DELEGATION_RESULT_REFUSED", "RESEARCH_SKILL_UNAVAILABLE", "RESEARCH_SKILL_MISMATCH"]),
  skill: loadedResearchSkillSchema.nullable(), invocation: modelRouteReceiptSchema.nullable(),
  taskDigest: digestSchema.nullable(), requestDigest: digestSchema.nullable(), resultRefs: z.array(delegationArtifactManifestEntrySchema).max(8).optional(),
  nativeExecutionVerified: z.literal(false), acceptanceComplete: z.literal(false)
}).refine(receipt => receipt.state !== "observed" || receipt.invocation?.completion === "complete" && receipt.invocation.requested.role === (receipt.purpose === "research" ? "research" : "child") && (receipt.purpose === "research" ? receipt.skill !== null : receipt.skill === null));
export type ResearchSkillResourcePathV1 = z.infer<typeof researchSkillResourcePathSchema>;
export type ResearchSkillPinV1 = z.infer<typeof researchSkillPinSchema>;
export type LoadedResearchSkillV1 = z.infer<typeof loadedResearchSkillSchema>;
export type ModelRouteDelegationInputV1 = z.infer<typeof modelRouteDelegationInputSchema>;
export type CodexDelegationTaskV1 = z.infer<typeof codexDelegationTaskSchema>;
export type CodexDelegationRequestV1 = z.infer<typeof codexDelegationRequestSchema>;
export type CodexDelegationEventV1 = z.infer<typeof codexDelegationEventSchema>;
export type ModelRouteDelegationReceiptV1 = z.infer<typeof modelRouteDelegationReceiptSchema>;
export type DelegationArtifactManifestEntry = z.infer<typeof delegationArtifactManifestEntrySchema>;
export type CodexDelegationExecutor = (request: CodexDelegationRequestV1, signal: AbortSignal) => AsyncIterable<CodexDelegationEventV1>;
export type ResearchSkillResourceReader = (path: ResearchSkillResourcePathV1) => Uint8Array | null;

export const modelRouteSchemaInventory = {
  InstalledCodexRuntimeV1: installedCodexRuntimeSchema, CodexProtocolInspectionV1: codexProtocolInspectionSchema,
  ModelRoleV1: modelRoleSchema, ModelArmV1: modelArmSchema, ModelRouteSettingsV1: modelRouteSettingsSchema,
  ModelRoutePolicyV1: modelRoutePolicySchema, ModelRouteSelectInputV1: modelRouteSelectInputSchema, ModelRouteSelectionV1: modelRouteSelectionSchema,
  ModelRouteUsageV1: modelRouteUsageSchema, ModelRouteProviderEventV1: modelRouteProviderEventSchema,
  ModelRouteReceiptV1: modelRouteReceiptSchema, ModelRouteStreamEventV1: modelRouteStreamEventSchema,
  ModelRouteInputItemV1: modelRouteInputItemSchema, ModelRouteNamespaceToolV1: modelRouteNamespaceToolSchema,
  ModelRouteConversationV1: modelRouteConversationSchema, ModelRouteResponsesRequestV1: modelRouteResponsesRequestSchema,
  SiwcAuthorizationStatusV1: siwcAuthorizationStatusSchema, SiwcTokenResponse: siwcTokenResponseSchema,
  SiwcJwtHeaderV1: siwcJwtHeaderSchema, SiwcIdentityClaimsV1: siwcIdentityClaimsSchema,
  SiwcJwksV1: siwcJwksSchema, SiwcRsaKeyV1: siwcRsaKeySchema,
  SiwcRegistration: siwcRegistrationSchema, SiwcStoredGrant: siwcStoredGrantSchema, SiwcGrantVaultV1: siwcGrantVaultSchema, SiwcKeychainLauncherV1: siwcKeychainLauncherSchema,
  ResearchSkillResourcePathV1: researchSkillResourcePathSchema, ResearchSkillPinV1: researchSkillPinSchema,
  LoadedResearchSkillV1: loadedResearchSkillSchema, ModelRouteDelegationInputV1: modelRouteDelegationInputSchema,
  CodexDelegationRequestV1: codexDelegationRequestSchema, CodexDelegationEventV1: codexDelegationEventSchema,
  DelegationArtifactManifestEntry: delegationArtifactManifestEntrySchema,
  ModelRouteDelegationReceiptV1: modelRouteDelegationReceiptSchema, CodexDelegationTaskV1: codexDelegationTaskSchema
};
