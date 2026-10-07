import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkViewSchema, modelRoleSchema, modelRouteSelectionSchema, opsErrorMessages, registeredProbeInputSchema, registeredCliAcceptanceManifestInventory, researchSkillPinSchema, codexDelegationTaskSchema, researchAttentionDecisionSchema, researchAttentionDecisionIdSchema, researchComponentComparisonV3Schema } from "@toy/contracts";
import type { CheckViewV1, ModelRouteConversationV1, ModelRouteHttpTransport, ModelRouteReceiptV1, ModelRouteSettingsV1, OpsControlContextV1, RegisteredProbeInputV1, RegisteredProbeOperationV1, CodexDelegationExecutor, ModelRouteDelegationInputV1, ResearchSkillResourceReader, ResearchAttentionDecisionV1, ResearchComponentComparisonCheckV2, ResearchComponentInspectionV1, ResearchDocumentOverlayV1, ResearchRegisterInspectionV3, Result } from "@toy/contracts";
import { OpsTestStack, TestProbeControl, trustedCheckoutRoot } from "@toy/ops/public";
import { EngineeringControl } from "@toy/self-improvement/public";
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
    if (input.caseId === undefined && registeredCliAcceptanceManifestInventory.some(entry => entry.id === input.probeId && entry.owner === "hermes" && entry.scenarioId === "research.component-receipts")) return componentReceiptProbe(input, context);
    if (input.caseId === undefined && input.probeId === "AT-attention-66") return attentionProbe(input, context);
    if (input.caseId === undefined && registeredCliAcceptanceManifestInventory.some(entry => entry.id === input.probeId && entry.owner === "hermes" && entry.scenarioId === "delegation.route-skill")) return delegationProbe(input, context);
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

const delegationFixture = async (caseId: string, purpose: ModelRouteDelegationInputV1["purpose"], context: OpsControlContextV1, objective = "Investigate only the seeded fixture against primary sources; preserve the separate ordinary implementation route.") => {
  const pin = researchSkillPinSchema.parse(JSON.parse(readFileSync(join(trustedCheckoutRoot(), "behavior/research-skill.json"), "utf8")));
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
    exportReadback = digest(taskBytes) === request.taskDigest && task.role === (purpose === "research" ? "research" : "child") && task.route.model === expectedModel && task.route.effort === expectedEffort && task.route.serviceTier === "priority" && task.depth === 1 && task.objective === objective && instructions.includes("Do not spawn children");
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
  const request: ModelRouteDelegationInputV1 = { requestId: randomUUID(), purpose, objective };
  const overridden = { ...request, settings: { model: "gpt-6-luna", effort: "max", serviceTier: "priority" } };
  const result = await ModelRoute.delegationReceipt(caseId === "module-local-override-refused" ? overridden : request, context, externalCli, resourceReader);
  return { result, sends, exportReadback, nativeArgumentsMatched };
};

type LifeStoreSource = {
  component: ResearchComponentInspectionV1;
  archive: ResearchRegisterInspectionV3["reports"][number];
  originalDigest: string;
  required: ResearchComponentComparisonCheckV2;
};

type LifeStoreGateReadback = {
  scope: "route-skill-subgate-only";
  decisionState: "PASS" | "BLOCKED";
  findings: string[];
  missingValidationIds: string[];
  comparisonDigest: string | null;
  reportKey: string;
  originalDigest: string;
  contentDigest: string;
  baselineMissingRequirementCount: number;
  archiveBound: boolean;
  registerAdmission: "BLOCKED";
  acceptanceComplete: false;
  wholeATsPassedCount: number;
  expectedRouteSkillMissingIds: string[];
  routeSkillSubgatePassed: boolean;
};

