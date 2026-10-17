import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkViewSchema, modelRoleSchema, modelRoutePolicySchema, modelRouteProviderEventSchema, modelRouteReceiptSchema, modelRouteSelectInputSchema, modelRouteSelectionSchema, opsErrorMessages } from "@toy/contracts";
import type { CheckViewV1, ModelRouteConversationV1, ModelRouteHttpTransport, ModelRouteProviderEventV1, ModelRouteReceiptV1, ModelRouteSelectInputV1, ModelRouteSelectionV1, ModelRouteSettingsV1, ModelRouteStreamEventV1, ModelRouteUsageV1, Result } from "@toy/contracts";
import { trustedCheckoutRoot } from "@toy/ops/public";
import { createResponsesTransport, responsesEvents } from "./responses.js";

export const ModelRoute = {
  transport: createResponsesTransport,
  invoke(selection: ModelRouteSelectionV1, conversation: ModelRouteConversationV1, transport: ModelRouteHttpTransport, signal: AbortSignal): AsyncGenerator<ModelRouteStreamEventV1> {
    const requested = modelRouteSelectionSchema.parse(selection);
    const current = ModelRoute.select({ role: requested.role, arm: requested.arm });
    if (!current.ok || current.data.policyDigest !== requested.policyDigest || JSON.stringify(current.data.settings) !== JSON.stringify(requested.settings)) throw new Error("MODEL_POLICY_CHANGED");
    return ModelRoute.normalize(requested, responsesEvents(requested, conversation, transport, signal), signal);
  },
  select(input: ModelRouteSelectInputV1): Result<ModelRouteSelectionV1> {
    const request = modelRouteSelectInputSchema.safeParse(input);
    if (!request.success || request.data.arm !== "original" && !["background", "cron"].includes(request.data.role)) return { ok: false, error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false } };
    try {
      const content = readFileSync(join(trustedCheckoutRoot(), "behavior/models.yaml"));
      const policy = modelRoutePolicySchema.parse(JSON.parse(content.toString("utf8")));
      const settings = request.data.arm === "original" ? policy.original[request.data.role] : policy.experimentalBackgroundHighStandard;
      return { ok: true, data: modelRouteSelectionSchema.parse({ ...request.data, provider: policy.provider, settings, policyDigest: createHash("sha256").update(content).digest("hex"), localOutputReservationTokens: 4096, outputLimitKind: "estimate", providerOutputCap: null, paidFallbackPermitted: false }) };
    } catch { return { ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } }; }
  },
  async *normalize(selection: ModelRouteSelectionV1, events: AsyncIterable<ModelRouteProviderEventV1>, signal: AbortSignal): AsyncGenerator<ModelRouteStreamEventV1> {
    const requested = modelRouteSelectionSchema.parse(selection);
    let observed: ModelRouteSettingsV1 | null = null;
    let usage: ModelRouteUsageV1 | null = null;
    let terminal: ModelRouteReceiptV1["terminal"] = "interrupted";
    let reasonCode: ModelRouteReceiptV1["reasonCode"] = "stream_interrupted";
    let outputStarted = false;
    try {
      for await (const raw of events) {
        if (signal.aborted) break;
        const event = modelRouteProviderEventSchema.parse(raw);
        if (event.type === "route") {
          observed = event.settings;
          if (observed.model !== requested.settings.model || observed.effort !== requested.settings.effort || observed.serviceTier !== requested.settings.serviceTier) { terminal = "failed"; reasonCode = "route_mismatch"; break; }
        }
        if (event.type === "output" || event.type === "tool-call") {
          if (observed === null) { terminal = "failed"; reasonCode = "route_unobserved"; break; }
          outputStarted = true;
        }
        if (event.type === "usage") usage = event.usage;
        if (event.type === "completed" || event.type === "failed" || event.type === "interrupted") {
          terminal = event.type;
          reasonCode = event.type === "failed" ? event.code : event.type === "interrupted" ? "stream_interrupted" : null;
          break;
        }
        yield event;
      }
    } catch { terminal = "failed"; reasonCode = "protocol_invalid"; }
    const complete = terminal === "completed" && observed !== null && usage !== null && !signal.aborted;
    if (terminal === "completed" && observed === null) reasonCode = "route_unobserved";
    else if (terminal === "completed" && usage === null) reasonCode = "usage_unavailable";
    if (signal.aborted) { terminal = "interrupted"; reasonCode = "stream_interrupted"; }
    yield { type: "receipt", receipt: modelRouteReceiptSchema.parse({ requested, observed, terminal, completion: complete ? "complete" : "pending", usage: complete ? usage : null, usageState: complete ? "known" : "uncertain", reservationTokens: complete ? 0 : 4096, outputStarted, reasonCode, paidFallbackAttempted: false }) };
  },
  inspect(): CheckViewV1 {
    const routes = [...modelRoleSchema.options.map(role => ModelRoute.select({ role, arm: "original" })), ModelRoute.select({ role: "background", arm: "experimental-background-high-standard" })];
    const selected = routes.flatMap(route => route.ok ? [route.data] : []);
    return checkViewSchema.parse({ id: "read.model-route-policy", owner: "hermes", state: selected.length === routes.length ? "PASS" : "FAIL", checkedAt: new Date().toISOString(), reasonCode: selected.length === routes.length ? "MODEL_POLICY_VALID_INFERENCE_PENDING" : "MODEL_POLICY_INVALID", prerequisite: JSON.stringify({ requestedRoutes: selected.map(route => ({ role: route.role, arm: route.arm, ...route.settings })), localOutputReservationTokens: 4096, outputLimitKind: "estimate", providerOutputCap: null, paidFallbackPermitted: false, liveInferenceAttested: false }), nextCommandId: "probe.run", links: { recordRefs: [], observations: [], artifactDigests: [...new Set(selected.map(route => route.policyDigest))] } });
  }
};
