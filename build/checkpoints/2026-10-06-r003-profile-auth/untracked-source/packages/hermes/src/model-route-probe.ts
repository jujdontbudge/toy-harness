import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { checkViewSchema, modelRoleSchema, opsErrorMessages, registeredProbeInputSchema } from "@toy/contracts";
import type { CheckViewV1, ModelRouteConversationV1, ModelRouteHttpTransport, ModelRouteReceiptV1, ModelRouteSettingsV1, OpsControlContextV1, RegisteredProbeInputV1, RegisteredProbeOperationV1, Result } from "@toy/contracts";
import { OpsTestStack, TestProbeControl } from "@toy/ops/public";
import { ModelRoute } from "./model-route.js";

type FixtureOutcome = "completed" | "interrupted" | "failed" | "disconnected" | "cancelled" | "route-mismatch" | "route-unobserved";
const conversation: ModelRouteConversationV1 = {
  input: [
    { type: "message", role: "developer", content: "Fixed provider compatibility fixture" },
    { type: "message", role: "user", content: [{ type: "input_text", text: "Inspect fixture" }, { type: "input_image", image_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", detail: "auto" }] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "Fixed previous assistant output" }], phase: "commentary", status: "completed" },
    { type: "reasoning", encrypted_content: "fixed-external-provider-reasoning", summary: [] },
    { type: "function_call", call_id: "previous-fixture-call", name: "read", namespace: "toy", arguments: "{}" },
    { type: "function_call_output", call_id: "previous-fixture-call", output: "Fixed previous tool result" }
  ],
  tools: [{ type: "namespace", name: "toy", description: "Fixed Hermes tools", tools: [{ type: "function", name: "read", description: "Read fixed fixture", parameters: { type: "object", properties: {}, required: [], additionalProperties: false }, strict: true }] }]
};
const provider = (settings: ModelRouteSettingsV1, outcome: FixtureOutcome, cancellation: AbortController): ModelRouteHttpTransport => request => {
  if (request.model !== settings.model || request.reasoning.effort !== settings.effort || request.service_tier !== settings.serviceTier || request.store !== false || request.stream !== true || JSON.stringify(request.input) !== JSON.stringify(conversation.input) || JSON.stringify(request.tools) !== JSON.stringify(conversation.tools) || "max_output_tokens" in request || "previous_response_id" in request || "background" in request) throw new Error("FIXTURE_REQUEST_MISMATCH");
  const metadata = { id: "fixed-response", model: settings.model, reasoning: { effort: outcome === "route-mismatch" ? "high" : settings.effort }, service_tier: settings.serviceTier };
  const events: unknown[] = [];
  if (outcome !== "route-unobserved") events.push({ type: "response.created", response: metadata });
  events.push({ type: "response.output_text.delta", delta: "fixed external provider output" });
  if (outcome === "completed") events.push({ type: "response.output_item.done", item: { type: "function_call", call_id: "fixed-call", name: "read", namespace: "toy", arguments: "{}" } });
  if (outcome === "completed" || outcome === "cancelled") events.push({ type: "response.completed", response: { ...metadata, usage: { input_tokens: 17, output_tokens: 8, output_tokens_details: { reasoning_tokens: 3 } } } });
  else if (outcome === "failed") events.push({ type: "response.failed", response: { ...metadata, error: { code: "subscription_sharing_usage_limit_exceeded", message: "Must never enter receipt" } } });
  else if (outcome === "interrupted") events.push({ type: "response.incomplete", response: metadata });
  let index = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) {
    if (outcome === "cancelled" && index === 2) cancellation.abort();
    const event = events[index++];
    if (event === undefined) { controller.close(); return; }
    controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(event) + "\r\n\r\n"));
  } }, { highWaterMark: 0 });
  return Promise.resolve(new Response(body, { headers: { "content-type": "text/event-stream" } }));
};

const consume = async (input: Parameters<typeof ModelRoute.select>[0], outcome: FixtureOutcome): Promise<ModelRouteReceiptV1> => {
  const selection = ModelRoute.select(input);
  if (!selection.ok) throw new Error("FIXTURE_ROUTE_REFUSED");
  const cancellation = new AbortController();
  for await (const event of ModelRoute.invoke(selection.data, conversation, provider(selection.data.settings, outcome, cancellation), cancellation.signal)) if (event.type === "receipt") return event.receipt;
  throw new Error("FIXTURE_RECEIPT_MISSING");
};