const delegationProbe = async (input: RegisteredProbeInputV1, context: OpsControlContextV1): Promise<Result<RegisteredProbeOperationV1>> => {
  const cases = ["research-route-observed", "research-route-missing", "research-route-luna", "research-route-wrong-effort", "research-route-wrong-tier", "research-skill-missing", "research-skill-wrong-bytes", "ordinary-implementation-luna", "module-local-override-refused"];
  const manifest = registeredCliAcceptanceManifestInventory.find(entry => entry.id === input.probeId);
  if (!manifest || manifest.scenarioId !== "delegation.route-skill" || JSON.stringify(manifest.mandatoryCases.map(entry => entry.id)) !== JSON.stringify(cases)) return { ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } };
  const isLifeStore = input.probeId === "AT-lifestore-47";
  const lifeStoreObjective = "Compare only the seeded Life Store A01 decision and primary evidence; produce no live research or adoption.";
  let lifeStoreSource: LifeStoreSource | null = null;
  if (isLifeStore) {
    const baseline = EngineeringControl.checkResearch({ release: "R0" }, context);
    if (!baseline.ok) return baseline;
    const component = baseline.data.components.find(entry => entry.id === "A01");
    const archive = baseline.data.reports.find(entry => component?.reportKeys.includes(entry.key) === true && entry.originalDigest !== null);
    const required = baseline.data.componentDecisions.find(entry => entry.componentId === "A01");
    if (!component || !archive || archive.originalDigest === null || !required || required.comparisonDigest !== null || !component.reportKeys.includes(archive.key)) return { ok: false, error: { module: "ops", code: "ARTIFACT_MISMATCH", message: opsErrorMessages.ARTIFACT_MISMATCH, retryable: false } };
    lifeStoreSource = { component, archive, originalDigest: archive.originalDigest, required };
  }
  const pin = researchSkillPinSchema.parse(JSON.parse(readFileSync(join(trustedCheckoutRoot(), "behavior/research-skill.json"), "utf8")));
  const checks: CheckViewV1[] = [];
  for (const caseId of cases) {
    const purpose = caseId === "ordinary-implementation-luna" ? "implementation" : "research";
    const fixture = isLifeStore
      ? await delegationFixture(caseId, purpose, context, lifeStoreObjective)
      : await delegationFixture(caseId, purpose, context);
    const { result, sends, exportReadback, nativeArgumentsMatched } = fixture;
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
    if (isLifeStore && caseId === "ordinary-implementation-luna") passed = passed && receipt?.purpose === "implementation" && receipt.invocation?.requested.role === "child" && receipt.invocation.requested.settings.model === "gpt-6-luna" && receipt.invocation.requested.settings.effort === "max" && receipt.invocation.requested.settings.serviceTier === "priority" && receipt.skill === null;
    let lifeStoreGate: LifeStoreGateReadback | null = null;
    if (lifeStoreSource) {
      const report = researchComponentComparisonV3Schema.parse({
        scope: "required-research-component",
        componentId: "A01",
        executionReceipt: receipt,
        mappedRequirements: [],
        options: [],
        evidence: [],
        selectedOptionId: "unselected-fixture",
        unresolvedFacts: [],
        acceptanceIds: [],
        validationPlan: "",
        releaseGate: lifeStoreSource.component.releaseGate,
        validations: []
      });
      const markdown = "# Incomplete seeded Life Store A01 route and skill diagnostic\n\n```ResearchComponentComparisonV3\n" + JSON.stringify(report) + "\n```\n";
      const contentDigest = digest(markdown);
      const overlay: ResearchDocumentOverlayV1 = { reportKey: lifeStoreSource.archive.key, originalDigest: lifeStoreSource.originalDigest, contentDigest, markdown };
      const inspection = EngineeringControl.checkResearch({ release: "R0" }, context, [overlay]);
      if (!inspection.ok) return inspection;
      const decision = inspection.data.componentDecisions.find(entry => entry.componentId === "A01");
      const bound = inspection.data.reports.find(entry => entry.key === lifeStoreSource.archive.key);
      if (!decision || !bound) return { ok: false, error: { module: "ops", code: "ARTIFACT_MISMATCH", message: opsErrorMessages.ARTIFACT_MISMATCH, retryable: false } };
      const archiveBound = bound.origin === "seeded_document" && bound.path === lifeStoreSource.archive.path && bound.originalDigest === lifeStoreSource.originalDigest && bound.digest === contentDigest;
      const routeOnly = ["research-route-missing", "research-route-luna", "research-route-wrong-effort", "research-route-wrong-tier"].includes(caseId);
      const expectedRouteSkillMissingIds = caseId === "research-route-observed" ? [] : routeOnly ? ["ROUTE:R0:A01"] : ["ROUTE:R0:A01", "SKILL:R0:A01"];
      const actualRouteSkillMissingIds = decision.missingValidationIds.filter(id => id === "ROUTE:R0:A01" || id === "SKILL:R0:A01");
      const routeSkillMatches = JSON.stringify([...actualRouteSkillMissingIds].sort()) === JSON.stringify([...expectedRouteSkillMissingIds].sort());
      const registerBlocked = inspection.data.admission === "BLOCKED" && !inspection.data.acceptanceComplete && inspection.data.wholeATsPassed.length === 0;
      const routeSkillSubgatePassed = archiveBound && decision.comparisonDigest === digest(JSON.stringify(report)) && routeSkillMatches && registerBlocked;
      lifeStoreGate = {
        scope: "route-skill-subgate-only",
        decisionState: decision.state,
        findings: decision.findings,
        missingValidationIds: decision.missingValidationIds,
        comparisonDigest: decision.comparisonDigest,
        reportKey: bound.key,
        originalDigest: lifeStoreSource.originalDigest,
        contentDigest,
        baselineMissingRequirementCount: lifeStoreSource.required.missingRequirementIds.length,
        archiveBound,
        registerAdmission: inspection.data.admission,
        acceptanceComplete: inspection.data.acceptanceComplete,
        wholeATsPassedCount: inspection.data.wholeATsPassed.length,
        expectedRouteSkillMissingIds,
        routeSkillSubgatePassed
      };
      passed = passed && routeSkillSubgatePassed;
    }
    if (isLifeStore && (!lifeStoreSource || !lifeStoreGate)) return { ok: false, error: { module: "ops", code: "ARTIFACT_MISMATCH", message: opsErrorMessages.ARTIFACT_MISMATCH, retryable: false } };
    const prerequisite = isLifeStore && lifeStoreSource && lifeStoreGate
      ? JSON.stringify({ caseId, actualUid: process.getuid?.() ?? null, objective: lifeStoreObjective, externalCliSends: sends, exportReadback, nativeArgumentsMatched, receiptDigest: receipt ? digest(JSON.stringify(receipt)) : null, receiptReadback: receipt ? { purpose: receipt.purpose, state: receipt.state, requestedRole: receipt.invocation?.requested.role ?? null, requestedArm: receipt.invocation?.requested.arm ?? null, requestedModel: receipt.invocation?.requested.settings.model ?? null, requestedEffort: receipt.invocation?.requested.settings.effort ?? null, requestedTier: receipt.invocation?.requested.settings.serviceTier ?? null, observedModel: receipt.invocation?.observed?.model ?? null, observedEffort: receipt.invocation?.observed?.effort ?? null, observedTier: receipt.invocation?.observed?.serviceTier ?? null, completion: receipt.invocation?.completion ?? null, skillSourceCommit: receipt.skill?.sourceCommit ?? null, skillContentDigest: receipt.skill?.contentDigest ?? null, skillLoadedDigest: receipt.skill?.loadedDigest ?? null, skillResourceCount: receipt.skill?.resources.length ?? 0, nativeExecutionVerified: receipt.nativeExecutionVerified, acceptanceComplete: receipt.acceptanceComplete } : null, errorCode: result.ok ? null : result.error.code, a01: lifeStoreGate, fakeExternalCli: true, liveProviderSends: 0, wholeATComplete: false })
      : JSON.stringify({ caseId, actualUid: process.getuid?.() ?? null, externalCliSends: sends, exportReadback, nativeArgumentsMatched, receipt, errorCode: result.ok ? null : result.error.code, fakeExternalCli: true, liveProviderSends: 0, wholeATComplete: false });
    if (isLifeStore && prerequisite.length > 2000) return { ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } };
    const artifactDigests = [pin.contentDigest, ...(lifeStoreGate ? [lifeStoreGate.contentDigest, lifeStoreGate.originalDigest] : []), digest(readFileSync(new URL("./model-route.js", import.meta.url))), digest(readFileSync(new URL("./model-route-probe.js", import.meta.url)))];
    checks.push(checkViewSchema.parse({ id: "read.model-route-policy", owner: "hermes", state: passed ? "PASS" : "FAIL", checkedAt: new Date().toISOString(), reasonCode: passed ? "DELEGATION_ROUTE_SKILL_DIAGNOSTIC_PASS" : "DELEGATION_ROUTE_SKILL_DIAGNOSTIC_FAIL", nextCommandId: "probe.show", prerequisite, links: { recordRefs: [], observations: [], artifactDigests } }));
  }
  return TestProbeControl.run(input, context, checks);
};

