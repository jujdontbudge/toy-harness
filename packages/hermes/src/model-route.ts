import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkViewSchema, modelRoleSchema, modelRoutePolicySchema, modelRouteProviderEventSchema, modelRouteReceiptSchema, modelRouteSelectInputSchema, modelRouteSelectionSchema, opsErrorMessages, modelRouteDelegationInputSchema, modelRouteDelegationReceiptSchema, researchSkillPinSchema, loadedResearchSkillSchema, researchSkillResourcePathSchema, codexDelegationRequestSchema, codexDelegationEventSchema, codexDelegationTaskSchema } from "@toy/contracts";
import type { CheckViewV1, ModelRouteConversationV1, ModelRouteHttpTransport, ModelRouteProviderEventV1, ModelRouteReceiptV1, ModelRouteSelectInputV1, ModelRouteSelectionV1, ModelRouteSettingsV1, ModelRouteStreamEventV1, ModelRouteUsageV1, ModelRouteDelegationInputV1, ModelRouteDelegationReceiptV1, LoadedResearchSkillV1, ResearchSkillResourcePathV1, ResearchSkillResourceReader, CodexDelegationExecutor, OpsControlContextV1, Result } from "@toy/contracts";
import { trustedCheckoutRoot, OpsTestStack } from "@toy/ops/public";
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
  async delegationReceipt(input: ModelRouteDelegationInputV1, context: OpsControlContextV1, execute: CodexDelegationExecutor, readResource: ResearchSkillResourceReader = path => {
    try { return readFileSync(join(trustedCheckoutRoot(), "evidence/skills/mattpocock-research", path)); } catch { return null; }
  }): Promise<Result<ModelRouteDelegationReceiptV1>> {
    const request = modelRouteDelegationInputSchema.safeParse(input);
    if (!request.success) return { ok: false, error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false } };
    const owned = OpsTestStack.inspect(context);
    if (!owned.ok) return owned;
    const world = owned.data.result;
    if (!world?.ready || world.release !== "R0" || world.clock !== "fake" || world.model !== "fake") return { ok: false, error: { module: "ops", code: "UNAUTHORIZED", message: opsErrorMessages.UNAUTHORIZED, retryable: false } };
    const selection = ModelRoute.select({ role: request.data.purpose === "research" ? "research" : "child", arm: "original" });
    if (!selection.ok) return selection;
    const receipt = (state: ModelRouteDelegationReceiptV1["state"], reasonCode: ModelRouteDelegationReceiptV1["reasonCode"], skill: LoadedResearchSkillV1 | null, invocation: ModelRouteReceiptV1 | null, taskDigest: string | null, requestDigest: string | null): Result<ModelRouteDelegationReceiptV1> => ({ ok: true, data: modelRouteDelegationReceiptSchema.parse({ requestId: request.data.requestId, purpose: request.data.purpose, executionBackend: "codex_exec", state, reasonCode, skill, invocation, taskDigest, requestDigest, nativeExecutionVerified: false, acceptanceComplete: false }) });
    try {
      let skill: LoadedResearchSkillV1 | null = null;
      const resources = new Map<ResearchSkillResourcePathV1, Uint8Array>();
      if (request.data.purpose === "research") {
        const pin = researchSkillPinSchema.parse(JSON.parse(readFileSync(join(trustedCheckoutRoot(), "behavior/research-skill.json"), "utf8")));
        for (const resource of [{ path: "SKILL.md", digest: pin.contentDigest }, ...pin.resources]) {
          const path = researchSkillResourcePathSchema.parse(resource.path);
          const bytes = readResource(path);
          if (bytes === null) return receipt("refused", "RESEARCH_SKILL_UNAVAILABLE", null, null, null, null);
          if (createHash("sha256").update(bytes).digest("hex") !== resource.digest) return receipt("refused", "RESEARCH_SKILL_MISMATCH", null, null, null, null);
          resources.set(path, bytes);
        }
        skill = loadedResearchSkillSchema.parse({ repository: pin.repository, sourcePath: pin.sourcePath, sourceCommit: pin.sourceCommit, contentDigest: pin.contentDigest, loadedDigest: pin.contentDigest, semanticVersion: pin.semanticVersion, resources: pin.resources });
      }
      const workspace = mkdtempSync(join(trustedCheckoutRoot(), "build/.toy-r0-fixtures", world.stackId, "delegation-"));
      const task = JSON.stringify(codexDelegationTaskSchema.parse({ requestId: request.data.requestId, objective: request.data.objective, role: selection.data.role, route: selection.data.settings, skill, scope: "r0-feasibility", depth: 1 }));
      writeFileSync(join(workspace, "task.json"), task, { mode: 0o600, flag: "wx" });
      writeFileSync(join(workspace, "AGENTS.md"), "# Toy delegated task\n\nRead task.json. Follow the supplied role route. Do not spawn children, change model/provider/tier, use paid keys or fallback, or read outside this export.\n" + (skill === null ? "" : "The protected parent applied the pinned research procedure. Read evidence/skills/mattpocock-research/SKILL.md; perform its leaf investigation against primary sources and write one cited Markdown result in reports/.\n"), { mode: 0o600, flag: "wx" });
      mkdirSync(join(workspace, "reports"), { mode: 0o700 });
      if (skill !== null) {
        const directory = join(workspace, "evidence/skills/mattpocock-research");
        mkdirSync(join(directory, "agents"), { recursive: true, mode: 0o700 });
        for (const [path, bytes] of resources) writeFileSync(join(directory, path), bytes, { mode: 0o400, flag: "wx" });
      }
      const execution = codexDelegationRequestSchema.parse({ requestId: request.data.requestId, purpose: request.data.purpose, executionBackend: "codex_exec", workspace, requested: selection.data, taskDigest: createHash("sha256").update(task).digest("hex"), skill,
        arguments: ["exec", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "--model", selection.data.settings.model, "--sandbox", "workspace-write", "--cd", workspace, "--json", "--color", "never", "-c", "model_reasoning_effort=\"" + selection.data.settings.effort + "\"", "-c", "service_tier=\"fast\"", "-c", "features.fast_mode=true", "-c", "approval_policy=\"never\"", "-c", "model_provider=\"openai\"", "-c", "web_search=\"live\"", "-"] });
      const signal = AbortSignal.timeout(context.timeoutMs);
      async function* observations(): AsyncGenerator<ModelRouteProviderEventV1> {
        for await (const raw of execute(execution, signal)) {
          const event = codexDelegationEventSchema.parse(raw);
          yield event.type === "route" ? { type: "route", settings: { model: event.model, effort: event.effort, serviceTier: event.serviceTier === "fast" ? "priority" : "default" } } : event;
        }
      }
      for await (const event of ModelRoute.normalize(selection.data, observations(), signal)) if (event.type === "receipt") return receipt(event.receipt.completion === "complete" ? "observed" : "refused", event.receipt.completion === "complete" ? "DELEGATION_ROUTE_OBSERVED" : "DELEGATION_ROUTE_REFUSED", skill, event.receipt, execution.taskDigest, createHash("sha256").update(JSON.stringify(execution)).digest("hex"));
      return receipt("refused", "DELEGATION_ROUTE_REFUSED", skill, null, execution.taskDigest, null);
    } catch { return { ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } }; }
  },
  inspect(): CheckViewV1 {
    const routes = [...modelRoleSchema.options.map(role => ModelRoute.select({ role, arm: "original" })), ModelRoute.select({ role: "background", arm: "experimental-background-high-standard" })];
    const selected = routes.flatMap(route => route.ok ? [route.data] : []);
    return checkViewSchema.parse({ id: "read.model-route-policy", owner: "hermes", state: selected.length === routes.length ? "PASS" : "FAIL", checkedAt: new Date().toISOString(), reasonCode: selected.length === routes.length ? "MODEL_POLICY_VALID_INFERENCE_PENDING" : "MODEL_POLICY_INVALID", prerequisite: JSON.stringify({ requestedRoutes: selected.map(route => ({ role: route.role, arm: route.arm, ...route.settings })), localOutputReservationTokens: 4096, outputLimitKind: "estimate", providerOutputCap: null, paidFallbackPermitted: false, liveInferenceAttested: false }), nextCommandId: "probe.run", links: { recordRefs: [], observations: [], artifactDigests: [...new Set(selected.map(route => route.policyDigest))] } });
  }
};
