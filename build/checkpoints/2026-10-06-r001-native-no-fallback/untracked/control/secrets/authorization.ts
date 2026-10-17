import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { siwcAuthorizationStatusSchema, siwcIdentityClaimsSchema, siwcJwksSchema, siwcJwtHeaderSchema, siwcRsaKeySchema, siwcTokenResponseSchema } from "@toy/contracts";
import type { SiwcAuthorizationHttp, SiwcAuthorizationStatusV1, SiwcBrowserOpener, SiwcCredentialOwner, SiwcRegistration, SiwcStoredGrant, SiwcTokenResponse } from "@toy/contracts";

const equal = (left: string, right: string): boolean => timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest());
const jsonBody = async (response: Response): Promise<unknown> => {
  if (!response.ok || response.body === null) throw new Error("siwc_http_failed");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 524288) throw new Error("siwc_http_invalid");
      chunks.push(part.value);
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return data;
  } finally { await reader.cancel().catch(() => undefined); }
};
const jwtPart = (part: string): unknown => {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error("siwc_identity_invalid");
  const bytes = Buffer.from(part, "base64url");
  if (bytes.toString("base64url") !== part) throw new Error("siwc_identity_invalid");
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  return value;
};
export const siwcAuthorizationHttp: SiwcAuthorizationHttp = (operation, form, signal) => fetch(
  operation === "exchange" ? "https://auth.openai.com/api/accounts/oauth/token" : "https://auth.openai.com/.well-known/jwks.json",
  { method: operation === "exchange" ? "POST" : "GET", redirect: "error", ...(form === null ? {} : { body: form }), signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) }
);