const attentionProbe = async (input: RegisteredProbeInputV1, context: OpsControlContextV1): Promise<Result<RegisteredProbeOperationV1>> => {
  const cases = ["complete-set", ...researchAttentionDecisionIdSchema.options.map(id => "missing-" + id), "duplicate-decision", "missing-primary-evidence", "missing-required-option", "missing-tradeoffs", "missing-acceptance-link", "unrelated-acceptance-link", "missing-requirement", "unsupported-selection", "missing-outside-option", "unsupported-outside-option", "missing-route-receipt", "wrong-observed-model", "wrong-observed-reasoning", "wrong-observed-tier", "missing-research-skill", "wrong-skill-revision", "wrong-loaded-skill-digest"];
  const manifest = registeredCliAcceptanceManifestInventory.find(entry => entry.id === input.probeId);
  if (!manifest || manifest.owner !== "hermes" || manifest.scenarioId !== "research.attention-decisions" || JSON.stringify(manifest.mandatoryCases.map(entry => entry.id)) !== JSON.stringify(cases)) return { ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } };
  const baseline = EngineeringControl.checkResearch({ release: "R0" }, context);
  if (!baseline.ok) return baseline;
  const component = baseline.data.components.find(entry => entry.id === "M02");
  const archive = baseline.data.reports.find(entry => entry.key === "TS" && entry.originalDigest !== null);
  const required = baseline.data.componentDecisions.find(entry => entry.componentId === "M02");
  if (!component || !archive?.originalDigest || !required || baseline.data.attentionDecisions.some(entry => entry.comparisonDigest !== null)) return { ok: false, error: { module: "ops", code: "ARTIFACT_MISMATCH", message: opsErrorMessages.ARTIFACT_MISMATCH, retryable: false } };
  const examples = {
    "discord-delivery": ["gateway-coupled", "protected-discord-rest"],
    "push-delivery": ["web-push", "gated-native-expo"],
    "alarm-delivery": ["passive-local-notifications", "alarmkit"],
    "reminder-scheduling": ["postgres-pg-boss", "per-reminder-agent-cron"]
  };
  const checks: CheckViewV1[] = [];
  for (const caseId of cases) {
    const records: ResearchAttentionDecisionV1[] = [];
    let sends = 0;
    let exported = true;
    for (const decisionId of researchAttentionDecisionIdSchema.options) {
      const faulted = decisionId === "reminder-scheduling";
      const routeFaults: Readonly<Record<string, string>> = { "wrong-observed-model": "research-route-luna", "wrong-observed-reasoning": "research-route-wrong-effort", "wrong-observed-tier": "research-route-wrong-tier", "missing-research-skill": "research-skill-missing", "wrong-loaded-skill-digest": "research-skill-wrong-bytes" };
      const routeCase = faulted ? routeFaults[caseId] ?? "research-route-observed" : "research-route-observed";
      const fixture = await delegationFixture(routeCase, "research", context, "Compare only the seeded Attention " + decisionId + " alternatives and primary evidence; produce no live research or adoption.");
      if (!fixture.result.ok) return fixture.result;
      sends += fixture.sends;
      exported = exported && (fixture.sends === 0 || fixture.exportReadback && fixture.nativeArgumentsMatched);
      const executionReceipt = fixture.result.data;
      const named = examples[decisionId];
      const selectedOptionId = decisionId === "discord-delivery" ? "protected-discord-rest" : named[0];
      if (!selectedOptionId) return { ok: false, error: { module: "ops", code: "ARTIFACT_MISMATCH", message: opsErrorMessages.ARTIFACT_MISMATCH, retryable: false } };
      const ids = [...named, "outside"];
      const record = researchAttentionDecisionSchema.parse({ scope: "attention-research-decision", componentId: "M02", decisionId, executionReceipt,
        mappedRequirements: required.missingRequirementIds,
        options: ids.map(id => ({ id, tool: id, example: id === "outside" ? null : id, viable: true, support: "proven", primaryEvidenceIds: component.reportKeys, reliability: "Seeded primary report covers delivery and durable failure handling.", maintenance: "Pin and validate the selected local adapter before activation.", resources: "Measure the shared process and durable store at the dependent gate." })),
        evidence: component.reportKeys.map(id => ({ id, url: "https://primary.example.test/attention/" + decisionId + "/" + id, publisher: "Seeded primary Attention report", kind: "primary", supportedOptionIds: ids })),
        selectedOptionId, unresolvedFacts: [], acceptanceIds: ["AT-attention-66"], validationPlan: "Validate the selected option in the assigned fixture before live adoption.", releaseGate: component.releaseGate,
        validations: [{ id: "G0:R0:M02:" + decisionId, support: "proven", sourceIds: component.reportKeys, testIds: ["AT-attention-66"] }]
      });
      if (faulted) {
        if (caseId === "missing-primary-evidence") record.evidence = [];
        if (caseId === "missing-required-option") record.options = record.options.filter(option => option.id !== "per-reminder-agent-cron");
        if (caseId === "missing-tradeoffs") for (const option of record.options) option.resources = "";
        if (caseId === "missing-acceptance-link") record.acceptanceIds = [];
        if (caseId === "unrelated-acceptance-link") { record.acceptanceIds = ["AT-hermes-config-75"]; for (const validation of record.validations) validation.testIds = record.acceptanceIds; }
        if (caseId === "missing-requirement") record.mappedRequirements = record.mappedRequirements.filter(id => id !== "0.10");
        if (caseId === "unsupported-selection") record.selectedOptionId = "uncompared";
        if (caseId === "missing-outside-option") record.options = record.options.filter(option => option.example !== null);
        if (caseId === "unsupported-outside-option") for (const option of record.options) if (option.example === null) option.support = "unsupported";
        if (caseId === "missing-route-receipt") record.executionReceipt = null;
        if (caseId === "wrong-skill-revision" && record.executionReceipt?.skill) record.executionReceipt.skill.sourceCommit = "0".repeat(40);
      }
      if (caseId !== "missing-" + decisionId) records.push(record);
      if (caseId === "duplicate-decision" && faulted) records.push(record);
    }
    const markdown = "# Seeded external Attention decisions\n\n" + records.map(record => "```ResearchAttentionDecisionV1\n" + JSON.stringify(record) + "\n```\n").join("\n");
    const inspection = EngineeringControl.checkResearch({ release: "R0" }, context, [{ reportKey: archive.key, originalDigest: archive.originalDigest, contentDigest: digest(markdown), markdown }]);
    if (!inspection.ok) return inspection;
    const bound = inspection.data.reports.find(entry => entry.key === archive.key);
    const archiveBound = bound?.origin === "seeded_document" && bound.path === archive.path && bound.originalDigest === archive.originalDigest && bound.digest === digest(markdown);
    const expectedCodes: Readonly<Record<string, string>> = { "duplicate-decision": "DUPLICATE_REFERENCE", "missing-primary-evidence": "PRIMARY_EVIDENCE_MISSING", "missing-required-option": "REQUIRED_OPTIONS_MISSING", "missing-tradeoffs": "TRADEOFFS_MISSING", "missing-acceptance-link": "ACCEPTANCE_LINK_MISSING", "unrelated-acceptance-link": "ACCEPTANCE_LINK_MISSING", "missing-requirement": "MAPPED_REQUIREMENTS_MISSING", "unsupported-selection": "CHOICE_UNSUPPORTED", "missing-outside-option": "OUTSIDE_OPTION_MISSING", "unsupported-outside-option": "OUTSIDE_OPTION_MISSING", "missing-route-receipt": "VALIDATION_ID_MISSING", "wrong-observed-model": "VALIDATION_ID_MISSING", "wrong-observed-reasoning": "VALIDATION_ID_MISSING", "wrong-observed-tier": "VALIDATION_ID_MISSING", "missing-research-skill": "VALIDATION_ID_MISSING", "wrong-skill-revision": "VALIDATION_ID_MISSING", "wrong-loaded-skill-digest": "VALIDATION_ID_MISSING" };
    for (const result of inspection.data.attentionDecisions) {
      const absent = caseId === "missing-" + result.decisionId;
      const faulted = result.decisionId === "reminder-scheduling" && expectedCodes[caseId] !== undefined;
      const record = records.find(entry => entry.decisionId === result.decisionId);
      const expectedCode = absent ? "DECISION_MISSING" : faulted ? expectedCodes[caseId] : null;
      const missingId = faulted && caseId.includes("skill") ? "SKILL:R0:M02" : faulted && (caseId.includes("route") || caseId.startsWith("wrong-observed-")) ? "ROUTE:R0:M02" : null;
      const passed = archiveBound && exported && result.comparisonDigest === (record ? digest(JSON.stringify(record)) : null) && (expectedCode === null
        ? result.state === "PASS" && result.findings.length === 0 && result.selectedOptionId === record?.selectedOptionId
        : result.state === "BLOCKED" && result.findings.some(code => code === expectedCode) && (missingId === null || result.missingValidationIds.includes(missingId)));
      checks.push(checkViewSchema.parse({ id: "research.component-comparison", owner: "self-improvement", state: passed ? "PASS" : "FAIL", checkedAt: new Date().toISOString(), reasonCode: passed ? "ATTENTION_DECISION_DIAGNOSTIC_PASS" : "ATTENTION_DECISION_DIAGNOSTIC_FAIL", nextCommandId: "probe.show",
        prerequisite: JSON.stringify({ caseId, actualUid: process.getuid?.() ?? null, archive: { key: archive.key, originalDigest: archive.originalDigest, contentDigest: digest(markdown), origin: bound?.origin }, result, execution: { ownerReceiptProduced: true, archiveReceiptAltered: faulted && ["missing-route-receipt", "wrong-skill-revision"].includes(caseId), externalCliSends: sends, exportsVerified: exported, receiptDigest: record?.executionReceipt ? digest(JSON.stringify(record.executionReceipt)) : null, observed: record?.executionReceipt?.invocation?.observed ?? null, loadedDigest: record?.executionReceipt?.skill?.loadedDigest ?? null, sourceCommit: record?.executionReceipt?.skill?.sourceCommit ?? null, nativeExecutionVerified: false }, registerAdmission: inspection.data.admission, liveProviderSends: 0, wholeATComplete: false }),
        links: { recordRefs: [], observations: [], artifactDigests: [digest(markdown), digest(readFileSync(new URL("./model-route-probe.js", import.meta.url))), digest(readFileSync(new URL("./model-route.js", import.meta.url)))] }
      }));
    }
  }
  return TestProbeControl.run(input, context, checks);
};