const observation = (id: CheckViewV1["id"], receipts: ModelRouteReceiptV1[], passed: boolean): CheckViewV1 => checkViewSchema.parse({
  id, owner: "hermes", state: passed ? "PASS" : "FAIL", checkedAt: new Date().toISOString(), reasonCode: passed ? "FIXED_EXTERNAL_MODEL_FIXTURE_PASS" : "FIXED_EXTERNAL_MODEL_FIXTURE_FAIL", nextCommandId: "probe.show",
  prerequisite: JSON.stringify(receipts.map(receipt => ({ role: receipt.requested.role, arm: receipt.requested.arm, requested: receipt.requested.settings, observed: receipt.observed, terminal: receipt.terminal, completion: receipt.completion, usageState: receipt.usageState, reservationTokens: receipt.reservationTokens, providerOutputCap: receipt.requested.providerOutputCap, outputLimitKind: receipt.requested.outputLimitKind, reasonCode: receipt.reasonCode, paidFallbackAttempted: receipt.paidFallbackAttempted }))),
  links: { recordRefs: [], observations: [], artifactDigests: [createHash("sha256").update(readFileSync(new URL("./model-route-probe.js", import.meta.url))).digest("hex")] }
});

export const ModelRouteProbe = {
  async run(input: RegisteredProbeInputV1, context: OpsControlContextV1): Promise<Result<RegisteredProbeOperationV1>> {
    if (!registeredProbeInputSchema.safeParse(input).success) return { ok: false, error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false } };
    const policy = input.caseId === "model-route-policy" && ["AT-hermes-config-1", "AT-hermes-config-76", "AT-hermes-config-77"].includes(input.probeId);
    const stream = input.caseId === "model-route-stream" && ["AT-hermes-config-40", "AT-self-improvement-58"].includes(input.probeId);
    if (!policy && !stream) return { ok: false, error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false } };
    const owned = OpsTestStack.inspect(context);
    if (!owned.ok) return owned;
    try {
      const checks: CheckViewV1[] = [];
      if (policy) {
        for (const role of modelRoleSchema.options) {
          const receipt = await consume({ role, arm: "original" }, "completed");
          checks.push(observation("read.model-route-policy", [receipt], receipt.completion === "complete" && receipt.usageState === "known" && !receipt.paidFallbackAttempted));
        }
        const receipt = await consume({ role: "background", arm: "experimental-background-high-standard" }, "completed");
        const original = ModelRoute.select({ role: "background", arm: "original" });
        const forbidden = ModelRoute.select({ role: "foreground", arm: "experimental-background-high-standard" });
        checks.push(observation("read.model-route-policy", [receipt], receipt.requested.settings.effort === "high" && receipt.requested.settings.serviceTier === "default" && original.ok && original.data.settings.effort === "max" && original.data.settings.serviceTier === "priority" && !forbidden.ok));
      }
      if (stream) {
        for (const outcome of ["interrupted", "failed", "disconnected", "cancelled"] as const) {
          const receipt = await consume({ role: "background", arm: "original" }, outcome);
          checks.push(observation("read.model-route-policy", [receipt], receipt.outputStarted && receipt.completion === "pending" && receipt.usageState === "uncertain" && receipt.usage === null && receipt.reservationTokens === 4096 && receipt.requested.outputLimitKind === "estimate" && receipt.requested.providerOutputCap === null && !receipt.paidFallbackAttempted));
        }
        for (const outcome of ["route-mismatch", "route-unobserved"] as const) {
          const receipt = await consume({ role: "background", arm: "original" }, outcome);
          checks.push(observation("read.model-route-policy", [receipt], !receipt.outputStarted && receipt.terminal === "failed" && receipt.completion === "pending" && receipt.reservationTokens === 4096 && receipt.reasonCode === outcome.replaceAll("-", "_")));
        }
      }
      return TestProbeControl.run(input, context, checks);
    } catch { return { ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } }; }
  }
};
