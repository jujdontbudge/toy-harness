import { z } from "zod";

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
  schema: z.literal("toy.hermes-httpx-auth-fixture.v1"), operation: z.enum(["add", "list", "chat", "priority"]),
  public_argv: z.array(z.string().min(1).max(200)).min(2).max(16), exit_code: z.int().min(0).max(255),
  markers: z.array(z.enum(["AUTH_ADD_OK", "AUTH_ADD_NOT_CONFIRMED", "AUTH_SAVE_DENIED", "AUTH_SAVE_FAULT_NOT_CONFIRMED", "AUTH_LIST_READBACK_OK", "AUTH_LIST_EMPTY", "AUTH_LIST_NOT_CONFIRMED", "AUTH_PRIORITY_OK", "AUTH_PRIORITY_NOT_CONFIRMED", "CHAT_RESPONSE_OK", "CHAT_RESPONSE_NOT_CONFIRMED", "CHAT_GRANT_UNUSABLE", "CHAT_GRANT_USABILITY_NOT_CONFIRMED", "SIWC_AUTHORIZATION_REQUIRED", "SIWC_AUTHORIZATION_NOT_CONFIRMED", "CLI_EXIT_NONZERO", "CLI_EXCEPTION"])).max(8),
  processIdentity: z.strictObject({ pid: z.int().positive(), parentPid: z.int().positive(), uid: z.int().nonnegative(), gid: z.int().nonnegative() }),
  observations: z.strictObject({ provider: z.enum(["openai-codex", "openai-chatgpt"]), phase: z.enum(["add", "list", "chat", "chat-expired", "chat-reloaded", "add-enospc", "add-replace-fault", "list-after-fault", "chat-after-fault", "siwc-unbound", "concurrent-refresh-add", "priority-added", "priority-restored"]), credential_count: fixtureCounter.optional(), target_label_present: z.boolean().optional(), access_generation: z.enum(["initial", "rotated", "added", "added-rotated", "stale"]).nullable(), catalog_access_generation: z.enum(["initial", "rotated", "added", "added-rotated", "stale"]).nullable(), storage_fault_triggered: z.boolean(), token_hygiene: z.boolean(), success_claim_absent: z.boolean(), fallback_attempted: z.boolean(), network_denials: z.array(z.enum(["model-mismatch", "authorization-mismatch", "grant-mismatch", "paid-model-fallback", "device-grant-outside-add", "device-poll-outside-add", "model-request-outside-chat", "model-catalog-outside-chat", "codex-model-discovery", "openai-model-discovery", "unregistered-http", "tokenizer-download", "unregistered-socket"])).max(16), socket_origin: z.string().max(120).regex(/^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*$/i).nullable() }),
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
  InstalledHermesDependencyRecordV1: installedHermesDependencyRecordSchema,
  HermesPublicRuntimeCommandV1: hermesPublicRuntimeCommandSchema,
  HermesAuthConcurrencyObservationV1: hermesAuthConcurrencyObservationSchema,
  HermesAuthRefreshEffectV1: hermesAuthRefreshEffectSchema,
  HermesAuthFixtureResultV1: hermesAuthFixtureResultSchema
};