const componentReceiptProbe = async (input: RegisteredProbeInputV1, context: OpsControlContextV1): Promise<Result<RegisteredProbeOperationV1>> => {
  const authorityCases = ["missing-decision", "missing-primary-evidence", "unsupported-alternatives", "unsupported-selection", "missing-reliability", "missing-validation", "missing-acceptance-link", "unrelated-acceptance-link", "unresolved-selected-assumption", "ordinary-luna-receipt", "missing-route-observation", "wrong-observed-model", "wrong-observed-reasoning", "wrong-observed-tier", "missing-research-skill", "wrong-skill-hash", "complete-authority-decision"];
  const opsCases = ["outside-selected-with-evidence", "outside-without-primary-support", "outside-route-mismatch", "mapped-requirement-removed"];
  const isOps = input.probeId === "AT-ops-44";
  const cases = isOps ? opsCases : authorityCases;
  const manifest = registeredCliAcceptanceManifestInventory.find(entry => entry.id === input.probeId);
  if ((!isOps && input.probeId !== "AT-authority-60") || !manifest || manifest.owner !== "hermes" || manifest.scenarioId !== "research.component-receipts" || JSON.stringify(manifest.mandatoryCases.map(entry => entry.id)) !== JSON.stringify(cases)) return { ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } };
  const baseline = EngineeringControl.checkResearch({ release: "R0" }, context);
  if (!baseline.ok) return baseline;
  const componentId = isOps ? "A14" : "M03";
  const component = baseline.data.components.find(entry => entry.id === componentId);
  const archive = baseline.data.reports.find(entry => (isOps ? component?.reportKeys.includes(entry.key) === true : entry.key === "CJ") && entry.originalDigest !== null);
  const required = baseline.data.componentDecisions.find(entry => entry.componentId === componentId);
  const removedRequirementId = isOps ? required?.missingRequirementIds[0] : undefined;
  if (!component || !archive?.originalDigest || !required || required.comparisonDigest !== null || !component.reportKeys.includes(archive.key) || isOps && !removedRequirementId) return { ok: false, error: { module: "ops", code: "ARTIFACT_MISMATCH", message: opsErrorMessages.ARTIFACT_MISMATCH, retryable: false } };
  const opsPin = isOps ? researchSkillPinSchema.parse(JSON.parse(readFileSync(join(trustedCheckoutRoot(), "behavior/research-skill.json"), "utf8"))) : null;
  const routeFaults: Readonly<Record<string, string>> = isOps
    ? { "outside-route-mismatch": "research-route-luna" }
    : { "missing-route-observation": "research-route-missing", "wrong-observed-model": "research-route-luna", "wrong-observed-reasoning": "research-route-wrong-effort", "wrong-observed-tier": "research-route-wrong-tier", "missing-research-skill": "research-skill-missing", "wrong-skill-hash": "research-skill-wrong-bytes" };
  const expectedCodes: Readonly<Record<string, string>> = { "missing-decision": "DECISION_MISSING", "missing-primary-evidence": "PRIMARY_EVIDENCE_MISSING", "unsupported-alternatives": "REQUIRED_OPTIONS_MISSING", "unsupported-selection": "CHOICE_UNSUPPORTED", "missing-reliability": "TRADEOFFS_MISSING", "missing-validation": "VALIDATION_ID_MISSING", "missing-acceptance-link": "ACCEPTANCE_LINK_MISSING", "unrelated-acceptance-link": "ACCEPTANCE_LINK_MISSING", "unresolved-selected-assumption": "SELECTED_FACT_UNRESOLVED", "ordinary-luna-receipt": "VALIDATION_ID_MISSING", "missing-route-observation": "VALIDATION_ID_MISSING", "wrong-observed-model": "VALIDATION_ID_MISSING", "wrong-observed-reasoning": "VALIDATION_ID_MISSING", "wrong-observed-tier": "VALIDATION_ID_MISSING", "missing-research-skill": "VALIDATION_ID_MISSING", "wrong-skill-hash": "VALIDATION_ID_MISSING" };
  const opsExpectedCodes: Readonly<Record<string, string>> = { "outside-without-primary-support": "OUTSIDE_OPTION_MISSING", "outside-route-mismatch": "VALIDATION_ID_MISSING", "mapped-requirement-removed": "MAPPED_REQUIREMENTS_MISSING" };
  const objective = isOps
    ? "Compare only the seeded A14 backup-tool options and primary evidence; preserve the Mac as authoritative application host and produce no live research or adoption."
    : "Compare only seeded M03 Authority adapter options and primary evidence; preserve protected admission and perform no live effects.";
  const opsToolNames: Readonly<Record<string, string>> = { "backblaze-b2": "Backblaze B2", "external-disk": "External disk", outside: "Seeded outside backup option" };
  const opsResources = "Selected fixture tool runs on the existing Mac; the Mac remains the authoritative application host; this option does not add an application host.";
  const checks: CheckViewV1[] = [];
  for (const caseId of cases) {
    const purpose = !isOps && caseId === "ordinary-luna-receipt" ? "implementation" : "research";
    const fixture = await delegationFixture(routeFaults[caseId] ?? "research-route-observed", purpose, context, objective);
    if (!fixture.result.ok) return fixture.result;
    const ids = isOps ? ["backblaze-b2", "external-disk", "outside"] : ["protected-adapter", "supported-vendor-sdk", "outside"];
    const acceptanceId = input.probeId;
    const report = researchComponentComparisonV3Schema.parse({ scope: "required-research-component", componentId: component.id, executionReceipt: fixture.result.data,
      mappedRequirements: required.missingRequirementIds,
      options: ids.map(id => ({ id, tool: isOps ? opsToolNames[id] ?? id : id, example: id === "outside" ? null : id, viable: true, support: "proven", primaryEvidenceIds: component.reportKeys, reliability: isOps ? id === "outside" ? "Seeded A14 evidence makes this suitable option the strongest of the compared choices for the fixture's retention and restore conditions." : "Seeded A14 evidence records the named option's reliability and its specific limits for the fixture's retention and restore conditions." : "Seeded primary report distinguishes safe read retries from uncertain writes and readback.", maintenance: isOps ? "Preserve the existing Mac data authority, current cost constraint and tested restore boundary." : "Pin and maintain the typed adapter before live admission.", resources: isOps ? opsResources : "Use the shared local store and measured protected process budget." })),
      evidence: component.reportKeys.map(id => ({ id, url: "https://primary.example.test/" + (isOps ? "ops/" : "authority/") + id, publisher: isOps ? "Seeded primary Ops report fixture" : "Seeded primary Authority report", kind: "primary", supportedOptionIds: ids })),
      selectedOptionId: isOps ? "outside" : "protected-adapter", unresolvedFacts: [], acceptanceIds: [acceptanceId], validationPlan: isOps ? "Compare the seeded named and outside A14 options under the current requirement and host constraints; verify evidence, route and restore rationale before any real research or adoption." : "Validate positive, refusal and recovery cases in the owned fixture before dependent live admission.", releaseGate: component.releaseGate,
      validations: [{ id: "G0:R0:" + component.id, support: "proven", sourceIds: component.reportKeys, testIds: [acceptanceId] }]
    });
    if (isOps && caseId === "outside-without-primary-support") {
      const outside = report.options.find(option => option.id === "outside");
      if (!outside) return { ok: false, error: { module: "ops", code: "ARTIFACT_MISMATCH", message: opsErrorMessages.ARTIFACT_MISMATCH, retryable: false } };
      outside.primaryEvidenceIds = [];
    }
    if (isOps && caseId === "mapped-requirement-removed" && removedRequirementId) report.mappedRequirements = report.mappedRequirements.filter(id => id !== removedRequirementId);
    if (caseId === "missing-primary-evidence") report.evidence = [];
    if (caseId === "unsupported-alternatives") for (const option of report.options) if (option.id !== report.selectedOptionId) option.support = "unsupported";
    if (caseId === "unsupported-selection") report.selectedOptionId = "uncompared";
    if (caseId === "missing-reliability") for (const option of report.options) option.reliability = "";
    if (caseId === "missing-validation") report.validations = [];
    if (caseId === "missing-acceptance-link") report.acceptanceIds = [];
    if (caseId === "unrelated-acceptance-link") { report.acceptanceIds = ["AT-attention-66"]; for (const validation of report.validations) validation.testIds = report.acceptanceIds; }
    if (caseId === "unresolved-selected-assumption") report.unresolvedFacts = [{ optionId: report.selectedOptionId, fact: "Selected capability has not been established." }];
    const markdown = "# Seeded external " + (isOps ? "Ops" : "Authority") + " decision\n\n" + (caseId === "missing-decision" ? "No decision supplied.\n" : "```ResearchComponentComparisonV3\n" + JSON.stringify(report) + "\n```\n");
    const inspection = EngineeringControl.checkResearch({ release: "R0" }, context, [{ reportKey: archive.key, originalDigest: archive.originalDigest, contentDigest: digest(markdown), markdown }]);
    if (!inspection.ok) return inspection;
    const result = inspection.data.componentDecisions.find(entry => entry.componentId === component.id);
    const bound = inspection.data.reports.find(entry => entry.key === archive.key);
    if (!result || !bound) return { ok: false, error: { module: "ops", code: "ARTIFACT_MISMATCH", message: opsErrorMessages.ARTIFACT_MISMATCH, retryable: false } };
    const code = isOps ? opsExpectedCodes[caseId] : expectedCodes[caseId];
    const missingId = isOps ? caseId === "outside-route-mismatch" ? "ROUTE:R0:A14" : null : caseId.includes("skill") ? "SKILL:R0:M03" : caseId === "ordinary-luna-receipt" || caseId.includes("route") || caseId.startsWith("wrong-observed-") ? "ROUTE:R0:M03" : null;
    const exported = fixture.sends === 0 || fixture.exportReadback && fixture.nativeArgumentsMatched;
    const outside = report.options.find(option => option.id === "outside");
    const routeReceipt = report.executionReceipt;
    const requirementExact = JSON.stringify([...report.mappedRequirements].sort()) === JSON.stringify([...required.missingRequirementIds].sort());
    const requirementRemoved = removedRequirementId !== undefined && !report.mappedRequirements.includes(removedRequirementId) && result.missingRequirementIds.length === 1 && result.missingRequirementIds[0] === removedRequirementId;
    const routeObserved = isOps && opsPin !== null && routeReceipt?.state === "observed" && routeReceipt?.purpose === "research" && routeReceipt.invocation?.requested.role === "research" && routeReceipt.invocation?.requested.arm === "original" && routeReceipt.invocation?.requested.settings.model === "gpt-6.1-sol" && routeReceipt.invocation?.requested.settings.effort === "medium" && routeReceipt.invocation?.requested.settings.serviceTier === "priority" && routeReceipt.invocation?.observed?.model === "gpt-6.1-sol" && routeReceipt.invocation?.observed?.effort === "medium" && routeReceipt.invocation?.observed?.serviceTier === "priority" && routeReceipt.skill?.repository === opsPin.repository && routeReceipt.skill?.sourcePath === opsPin.sourcePath && routeReceipt.skill?.sourceCommit === opsPin.sourceCommit && routeReceipt.skill?.contentDigest === opsPin.contentDigest && routeReceipt.skill?.loadedDigest === opsPin.contentDigest && routeReceipt.skill?.semanticVersion === opsPin.semanticVersion && routeReceipt.skill?.resources.length === opsPin.resources.length && opsPin.resources.every(resource => routeReceipt.skill?.resources.some(loaded => loaded.path === resource.path && loaded.digest === resource.digest));
    const validationLinksMatch = report.validations.some(validation => validation.id === "G0:R0:A14" && validation.support === "proven" && JSON.stringify([...validation.sourceIds].sort()) === JSON.stringify([...component.reportKeys].sort()) && JSON.stringify([...validation.testIds].sort()) === JSON.stringify(["AT-ops-44"]));
    const opsExpected = caseId === "outside-selected-with-evidence"
      ? result.state === "PASS" && result.findings.length === 0 && result.selectedOptionId === "outside" && outside !== undefined && outside.example === null && outside.viable && outside.support === "proven" && outside.primaryEvidenceIds.length > 0 && ids.filter(id => id !== "outside").every(id => report.options.some(option => option.id === id && option.example !== null)) && requirementExact && routeObserved && outside.resources === opsResources && report.releaseGate === component.releaseGate && report.acceptanceIds.includes("AT-ops-44") && validationLinksMatch
      : result.state === "BLOCKED" && result.findings.some(finding => finding === (code ?? "OUTSIDE_OPTION_MISSING")) && (caseId !== "outside-without-primary-support" || result.findings.includes("PRIMARY_EVIDENCE_MISSING")) && (missingId === null || result.missingValidationIds.includes(missingId)) && (caseId !== "mapped-requirement-removed" || requirementRemoved) && (caseId !== "outside-route-mismatch" || routeReceipt?.state === "refused");
    const authorityExpected = result.comparisonDigest === (caseId === "missing-decision" ? null : digest(JSON.stringify(report))) && (code === undefined
      ? result.state === "PASS" && result.findings.length === 0 && result.selectedOptionId === report.selectedOptionId
      : result.state === "BLOCKED" && result.findings.some(finding => finding === code) && (missingId === null || result.missingValidationIds.includes(missingId)));
    const passed = exported && bound.path === archive.path && bound.originalDigest === archive.originalDigest && bound.digest === digest(markdown) && bound.origin === "seeded_document" && result.comparisonDigest === (caseId === "missing-decision" ? null : digest(JSON.stringify(report))) && (isOps ? opsExpected : authorityExpected);
    const execution = { ownerReceiptProduced: true, externalCliSends: fixture.sends, exportsVerified: exported, receiptDigest: digest(JSON.stringify(report.executionReceipt)), observed: report.executionReceipt?.invocation?.observed ?? null, loadedDigest: report.executionReceipt?.skill?.loadedDigest ?? null, sourceCommit: report.executionReceipt?.skill?.sourceCommit ?? null, nativeExecutionVerified: false };
    const details = isOps
      ? { caseId, fixtureOnly: true, actualUid: process.getuid?.() ?? null, archive: { key: bound.key, originalDigest: bound.originalDigest, contentDigest: bound.digest, origin: bound.origin }, result, execution, hostClaimIsFixtureTextOnly: true, registerAdmission: inspection.data.admission, liveProviderSends: 0, acceptanceComplete: false, wholeATComplete: false }
      : { caseId, actualUid: process.getuid?.() ?? null, archive: { key: bound.key, originalDigest: bound.originalDigest, contentDigest: bound.digest, origin: bound.origin }, result, execution, registerAdmission: inspection.data.admission, liveProviderSends: 0, wholeATComplete: false };
    checks.push(checkViewSchema.parse({ id: "research.component-comparison", owner: "self-improvement", state: passed ? "PASS" : "FAIL", checkedAt: new Date().toISOString(), reasonCode: passed ? isOps ? "OPS_OUTSIDE_RESEARCH_DIAGNOSTIC_PASS" : "AUTHORITY_RESEARCH_DIAGNOSTIC_PASS" : isOps ? "OPS_OUTSIDE_RESEARCH_DIAGNOSTIC_FAIL" : "AUTHORITY_RESEARCH_DIAGNOSTIC_FAIL", nextCommandId: "probe.show",
      prerequisite: JSON.stringify(details),
      links: { recordRefs: [], observations: [], artifactDigests: [digest(markdown), digest(readFileSync(new URL("./model-route-probe.js", import.meta.url))), digest(readFileSync(new URL("./model-route.js", import.meta.url)))] }
    }));
  }
  return TestProbeControl.run(input, context, checks);
};
