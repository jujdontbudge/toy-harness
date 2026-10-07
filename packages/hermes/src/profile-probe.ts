import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { checkViewSchema, opsErrorMessages, registeredCliAcceptanceManifestInventory, registeredProbeInputSchema } from "@toy/contracts";
import type { CheckViewV1, OpsControlContextV1, RegisteredProbeInputV1, RegisteredProbeOperationV1, Result } from "@toy/contracts";
import { OpsTestStack, TestProbeControl, trustedCheckoutRoot } from "@toy/ops/public";
import { HermesProfile } from "./profile.js";

const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const cases = ["generated-gateway-consumed", "nondefault-gateway-consumed", "unknown-root-refused", "unknown-nested-refused", "ignored-key-refused", "native-default-replacement-refused", "container-shape-refused", "missing-key-refused", "allow-all-users-wrong-type-refused", "allow-all-users-missing-key-refused"];

export const HermesProfileProbe = {
  async run(input: RegisteredProbeInputV1, context: OpsControlContextV1): Promise<Result<RegisteredProbeOperationV1>> {
    const invalid: Result<RegisteredProbeOperationV1> = { ok: false, error: { module: "ops", code: "INVALID_INPUT", message: opsErrorMessages.INVALID_INPUT, retryable: false } };
    if (!registeredProbeInputSchema.safeParse(input).success || input.caseId !== undefined) return invalid;
    const manifest = registeredCliAcceptanceManifestInventory.find(entry => entry.id === input.probeId);
    if (manifest?.owner === "hermes" && manifest.scenarioId === "profile.mcp-http") {
      if (JSON.stringify(manifest.mandatoryCases.map(entry => entry.id)) !== JSON.stringify(["default-http-consumed"]) || manifest.observations.length !== 1 || JSON.stringify(manifest.observations[0]?.caseIds) !== JSON.stringify(["default-http-consumed"])) return invalid;
      const result = await HermesProfile.consumeMcpHttp(context);
      const receipt = result.ok ? result.data : null;
      const native = receipt?.native;
      const passed = native?.failureStage === "none" && native.transport === "http" && native.connected && native.tools === native.registeredTools.length && native.registeredTools.includes("mcp__life_store__fixture_ping") && native.serverReady && native.serverStopped && !native.connectedAfterShutdown && native.loopbackConnections > 0 && native.deniedNetworkAttempts === 0;
      const check = checkViewSchema.parse({
        id: "profile.native-mcp-http", owner: "hermes", state: passed ? "PASS" : "FAIL", checkedAt: new Date().toISOString(),
        reasonCode: passed ? "NATIVE_MCP_HTTP_DIAGNOSTIC_PASS" : "NATIVE_MCP_HTTP_DIAGNOSTIC_FAIL", nextCommandId: "probe.show",
        prerequisite: JSON.stringify({ caseId: "default-http-consumed", receipt, errorCode: result.ok ? null : result.error.code, actualLifeStoreValidated: false, wholeATComplete: false }),
        links: { recordRefs: [], observations: [], artifactDigests: [digest(readFileSync(new URL("./profile.js", import.meta.url))), digest(readFileSync(new URL("./profile-probe.js", import.meta.url)))] }
      });
      return TestProbeControl.run(input, context, [check]);
    }
    if (!manifest || manifest.owner !== "hermes" || manifest.scenarioId !== "profile.gateway-consumers") return invalid;
    if (JSON.stringify(manifest.mandatoryCases.map(entry => entry.id)) !== JSON.stringify(cases)) return { ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } };
    const owned = OpsTestStack.inspect(context);
    if (!owned.ok) return owned;
    if (!owned.data.result?.ready || owned.data.result.release !== "R0" || owned.data.result.clock !== "fake" || owned.data.result.model !== "fake") return invalid;
    try {
      const root = trustedCheckoutRoot();
      const world = join(root, "build/.toy-r0-fixtures", owned.data.result.stackId);
      const artifacts = (): number => readdirSync(world).filter(path => path.startsWith("native-profile-")).length;
      const profile = HermesProfile.generateGateway();
      const { loop_watchdog_probe_interval_s: removedInterval, ...withoutInterval } = profile.gateway;
      const gatewayWithoutAllowAllUsers: Record<string, unknown> = { ...profile.gateway };
      delete gatewayWithoutAllowAllUsers.allow_all_users;
      const inputs: unknown[] = [
        profile,
        { gateway: { multiplex_profiles: false, loop_watchdog: false, loop_watchdog_probe_interval_s: 37, loop_watchdog_probe_timeout_s: 11, loop_watchdog_max_strikes: 4, allow_all_users: true }, platforms: { discord: { enabled: true } }, streaming: { enabled: true } },
        { ...profile, obsolete_gateway_setting: true },
        { ...profile, gateway: { ...profile.gateway, obsolete_setting: true } },
        { ...profile, gateway: { ...withoutInterval, loop_watchdog_probe_interval_seconds: removedInterval } },
        { ...profile, gateway: { ...profile.gateway, loop_watchdog_probe_interval_s: 0 } },
        { ...profile, streaming: "enabled" },
        { ...profile, gateway: withoutInterval },
        { ...profile, gateway: { ...profile.gateway, allow_all_users: "true" } },
        { ...profile, gateway: gatewayWithoutAllowAllUsers }
      ];
      const checks: CheckViewV1[] = [];
      const digests = [digest(readFileSync(join(root, "behavior/hermes-gateway-consumers.json"))), digest(readFileSync(new URL("./profile.js", import.meta.url))), digest(readFileSync(new URL("./profile-probe.js", import.meta.url)))];
      for (const [index, caseId] of cases.entries()) {
        const before = artifacts();
        const result = await HermesProfile.consumeGateway(inputs[index], context);
        const after = artifacts();
        const expectedConsumed = index < 2;
        const receipt = result.ok ? result.data : null;
        const passed = expectedConsumed
          ? result.ok && receipt?.nativeConsumerMatched === true && receipt.native.networkAttempts === 0 && receipt.native.parentPid === process.pid && receipt.native.pid !== process.pid && after === before + 1 && !receipt.acceptanceComplete
          : !result.ok && result.error.code === "INVALID_INPUT" && after === before;
        checks.push(checkViewSchema.parse({
          id: "profile.native-gateway", owner: "hermes", state: passed ? "PASS" : "FAIL", checkedAt: new Date().toISOString(),
          reasonCode: passed ? "NATIVE_GATEWAY_FRAGMENT_DIAGNOSTIC_PASS" : "NATIVE_GATEWAY_FRAGMENT_DIAGNOSTIC_FAIL", nextCommandId: "probe.show",
          prerequisite: JSON.stringify({ caseId, generatedKeys: 8, profileArtifactsBefore: before, profileArtifactsAfter: after, receipt, errorCode: result.ok ? null : result.error.code, sourceValidation: "reviewed-native-files-and-locked-git-blobs", completeProfileValidated: false, wholeATComplete: false }),
          links: { recordRefs: [], observations: [], artifactDigests: digests }
        }));
      }
      return TestProbeControl.run(input, context, checks);
    } catch { return { ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } }; }
  }
};
