import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkViewSchema, modelRoleSchema, modelRouteSelectionSchema, opsErrorMessages, registeredProbeInputSchema, registeredCliAcceptanceManifestInventory, researchSkillPinSchema, codexDelegationTaskSchema } from "@toy/contracts";
import type { CheckViewV1, ModelRouteConversationV1, ModelRouteHttpTransport, ModelRouteReceiptV1, ModelRouteSettingsV1, OpsControlContextV1, RegisteredProbeInputV1, RegisteredProbeOperationV1, CodexDelegationExecutor, ModelRouteDelegationInputV1, ResearchSkillResourceReader, Result } from "@toy/contracts";
import { OpsTestStack, TestProbeControl, trustedCheckoutRoot } from "@toy/ops/public";
import { ModelRoute } from "./model-route.js";

const digest = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
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

const refusedBeforeSend = async (selection: unknown): Promise<boolean> => {
  const request = modelRouteSelectionSchema.safeParse(selection);
  if (!request.success) return true;
  let sends = 0;
  const externalHttp: ModelRouteHttpTransport = () => { sends++; return Promise.reject(new Error("UNEXPECTED_FIXTURE_SEND")); };
  try {
    for await (const event of ModelRoute.invoke(request.data, conversation, externalHttp, new AbortController().signal)) if (event.type === "receipt") break;
    return false;
  } catch { return sends === 0; }
};