export class SiwcAuthorization {
  private current = siwcAuthorizationStatusSchema.parse({ state: "idle", code: "authorization_required", planPermissionGranted: false, zeroCreditVerified: false, inferencePermitted: false });
  private server: Server | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private requestTask: Promise<void> | null = null;
  constructor(private readonly owner: SiwcCredentialOwner, private readonly openBrowser: SiwcBrowserOpener, private readonly http: SiwcAuthorizationHttp = siwcAuthorizationHttp) {}
  status(): SiwcAuthorizationStatusV1 { return { ...this.current }; }
  private set(state: SiwcAuthorizationStatusV1["state"], code: SiwcAuthorizationStatusV1["code"], planPermissionGranted = false): void {
    this.current = siwcAuthorizationStatusSchema.parse({ state, code, planPermissionGranted, zeroCreditVerified: false, inferencePermitted: false });
  }
  private async close(): Promise<void> {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const server = this.server;
    if (server !== null) {
      await new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections(); });
      if (this.server === server) this.server = null;
    }
  }
  async cancel(): Promise<SiwcAuthorizationStatusV1> {
    this.controller?.abort();
    this.set("cancelled", "cancelled");
    await this.close();
    await this.requestTask;
    return this.status();
  }
  private reply(response: ServerResponse, status: number, code: string): void {
    response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; frame-ancestors 'none'", "x-content-type-options": "nosniff" });
    response.end("Toy sign-in: " + code);
  }
  private async identity(tokens: SiwcTokenResponse, clientId: string, nonce: string, signal: AbortSignal): Promise<string> {
    const parts = tokens.id_token.split(".");
    const headerPart = parts[0]; const payloadPart = parts[1]; const signaturePart = parts[2];
    if (parts.length !== 3 || headerPart === undefined || payloadPart === undefined || signaturePart === undefined || !/^[A-Za-z0-9_-]+$/.test(signaturePart)) throw new Error("siwc_identity_invalid");
    const header = siwcJwtHeaderSchema.parse(jwtPart(headerPart));
    const keys = siwcJwksSchema.parse(await jsonBody(await this.http("jwks", null, signal))).keys;
    const matching = keys.flatMap(raw => { const key = siwcRsaKeySchema.safeParse(raw); return key.success && key.data.kid === header.kid ? [key.data] : []; });
    const key = matching[0];
    if (matching.length !== 1 || key === undefined || !verify("RSA-SHA256", Buffer.from(headerPart + "." + payloadPart), createPublicKey({ key, format: "jwk" }), Buffer.from(signaturePart, "base64url"))) throw new Error("siwc_identity_invalid");
    const claims = siwcIdentityClaimsSchema.parse(jwtPart(payloadPart));
    const now = Date.now() / 1000;
    const audienceMatches = typeof claims.aud === "string" ? claims.aud === clientId : claims.aud.includes(clientId) && (claims.aud.length === 1 || claims.azp === clientId);
    if (!audienceMatches || claims.exp <= now || claims.iat > now + 5 || claims.exp <= claims.iat || claims.nbf !== undefined && claims.nbf > now + 5 || claims.azp !== undefined && claims.azp !== clientId || !equal(claims.nonce, nonce)) throw new Error("siwc_identity_invalid");
    return claims.sub;
  }
  async begin(): Promise<SiwcAuthorizationStatusV1> {
    if (this.server !== null || this.current.state === "starting") return siwcAuthorizationStatusSchema.parse({ ...this.current, state: "refused", code: "attempt_active" });
    this.set("starting", "authorization_required");
    const controller = new AbortController();
    this.controller = controller;
    this.requestTask = null;
    try {
      const selected = await this.owner.load();
      if (controller.signal.aborted) return this.status();
      if (!/^urn:uuid:[0-9a-f-]{36}$/i.test(selected.hostId) || selected.registration !== null && (!selected.registration.clientId || selected.registration.clientId === "dynamic_agent_client" || !selected.registration.subject) || selected.pendingClientId !== null && (!selected.pendingClientId || selected.pendingClientId === "dynamic_agent_client")) throw new Error("siwc_owner_unavailable");
      const requestedClientId = selected.registration?.clientId ?? selected.pendingClientId ?? "dynamic_agent_client";
      const state = randomBytes(32).toString("base64url"); const nonce = randomBytes(32).toString("base64url"); const verifier = randomBytes(64).toString("base64url");
      let consumed = false;
      let redirectUri = "";
      const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
        let ownsCallback = false;
        try {
          const url = new URL(request.url ?? "/", redirectUri);
          if (request.method !== "GET" || (request.url?.length ?? 0) > 16384 || url.origin !== new URL(redirectUri).origin || request.headers.host !== url.host || url.pathname !== "/auth/callback") { this.reply(response, 404, "callback_invalid"); return; }
          const params = url.searchParams;
          if ([...params.keys()].some(name => params.getAll(name).length !== 1) || !equal(params.get("state") ?? "", state) || consumed || controller.signal.aborted) { this.reply(response, 403, "callback_invalid"); return; }
          consumed = true;
          ownsCallback = true;
          this.set("exchanging", "validating_authorization");
          const registration = selected.registration;
          const suppliedClientId = params.get("client_id");
          const clientId = suppliedClientId ?? (requestedClientId === "dynamic_agent_client" ? null : requestedClientId);
          if (params.has("error")) { this.set("refused", "authorization_denied"); return; }
          const code = params.get("code");
          if (!code || code.length > 8192 || !clientId || clientId.length > 512 || clientId === "dynamic_agent_client" || requestedClientId !== "dynamic_agent_client" && suppliedClientId !== null && suppliedClientId !== requestedClientId) { this.set("refused", "registration_invalid"); return; }
          await this.owner.retainClientId(clientId);
          if (controller.signal.aborted) return;
          let tokens: SiwcTokenResponse;
          try { tokens = siwcTokenResponseSchema.parse(await jsonBody(await this.http("exchange", new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri, resource: "https://api.openai.com/v1" }), controller.signal))); }
          catch { if (!controller.signal.aborted) this.set("refused", "token_exchange_failed"); return; }
          const receivedAt = Date.now();
          let subject: string;
          try { subject = await this.identity(tokens, clientId, nonce, controller.signal); }
          catch { if (!controller.signal.aborted) this.set("refused", "identity_invalid"); return; }
          if (registration !== null && subject !== registration.subject) { this.set("refused", "identity_invalid"); return; }
          const scopes = [...new Set(tokens.scope.split(/\s+/).filter(Boolean))];
          const granted = scopes.includes("resource.invoke") && scopes.includes("chatgpt.tokens.use.direct");
          const identity: SiwcRegistration = { clientId, subject };
          const grant: SiwcStoredGrant = { registration: identity, hostId: selected.hostId, issuer: "https://auth.openai.com", audience: "https://api.openai.com/v1", accessToken: tokens.access_token, refreshToken: tokens.refresh_token, idToken: tokens.id_token, expiresAt: receivedAt + tokens.expires_in * 1000, scopes, identityVerified: true, zeroCreditVerified: false };
          if (controller.signal.aborted) return;
          await this.owner.save(grant);
          const readback = await this.owner.read(identity);
          if (controller.signal.aborted) return;
          if (readback === null || !equal(JSON.stringify(readback), JSON.stringify(grant))) { this.set("refused", "credential_readback_failed"); return; }
          this.set("saved", "authorization_saved", granted);
        } catch {
          if (ownsCallback && !controller.signal.aborted) this.set("refused", "credential_owner_unavailable");
          else if (!response.writableEnded) this.reply(response, 400, "callback_invalid");
        }
        finally {
          if (ownsCallback) {
            if (!response.writableEnded) this.reply(response, this.current.state === "saved" ? 200 : 400, this.current.code);
            controller.abort();
            await this.close();
          }
        }
      };
      this.server = createServer({ maxHeaderSize: 8192 }, (request, response) => {
        const task = handler(request, response).catch(() => { if (!controller.signal.aborted) this.set("refused", "callback_invalid"); });
        if (consumed && this.requestTask === null) this.requestTask = task;
      });
      this.server.requestTimeout = 10000; this.server.headersTimeout = 10000;
      const server = this.server;
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
      if (controller.signal.aborted) { await this.close(); return this.status(); }
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("siwc_listener_unavailable");
      redirectUri = "http://127.0.0.1:" + address.port + "/auth/callback";
      const url = new URL("https://auth.openai.com/api/accounts/authorize");
      url.search = new URLSearchParams({ client_id: requestedClientId, ...(requestedClientId === "dynamic_agent_client" ? { agent_name_hint: "Toy" } : {}), ext_agent_host_id: selected.hostId, response_type: "code", redirect_uri: redirectUri, scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct", resource: "https://api.openai.com/v1", state, nonce, code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") }).toString();
      this.set("waiting", "waiting_for_browser");
      this.timer = setTimeout(() => { controller.abort(); this.set("refused", "attempt_expired"); this.close().catch(() => undefined); }, 600000);
      await this.openBrowser(url.toString());
      return this.status();
    } catch {
      if (!controller.signal.aborted) this.set("refused", "credential_owner_unavailable");
      controller.abort();
      await this.close();
      return this.status();
    }
  }
}
