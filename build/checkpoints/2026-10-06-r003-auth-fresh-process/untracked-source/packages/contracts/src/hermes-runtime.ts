import { z } from "zod";

export const installedHermesDependencyRecordSchema = z.object({
  packages: z.object({ venv: z.object({ environment: z.string().min(1).max(4096) }) })
});
export const hermesPublicRuntimeCommandSchema = z.array(z.string().min(1).max(16384)).min(4).max(16);
const fixtureCounter = z.int().min(0).max(1000);
export const hermesAuthFixtureResultSchema = z.strictObject({
  schema: z.literal("toy.hermes-httpx-auth-fixture.v1"), operation: z.enum(["add", "list", "chat"]),
  public_argv: z.array(z.string().min(1).max(200)).min(2).max(16), exit_code: z.int().min(0).max(255),
  markers: z.array(z.enum(["AUTH_ADD_OK", "AUTH_ADD_NOT_CONFIRMED", "AUTH_LIST_READBACK_OK", "AUTH_LIST_EMPTY", "CHAT_RESPONSE_OK", "CHAT_RESPONSE_NOT_CONFIRMED", "CLI_EXIT_NONZERO", "CLI_EXCEPTION"])).max(8),
  processIdentity: z.strictObject({ pid: z.int().positive(), parentPid: z.int().positive(), uid: z.int().nonnegative(), gid: z.int().nonnegative() }),
  observations: z.strictObject({ provider: z.literal("openai-codex"), phase: z.enum(["add", "list", "chat", "chat-expired", "chat-reloaded"]), credential_count: fixtureCounter.optional(), access_generation: z.enum(["initial", "rotated"]).nullable(), network_denials: z.array(z.enum(["model-mismatch", "authorization-mismatch", "grant-mismatch", "codex-model-discovery", "openai-model-discovery", "unregistered-http", "tokenizer-download", "unregistered-socket"])).max(16), socket_origin: z.string().max(120).regex(/^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*$/i).nullable() }),
  http_ledger: z.strictObject({
    device_code_requests: fixtureCounter, device_code_polls: fixtureCounter, token_exchanges: fixtureCounter,
    token_refreshes: fixtureCounter, model_catalog_requests: fixtureCounter, model_requests: fixtureCounter, denied_http_requests: fixtureCounter, blocked_socket_events: fixtureCounter
  }), network_audit: z.literal("socket-audit-hook-installed")
});
export type InstalledHermesDependencyRecordV1 = z.infer<typeof installedHermesDependencyRecordSchema>;
export type HermesPublicRuntimeCommandV1 = z.infer<typeof hermesPublicRuntimeCommandSchema>;
export type HermesAuthFixtureResultV1 = z.infer<typeof hermesAuthFixtureResultSchema>;
export const hermesRuntimeSchemaInventory = {
  InstalledHermesDependencyRecordV1: installedHermesDependencyRecordSchema,
  HermesPublicRuntimeCommandV1: hermesPublicRuntimeCommandSchema,
  HermesAuthFixtureResultV1: hermesAuthFixtureResultSchema
};
