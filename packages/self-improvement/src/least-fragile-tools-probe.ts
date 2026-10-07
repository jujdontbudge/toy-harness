import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkViewSchema, filePatchSchema, opsErrorMessages, registeredCliAcceptanceManifestInventory } from "@toy/contracts";
import type { FilePatchV1, OpsControlContextV1, RegisteredProbeInputV1, RegisteredProbeOperationV1, Result } from "@toy/contracts";
import { OpsTestStack, TestProbeControl, trustedCheckoutRoot } from "@toy/ops/public";
import { EngineeringControl } from "./engineering-control.js";

const cases = ["actual-lock-and-owners", "mismatched-lock", "feature-scheduler", "feature-blocker", "feature-credentials", "runtime-download", "startup-package-download", "private-owner-import", "private-public-entry", "unproven-alternative"] as const;
const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const denied = (): Result<RegisteredProbeOperationV1> => ({ ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } });

export const leastFragileToolsProbe = (input: RegisteredProbeInputV1, context: OpsControlContextV1): Result<RegisteredProbeOperationV1> => {
  const owned = OpsTestStack.inspect(context);
  if (!owned.ok) return owned;
  const manifest = registeredCliAcceptanceManifestInventory.find(entry => entry.id === input.probeId);
  if (input.probeId !== "AT-adhd-features-106" || input.caseId !== undefined || !owned.data.result?.ready || owned.data.result.release !== "R0" || owned.data.result.clock !== "fake" || owned.data.result.model !== "fake"
    || !manifest || manifest.owner !== "self-improvement" || manifest.kind !== "static_gate" || manifest.scenarioId !== "engineering.least-fragile-tools" || manifest.sourceAssertionHash !== "0cf48737cb30e7053dad160595d3da029af0cbaee251692ae1465878a39fa6f9"
    || JSON.stringify(manifest.mandatoryCases.map(entry => entry.id)) !== JSON.stringify(cases) || manifest.mandatoryCases.some(entry => entry.publicOperation !== "EngineeringControl.validateLeastFragileTools" || entry.phase !== entry.id)) return denied();
  try {
    const root = trustedCheckoutRoot();
    const lock = readFileSync(join(root, "package-lock.json"), "utf8");
    const lockDigest = digest(lock);
    const packagePath = "packages/adhd/package.json";
    const packageSource = readFileSync(join(root, packagePath), "utf8");
    const sourcePath = "packages/adhd/src/at106-external-os-fixture.ts";
    const fixtureSources = new Map([
      ["feature-scheduler", "setInterval(() => {}, 180000);\nexport {};\n"],
      ["feature-blocker", "import { spawnSync } from 'node:child_process';\nexport const block = () => spawnSync('/usr/bin/false');\n"],
      ["feature-credentials", "import { writeFileSync } from 'node:fs';\nexport const store = () => writeFileSync('token.json', 'synthetic');\n"],
      ["runtime-download", "export const download = () => fetch('https://fixture.invalid/package');\n"],
      ["private-owner-import", "import { ModelAdmission } from '../../self-improvement/src/model-admission.js';\nexport { ModelAdmission };\n"]
    ]);
    const checks = cases.map(caseId => {
      const patches: FilePatchV1[] = [];
      if (caseId === "mismatched-lock") {
        const mutated = lock.replace(/("node_modules\/pg"\s*:\s*\{\s*"version"\s*:\s*)"8\.23\.1"/, '$1"0.0.0"');
        if (mutated === lock) throw new Error("LOCK_MUTATION_NOT_APPLIED");
        patches.push(filePatchSchema.parse({ path: "package-lock.json", beforeDigest: lockDigest, afterDigest: digest(mutated), kind: "update", mediaType: "application/json", patch: mutated }));
      }
      const source = fixtureSources.get(caseId);
      if (source !== undefined) patches.push(filePatchSchema.parse({ path: sourcePath, beforeDigest: null, afterDigest: digest(source), kind: "create", mediaType: "text/plain", patch: source }));
      if (caseId === "startup-package-download" || caseId === "private-public-entry") {
        const replacement = caseId === "startup-package-download"
          ? packageSource.replace('"exports": {', '"scripts": { "start": "npm install feature-package" }, "exports": {')
          : packageSource.replace('"./dist/public.js"', '"../self-improvement/dist/model-admission.js"');
        if (replacement === packageSource) throw new Error("MANIFEST_MUTATION_NOT_APPLIED");
        patches.push(filePatchSchema.parse({ path: packagePath, beforeDigest: digest(packageSource), afterDigest: digest(replacement), kind: "update", mediaType: "application/json", patch: replacement }));
      }
      const result = EngineeringControl.validateLeastFragileTools(context, patches);
      if (!result.ok) throw new Error("OWNER_VALIDATION_REFUSED");
      const observed = result.data.map(check => ({ state: check.state, reasonCode: check.reasonCode }));
      const failed = result.data.filter(check => check.state === "FAIL");
      const expectedPhase = caseId === "mismatched-lock" ? "canonical-lock" : patches.length > 0 ? "owner-capabilities" : null;
      const expectedReasons = new Map([
        ["mismatched-lock", "DEPENDENCY_LOCK_MISMATCH:pg"],
        ["feature-scheduler", "FEATURE_AMBIENT_CAPABILITY_REFUSED:" + sourcePath],
        ["feature-blocker", "FEATURE_OWNER_IMPORT_REFUSED:node:child_process"],
        ["feature-credentials", "FEATURE_OWNER_IMPORT_REFUSED:node:fs"],
        ["runtime-download", "FEATURE_AMBIENT_CAPABILITY_REFUSED:" + sourcePath],
        ["startup-package-download", "FEATURE_LIFECYCLE_SCRIPT_REFUSED"],
        ["private-owner-import", "FEATURE_LOCAL_IMPORT_REFUSED:../../self-improvement/src/model-admission.js"],
        ["private-public-entry", "FEATURE_PUBLIC_ENTRY_REFUSED"]
      ]);
      const expectedReason = expectedReasons.get(caseId);
      const expected = expectedPhase === null ? result.data.every(check => check.state === "PASS") : failed.length === 1 && expectedReason !== undefined && failed[0]?.prerequisite?.includes('"phase":"' + expectedPhase + '"') === true && failed[0].prerequisite.includes(JSON.stringify(expectedReason));
      const research = EngineeringControl.checkResearch({ release: "R0" }, context);
      if (!research.ok) throw new Error("RESEARCH_READBACK_REFUSED");
      const decision = research.data.componentDecisions.find(component => component.componentId === "M08");
      const unprovenGuarded = decision?.state === "BLOCKED" && decision.selectedTool === null && decision.missingValidationIds.includes("G0:R0:M08") && research.data.admission === "BLOCKED" && !research.data.acceptanceComplete;
      const actualLockUnchanged = readFileSync(join(root, "package-lock.json"), "utf8") === lock;
      const passed = expected && unprovenGuarded && result.data.length === 3 && actualLockUnchanged;
      return checkViewSchema.parse({ id: "engineering.least-fragile-tools", owner: "self-improvement", state: passed ? "PASS" : "FAIL", checkedAt: new Date().toISOString(), reasonCode: passed ? "LEAST_FRAGILE_TOOLS_DIAGNOSTIC_PASS" : "LEAST_FRAGILE_TOOLS_DIAGNOSTIC_FAIL", prerequisite: JSON.stringify({ caseId, expectedFailurePhase: expectedPhase, ownerStates: observed, observedFailures: failed.map(check => check.prerequisite), sourceOverlays: patches.length, externalSeam: patches.length > 0 ? "OS" : "actual_sources", filesWritten: false, actualLockUnchanged, researchDecision: decision === undefined ? null : { componentId: decision.componentId, state: decision.state, selectedTool: decision.selectedTool, missingValidationIds: decision.missingValidationIds }, researchAdmission: research.data.admission, liveProviderSends: 0, nativeAdmissionVerified: false, wholeATComplete: false }), nextCommandId: "probe.show", links: { recordRefs: [], observations: [], artifactDigests: [...new Set([lockDigest, ...result.data.flatMap(check => check.links.artifactDigests), digest(readFileSync(new URL("./least-fragile-tools-probe.js", import.meta.url))), digest(readFileSync(new URL("./engineering-control.js", import.meta.url)))])] } });
    });
    return TestProbeControl.run(input, context, checks);
  } catch { return denied(); }
};