export const ModelRouteProbe = {
  async run(input: RegisteredProbeInputV1, context: OpsControlContextV1): Promise<Result<RegisteredProbeOperationV1>> {
    if (!registeredProbeInputSchema.safeParse(input).success) return { ok: false, error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false } };
    if (input.probeId === "AT-obligations-75" && input.caseId === undefined) return delegationProbe(input, context);
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
        const foreground = ModelRoute.select({ role: "foreground", arm: "original" });
        const research = ModelRoute.select({ role: "research", arm: "original" });
        const child = ModelRoute.select({ role: "child", arm: "original" });
        if (!foreground.ok || !research.ok || !child.ok) throw new Error("FIXTURE_ROUTE_REFUSED");
        const candidates: unknown[] = [
          { ...foreground.data, settings: { ...foreground.data.settings, effort: "high" } },
          { ...research.data, settings: { ...research.data.settings, effort: "max" } },
          { ...child.data, settings: { ...child.data.settings, model: "gpt-6.1-sol" } },
          { ...foreground.data, arm: "experimental-background-high-standard", settings: receipt.requested.settings },
          { ...foreground.data, policyDigest: "0".repeat(64) }
        ];
        const rejected = [];
        for (const candidate of candidates) rejected.push(await refusedBeforeSend(candidate));
        checks.push(checkViewSchema.parse({
          id: "read.model-route-policy", owner: "hermes", state: rejected.every(Boolean) ? "PASS" : "FAIL", checkedAt: new Date().toISOString(),
          reasonCode: "ROLE_ARM_AND_CURRENT_POLICY_SEND_GUARDS", nextCommandId: "probe.show",
          prerequisite: JSON.stringify({ invalidSelections: candidates.length, refusalBoundaries: ["contract", "contract", "contract", "contract", "current-policy"], refusedBeforeProviderRequest: rejected }),
          links: { recordRefs: [], observations: [], artifactDigests: [createHash("sha256").update(readFileSync(new URL("./model-route-probe.js", import.meta.url))).digest("hex")] }
        }));
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

const delegationProbe = async (input: RegisteredProbeInputV1, context: OpsControlContextV1): Promise<Result<RegisteredProbeOperationV1>> => {
  const cases = ["research-route-observed", "research-route-missing", "research-route-luna", "research-route-wrong-effort", "research-route-wrong-tier", "research-skill-missing", "research-skill-wrong-bytes", "ordinary-implementation-luna", "module-local-override-refused"];
  const manifest = registeredCliAcceptanceManifestInventory.find(entry => entry.id === input.probeId);
  if (!manifest || manifest.scenarioId !== "delegation.route-skill" || JSON.stringify(manifest.mandatoryCases.map(entry => entry.id)) !== JSON.stringify(cases)) return { ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } };
  const pin = researchSkillPinSchema.parse(JSON.parse(readFileSync(join(trustedCheckoutRoot(), "behavior/research-skill.json"), "utf8")));
  const checks: CheckViewV1[] = [];
  for (const caseId of cases) {
    const purpose = caseId === "ordinary-implementation-luna" ? "implementation" : "research";
    let sends = 0;
    let exportReadback = false;
    let nativeArgumentsMatched = false;
    const externalCli: CodexDelegationExecutor = async function* (request) {
      sends++;
      const expectedModel = purpose === "research" ? "gpt-6.1-sol" : "gpt-6-luna";
      const expectedEffort = purpose === "research" ? "medium" : "max";
      const taskBytes = await readFile(join(request.workspace, "task.json"));
      const task = codexDelegationTaskSchema.parse(JSON.parse(taskBytes.toString("utf8")));
      const instructions = readFileSync(join(request.workspace, "AGENTS.md"), "utf8");
      exportReadback = digest(taskBytes) === request.taskDigest && task.role === (purpose === "research" ? "research" : "child") && task.route.model === expectedModel && task.route.effort === expectedEffort && task.route.serviceTier === "priority" && task.depth === 1 && instructions.includes("Do not spawn children");
      if (purpose === "research") exportReadback = exportReadback && task.skill?.sourceCommit === pin.sourceCommit && request.skill?.loadedDigest === pin.contentDigest && digest(readFileSync(join(request.workspace, "evidence/skills/mattpocock-research/SKILL.md"))) === pin.contentDigest && pin.resources.every(resource => digest(readFileSync(join(request.workspace, "evidence/skills/mattpocock-research", resource.path))) === resource.digest);
      else exportReadback = exportReadback && task.skill === null && request.skill === null;
      const argv = request.arguments;
      nativeArgumentsMatched = request.executionBackend === "codex_exec" && argv[0] === "exec" && argv.includes("--ignore-user-config") && argv.includes("--ignore-rules") && argv.includes("--json") && argv[argv.indexOf("--model") + 1] === expectedModel && argv[argv.indexOf("--sandbox") + 1] === "workspace-write" && argv[argv.indexOf("--cd") + 1] === request.workspace && argv.includes("model_reasoning_effort=\"" + expectedEffort + "\"") && argv.includes("service_tier=\"fast\"") && argv.includes("features.fast_mode=true") && argv.includes("approval_policy=\"never\"") && argv.includes("model_provider=\"openai\"") && !argv.some(value => value.startsWith("--dangerously-") || value === "--add-dir" || value === "--approve-for-me");
      if (!exportReadback || !nativeArgumentsMatched) throw new Error("EXTERNAL_CLI_REQUEST_MISMATCH");
      if (caseId !== "research-route-missing") yield { type: "route", model: caseId === "research-route-luna" ? "gpt-6-luna" : expectedModel, effort: caseId === "research-route-wrong-effort" ? "max" : expectedEffort, serviceTier: caseId === "research-route-wrong-tier" ? "default" : "fast" };
      yield { type: "output", text: "Fixed external CLI result" };
      yield { type: "usage", usage: { inputTokens: 17, outputTokens: 8, reasoningTokens: 3 } };
      yield { type: "completed" };
    };
    const resourceReader: ResearchSkillResourceReader = path => path === "SKILL.md" && caseId === "research-skill-missing" ? null : path === "SKILL.md" && caseId === "research-skill-wrong-bytes" ? new TextEncoder().encode("Fixed corrupted upstream bytes") : readFileSync(join(trustedCheckoutRoot(), "evidence/skills/mattpocock-research", path));
    const request: ModelRouteDelegationInputV1 = { requestId: randomUUID(), purpose, objective: "Investigate only the seeded fixture against primary sources; preserve the separate ordinary implementation route." };
    const overridden = { ...request, settings: { model: "gpt-6-luna", effort: "max", serviceTier: "priority" } };
    const result = await ModelRoute.delegationReceipt(caseId === "module-local-override-refused" ? overridden : request, context, externalCli, resourceReader);
    const successful = caseId === "research-route-observed" || caseId === "ordinary-implementation-luna";
    const missingSkill = caseId === "research-skill-missing";
    const wrongSkill = caseId === "research-skill-wrong-bytes";
    let passed = false;
    if (caseId === "module-local-override-refused") passed = !result.ok && result.error.code === "INVALID_INPUT" && sends === 0;
    else if (result.ok) {
      const receipt = result.data;
      const observed = receipt.invocation?.observed;
      passed = !receipt.nativeExecutionVerified && !receipt.acceptanceComplete && (successful
        ? receipt.state === "observed" && sends === 1 && exportReadback && nativeArgumentsMatched && observed?.model === (purpose === "research" ? "gpt-6.1-sol" : "gpt-6-luna") && observed.effort === (purpose === "research" ? "medium" : "max") && observed.serviceTier === "priority" && (purpose === "research" ? receipt.skill?.sourceCommit === pin.sourceCommit && receipt.skill.loadedDigest === pin.contentDigest : receipt.skill === null)
        : missingSkill || wrongSkill ? receipt.state === "refused" && sends === 0 && receipt.reasonCode === (missingSkill ? "RESEARCH_SKILL_UNAVAILABLE" : "RESEARCH_SKILL_MISMATCH") && receipt.invocation === null
          : receipt.state === "refused" && sends === 1 && receipt.invocation?.completion === "pending" && receipt.invocation.outputStarted === false && receipt.invocation.reasonCode === (caseId === "research-route-missing" ? "route_unobserved" : "route_mismatch"));
    }
    const receipt = result.ok ? result.data : null;
    checks.push(checkViewSchema.parse({ id: "read.model-route-policy", owner: "hermes", state: passed ? "PASS" : "FAIL", checkedAt: new Date().toISOString(), reasonCode: passed ? "DELEGATION_ROUTE_SKILL_DIAGNOSTIC_PASS" : "DELEGATION_ROUTE_SKILL_DIAGNOSTIC_FAIL", nextCommandId: "probe.show", prerequisite: JSON.stringify({ caseId, actualUid: process.getuid?.() ?? null, externalCliSends: sends, exportReadback, nativeArgumentsMatched, receipt, errorCode: result.ok ? null : result.error.code, fakeExternalCli: true, liveProviderSends: 0, wholeATComplete: false }), links: { recordRefs: [], observations: [], artifactDigests: [pin.contentDigest, digest(readFileSync(new URL("./model-route.js", import.meta.url))), digest(readFileSync(new URL("./model-route-probe.js", import.meta.url)))] } }));
  }
  return TestProbeControl.run(input, context, checks);
};
