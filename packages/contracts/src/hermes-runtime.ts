import { z } from "zod";

export const hermesGatewayProfileSchema = z.strictObject({
  gateway: z.strictObject({
    multiplex_profiles: z.boolean(), loop_watchdog: z.boolean(),
    loop_watchdog_probe_interval_s: z.number().min(1).max(3600),
    loop_watchdog_probe_timeout_s: z.number().min(1).max(600),
    loop_watchdog_max_strikes: z.int().min(1).max(1000)
  }),
  platforms: z.strictObject({ discord: z.strictObject({ enabled: z.boolean() }) }),
  streaming: z.strictObject({ enabled: z.boolean() })
});
export const hermesGatewayConsumerInventorySchema = z.strictObject({
  sourceCommit: z.literal("8d5e3e412138342e8bf30443e72bd4e6a9abd057"),
  sources: z.array(z.strictObject({ path: z.enum(["gateway/config.py", "gateway/config_loader.py", "hermes_cli/config.py"]), digest: z.string().regex(/^[a-f0-9]{64}$/) })).length(3),
  keys: z.array(z.strictObject({ path: z.string().min(1).max(100), consumer: z.enum(["GatewayConfig", "PlatformConfig", "StreamingConfig"]) })).length(7)
});
export const hermesGatewayNativeObservationSchema = z.strictObject({
  effective: hermesGatewayProfileSchema,
  pid: z.int().positive(), parentPid: z.int().positive(), uid: z.int().nonnegative(), gid: z.int().nonnegative(),
  networkAttempts: z.int().nonnegative(), blockedSocketBinds: z.int().nonnegative()
});
export const hermesGatewayProfileReceiptSchema = z.strictObject({
  scope: z.literal("gateway-fragment"), profile: hermesGatewayProfileSchema,
  profileDigest: z.string().regex(/^[a-f0-9]{64}$/), consumerInventoryDigest: z.string().regex(/^[a-f0-9]{64}$/),
  sourceCommit: z.literal("8d5e3e412138342e8bf30443e72bd4e6a9abd057"),
  native: hermesGatewayNativeObservationSchema,
  nativeExitCode: z.literal(0), nativeConsumerMatched: z.literal(true),
  profilePublicationPerformed: z.literal(false), liveProviderSends: z.literal(0), acceptanceComplete: z.literal(false)
});
export type HermesGatewayProfileV1 = z.infer<typeof hermesGatewayProfileSchema>;
export type HermesGatewayConsumerInventoryV1 = z.infer<typeof hermesGatewayConsumerInventorySchema>;
export type HermesGatewayNativeObservationV1 = z.infer<typeof hermesGatewayNativeObservationSchema>;
export type HermesGatewayProfileReceiptV1 = z.infer<typeof hermesGatewayProfileReceiptSchema>;

export const hermesMcpHttpNativeObservationSchema = z.strictObject({
  pid: z.int().positive(), parentPid: z.int().positive(), uid: z.int().nonnegative(), gid: z.int().nonnegative(),
  sdkVersion: z.literal("2.0.0"), configurationKeys: z.array(z.literal("url")).length(1),
  transport: z.enum(["http", "unobserved"]), connected: z.boolean(), tools: z.int().min(0).max(5),
  registeredTools: z.array(z.enum(["mcp__life_store__fixture_ping", "mcp__life_store__list_resources", "mcp__life_store__read_resource", "mcp__life_store__list_prompts", "mcp__life_store__get_prompt"])).max(5),
  connectedAfterShutdown: z.boolean(), serverReady: z.boolean(), serverStopped: z.boolean(),
  loopbackConnections: z.int().nonnegative(), deniedNetworkAttempts: z.int().nonnegative(),
  blockedSocketBinds: z.int().nonnegative(), deniedSubprocessAttempts: z.int().nonnegative(),
  failureStage: z.enum(["none", "import", "server-start", "native-registration", "native-shutdown", "server-stop"])
});
export const hermesMcpHttpReceiptSchema = z.strictObject({
  scope: z.literal("disposable-mcp-http"), sourceCommit: z.literal("8d5e3e412138342e8bf30443e72bd4e6a9abd057"),
  sourceInventoryDigest: z.string().regex(/^[a-f0-9]{64}$/), native: hermesMcpHttpNativeObservationSchema,
  transportOverrideUsed: z.literal(false), profilePublicationPerformed: z.literal(false),
  liveProviderSends: z.literal(0), acceptanceComplete: z.literal(false)
});
export type HermesMcpHttpNativeObservationV1 = z.infer<typeof hermesMcpHttpNativeObservationSchema>;
export type HermesMcpHttpReceiptV1 = z.infer<typeof hermesMcpHttpReceiptSchema>;

