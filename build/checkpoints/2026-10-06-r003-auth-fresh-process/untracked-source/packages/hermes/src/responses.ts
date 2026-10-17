import { modelRouteProviderEventSchema, modelRouteResponsesRequestSchema, modelRouteSettingsSchema, modelRouteUsageSchema } from "@toy/contracts";
import type { ModelRouteConversationV1, ModelRouteHttpTransport, ModelRouteProviderEventV1, ModelRouteSelectionV1, SiwcPlanAccessReader } from "@toy/contracts";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const object = (value: unknown): Record<string, unknown> | null => isObject(value) ? value : null;
const fail = (code: "quota_exhausted" | "authentication_unavailable" | "provider_failed" | "protocol_invalid"): ModelRouteProviderEventV1 => ({ type: "failed", code });
const providerFailure = (value: unknown, status: number): ModelRouteProviderEventV1 => {
  const error = object(object(value)?.error);
  const code = error?.code ?? object(value)?.code;
  if (code === "subscription_sharing_usage_limit_exceeded" || status === 429) return fail("quota_exhausted");
  if (status === 401 || status === 403 || code === "subscription_sharing_invalid_user" || code === "subscription_sharing_user_not_eligible") return fail("authentication_unavailable");
  return fail("provider_failed");
};

async function* frames(response: Response): AsyncGenerator<unknown> {
  if (response.body === null || !/^text\/event-stream(?:;|$)/i.test(response.headers.get("content-type") ?? "")) throw new Error("INVALID_PROVIDER_STREAM");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let data: string[] = [];
  let eventType = "";
  let frameBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) { buffer += decoder.decode(); break; }
      buffer += decoder.decode(chunk.value, { stream: true });
      if (buffer.length > 1048576) throw new Error("PROVIDER_FRAME_TOO_LARGE");
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        frameBytes += line.length;
        if (frameBytes > 1048576) throw new Error("PROVIDER_FRAME_TOO_LARGE");
        if (line === "") {
          if (data.length > 0) {
            const value: unknown = JSON.parse(data.join("\n"));
            if (eventType !== "" && eventType !== object(value)?.type) throw new Error("PROVIDER_EVENT_MISMATCH");
            yield value;
          }
          data = []; eventType = ""; frameBytes = 0;
        } else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        else if (line.startsWith("event:")) eventType = line.slice(6).replace(/^ /, "");
        newline = buffer.indexOf("\n");
      }
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export const createResponsesTransport = (readAccess: SiwcPlanAccessReader): ModelRouteHttpTransport => async (request, signal) => {
  const body = modelRouteResponsesRequestSchema.parse(request);
  const access = await readAccess();
  if (signal.aborted || access === null || !access.zeroCreditVerified || !Number.isFinite(access.expiresAt) || access.expiresAt <= Date.now() || !access.grantedScopes.includes("chatgpt.tokens.use.direct") || !access.grantedScopes.includes("resource.invoke") || access.clientId === "dynamic_agent_client" || access.clientId.length === 0 || access.accessToken.length === 0) return new Response(null, { status: 403 });
  return fetch("https://api.openai.com/v1/responses", { method: "POST", redirect: "error", headers: { authorization: "Bearer " + access.accessToken, "content-type": "application/json", accept: "text/event-stream" }, body: JSON.stringify(body), signal });
};

export async function* responsesEvents(selection: ModelRouteSelectionV1, conversation: ModelRouteConversationV1, transport: ModelRouteHttpTransport, signal: AbortSignal): AsyncGenerator<ModelRouteProviderEventV1> {
  const request = modelRouteResponsesRequestSchema.parse({ ...conversation, model: selection.settings.model, reasoning: { effort: selection.settings.effort }, service_tier: selection.settings.serviceTier, store: false, stream: true, include: ["reasoning.encrypted_content"] });
  if (signal.aborted) { yield { type: "interrupted" }; return; }
  const response = await transport(request, signal);
  if (!response.ok) {
    yield providerFailure(null, response.status);
    await response.body?.cancel();
    return;
  }
  let responseId: string | null = null;
  const calls = new Set<string>();
  for await (const raw of frames(response)) {
    if (signal.aborted) { yield { type: "interrupted" }; return; }
    const frame = object(raw);
    if (frame === null || typeof frame.type !== "string") throw new Error("INVALID_PROVIDER_EVENT");
    if (["response.created", "response.in_progress", "response.completed", "response.failed", "response.incomplete"].includes(frame.type)) {
      const metadata = object(frame.response);
      if (metadata === null || typeof metadata.id !== "string" || responseId !== null && responseId !== metadata.id) throw new Error("INVALID_PROVIDER_RESPONSE");
      responseId = metadata.id;
      const route = modelRouteSettingsSchema.safeParse({ model: metadata.model, effort: object(metadata.reasoning)?.effort, serviceTier: metadata.service_tier });
      if (!route.success) { yield fail("protocol_invalid"); return; }
      yield { type: "route", settings: route.data };
      if (frame.type === "response.completed") {
        const wireUsage = object(metadata.usage);
        const usage = modelRouteUsageSchema.safeParse({ inputTokens: wireUsage?.input_tokens, outputTokens: wireUsage?.output_tokens, reasoningTokens: object(wireUsage?.output_tokens_details)?.reasoning_tokens });
        if (usage.success) yield { type: "usage", usage: usage.data };
        yield { type: "completed" }; return;
      }
      if (frame.type === "response.failed") { yield providerFailure(metadata, 200); return; }
      if (frame.type === "response.incomplete") { yield { type: "interrupted" }; return; }
    } else if (frame.type === "response.output_text.delta" || frame.type === "response.refusal.delta") {
      yield modelRouteProviderEventSchema.parse({ type: "output", text: frame.delta });
    } else if (frame.type === "response.output_item.done") {
      const item = object(frame.item);
      if (item?.type === "function_call") {
        const call = modelRouteProviderEventSchema.parse({ type: "tool-call", callId: item.call_id, name: item.name, ...(item.namespace === undefined ? {} : { namespace: item.namespace }), argumentsJson: item.arguments });
        if (call.type !== "tool-call" || calls.has(call.callId) || !conversation.tools.some(namespace => namespace.name === call.namespace && namespace.tools.some(tool => tool.name === call.name))) throw new Error("INVALID_PROVIDER_TOOL");
        JSON.parse(call.argumentsJson);
        calls.add(call.callId);
        yield call;
      }
    } else if (frame.type === "error") { yield providerFailure(frame, 200); return; }
  }
  yield { type: "interrupted" };
}