export const installedHermesDependencyRecordSchema = z.object({
  packages: z.object({ venv: z.object({ environment: z.string().min(1).max(4096) }) })
});
export const hermesPublicRuntimeCommandSchema = z.array(z.string().min(1).max(16384)).min(4).max(16);
const fixtureCounter = z.int().min(0).max(1000);
export const hermesAuthRefreshEffectSchema = z.strictObject({
  from: z.enum(["initial", "rotated", "added"]), to: z.enum(["rotated", "stale", "added-rotated"]),
  barrier: z.enum(["primary-released", "not-used"])
});
export const hermesAuthConcurrencyObservationSchema = z.strictObject({
  order: z.enum(["refresh-first", "add-first"]),
  actor: z.enum(["auth-add", "expired-chat", "fresh-list-reload", "fresh-add-reload", "fresh-refresh-reload"]),
  barrier: z.enum(["not-used", "reached", "released", "persisted"]),
  crashCut: z.enum(["none", "after-add-public-command-before-wrapper-exit", "after-refresh-public-command-before-wrapper-exit"]),
  staleRefreshTokenRejected: z.enum(["not-exercised", "rejected"]),
  staleRefreshResponse: z.enum(["not-exercised", "rejected"]),
  freshProcessUse: z.enum(["not-checked", "usable", "unusable"]),
  refreshGeneration: z.enum(["initial", "rotated", "added", "added-rotated", "stale"]).nullable(),
  refreshEffects: z.array(hermesAuthRefreshEffectSchema).max(16)
});
export const hermesAuthFixtureResultSchema = z.strictObject({
  schema: z.literal("toy.hermes-httpx-auth-fixture.v1"), operation: z.enum(["add", "list", "chat", "priority", "remove", "reset"]),
  public_argv: z.array(z.string().min(1).max(200)).min(2).max(16), exit_code: z.int().min(0).max(255),
  markers: z.array(z.enum(["AUTH_ADD_OK", "AUTH_ADD_NOT_CONFIRMED", "AUTH_SAVE_DENIED", "AUTH_SAVE_FAULT_NOT_CONFIRMED", "AUTH_LIST_READBACK_OK", "AUTH_LIST_EMPTY", "AUTH_LIST_NOT_CONFIRMED", "AUTH_PRIORITY_OK", "AUTH_PRIORITY_NOT_CONFIRMED", "CHAT_RESPONSE_OK", "CHAT_RESPONSE_NOT_CONFIRMED", "CHAT_GRANT_UNUSABLE", "CHAT_GRANT_USABILITY_NOT_CONFIRMED", "SIWC_AUTHORIZATION_REQUIRED", "SIWC_AUTHORIZATION_NOT_CONFIRMED", "CLI_EXIT_NONZERO", "CLI_EXCEPTION", "AUTH_REMOVE_OK", "AUTH_RESET_OK", "AUTH_LIST_TARGET_RATE_LIMITED", "AUTH_PROVIDER_RATE_LIMIT_OBSERVED"])).max(8),
  processIdentity: z.strictObject({ pid: z.int().positive(), parentPid: z.int().positive(), uid: z.int().nonnegative(), gid: z.int().nonnegative() }),
  observations: z.strictObject({ provider: z.enum(["openai-codex", "openai-chatgpt"]), phase: z.enum(["add", "list", "chat", "chat-expired", "chat-reloaded", "add-enospc", "add-replace-fault", "list-after-fault", "chat-after-fault", "siwc-unbound", "concurrent-refresh-add", "priority-added", "priority-restored", "remove", "reset"]), credential_count: fixtureCounter.optional(), target_label_present: z.boolean().optional(), access_generation: z.enum(["initial", "rotated", "added", "added-rotated", "stale"]).nullable(), catalog_access_generation: z.enum(["initial", "rotated", "added", "added-rotated", "stale"]).nullable(), storage_fault_triggered: z.boolean(), token_hygiene: z.boolean(), success_claim_absent: z.boolean(), fallback_attempted: z.boolean(), network_denials: z.array(z.enum(["model-mismatch", "authorization-mismatch", "grant-mismatch", "paid-model-fallback", "device-grant-outside-add", "device-poll-outside-add", "model-request-outside-chat", "model-catalog-outside-chat", "codex-model-discovery", "openai-model-discovery", "unregistered-http", "tokenizer-download", "unregistered-socket"])).max(16), socket_origin: z.string().max(120).regex(/^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*$/i).nullable() }),
  concurrency: hermesAuthConcurrencyObservationSchema.optional(),
  http_ledger: z.strictObject({
    device_code_requests: fixtureCounter, device_code_polls: fixtureCounter, token_exchanges: fixtureCounter,
    token_refreshes: fixtureCounter, model_catalog_requests: fixtureCounter, model_requests: fixtureCounter, denied_http_requests: fixtureCounter, blocked_socket_events: fixtureCounter
  }), network_audit: z.literal("socket-audit-hook-installed")
});
export type InstalledHermesDependencyRecordV1 = z.infer<typeof installedHermesDependencyRecordSchema>;
export type HermesPublicRuntimeCommandV1 = z.infer<typeof hermesPublicRuntimeCommandSchema>;
export type HermesAuthConcurrencyObservationV1 = z.infer<typeof hermesAuthConcurrencyObservationSchema>;
export type HermesAuthRefreshEffectV1 = z.infer<typeof hermesAuthRefreshEffectSchema>;
export type HermesAuthFixtureResultV1 = z.infer<typeof hermesAuthFixtureResultSchema>;
export const hermesRuntimeSchemaInventory = {
  HermesGatewayProfileV1: hermesGatewayProfileSchema,
  HermesGatewayConsumerInventoryV1: hermesGatewayConsumerInventorySchema,
  HermesGatewayNativeObservationV1: hermesGatewayNativeObservationSchema,
  HermesGatewayProfileReceiptV1: hermesGatewayProfileReceiptSchema,
  HermesMcpHttpNativeObservationV1: hermesMcpHttpNativeObservationSchema,
  HermesMcpHttpReceiptV1: hermesMcpHttpReceiptSchema,
  InstalledHermesDependencyRecordV1: installedHermesDependencyRecordSchema,
  HermesPublicRuntimeCommandV1: hermesPublicRuntimeCommandSchema,
  HermesAuthConcurrencyObservationV1: hermesAuthConcurrencyObservationSchema,
  HermesAuthRefreshEffectV1: hermesAuthRefreshEffectSchema,
  HermesAuthFixtureResultV1: hermesAuthFixtureResultSchema
};
