import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkViewSchema, filePatchSchema, opsErrorMessages, registeredCliAcceptanceManifestInventory } from "@toy/contracts";
import type { FilePatchV1, OpsControlContextV1, RegisteredProbeInputV1, RegisteredProbeOperationV1, Result } from "@toy/contracts";
import { OpsControlRead, OpsTestStack, TestProbeControl, trustedCheckoutRoot } from "@toy/ops/public";

const cases = ["application-lock", "rfc8785-vectors", "mismatched-lock", "homemade-serializer", "writable-runtime-import", "startup-package-download", "lock-integrity", "required-runtime-artifacts"] as const;
const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const denied = (): Result<RegisteredProbeOperationV1> => ({ ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false } });

export const BuildInventoryProbe = {
  async exercise(input: RegisteredProbeInputV1, context: OpsControlContextV1): Promise<Result<RegisteredProbeOperationV1>> {
    const owned = OpsTestStack.inspect(context);
    if (!owned.ok) return owned;
    const manifest = registeredCliAcceptanceManifestInventory.find(entry => entry.id === input.probeId);
    if (input.probeId !== "AT-authority-61" || input.caseId !== undefined || !owned.data.result?.ready || owned.data.result.release !== "R0" || owned.data.result.clock !== "fake" || owned.data.result.model !== "fake"
      || !manifest || manifest.owner !== "ops" || manifest.kind !== "static_gate" || manifest.scenarioId !== "build.source-inventory" || manifest.sourceAssertionHash !== "2aba96db8aea4665745bfc8229c0b6d9adb79b43ccbcd294712f25a93b79d6c0"
      || JSON.stringify(manifest.mandatoryCases.map(entry => entry.id)) !== JSON.stringify(cases) || manifest.mandatoryCases.some(entry => entry.publicOperation !== "OpsControlRead.validateBuildInventory" || entry.phase !== entry.id)) return denied();
    try {
      const root = trustedCheckoutRoot();
      const lockPath = "package-lock.json";
      const packagePath = "packages/ops/package.json";
      const lock = readFileSync(join(root, lockPath), "utf8");
      const packageSource = readFileSync(join(root, packagePath), "utf8");
      const release = await OpsControlRead.status({ release: "R0" }, context);
      const protectedRelease = release.probes.find(check => check.id === "read.release" && check.owner === "ops");
      const checks = cases.map(caseId => {
        const patches: FilePatchV1[] = [];
        let path = packagePath;
        let replacement = packageSource;
        if (caseId === "mismatched-lock") {
          path = lockPath;
          replacement = lock.replace(/("node_modules\/pg"\s*:\s*\{\s*"version"\s*:\s*)"8\.23\.1"/, '$1"0.0.0"');
        }
        if (caseId === "homemade-serializer") replacement = packageSource.replace('"canonicalize": "5.1.0"', '"toy-homemade-canonicalizer": "5.1.0"');
        if (caseId === "writable-runtime-import") replacement = packageSource.replace('"./dist/public.js"', '"../agent-writable/public.js"');
        if (caseId === "startup-package-download") replacement = packageSource.replace('"exports": {', '"scripts": { "start": "npm install startup-package" }, "exports": {');
        if (caseId === "lock-integrity") {
          path = lockPath;
          replacement = lock.replace(/("node_modules\/canonicalize"\s*:\s*\{[\s\S]*?"integrity"\s*:\s*)"sha512-[^"]+"/, '$1"invalid"');
        }
        if (!["application-lock", "rfc8785-vectors", "required-runtime-artifacts"].includes(caseId)) {
          const original = path === lockPath ? lock : packageSource;
          if (replacement === original) throw new Error("INVENTORY_MUTATION_NOT_APPLIED");
          patches.push(filePatchSchema.parse({ path, beforeDigest: digest(original), afterDigest: digest(replacement), kind: "update", mediaType: "application/json", patch: replacement }));
        }
        const result = OpsControlRead.validateBuildInventory(context, patches);
        if (!result.ok) throw new Error("INVENTORY_OWNER_REFUSED");
        const phase = caseId === "rfc8785-vectors" || caseId === "homemade-serializer" ? "canonicalization" : caseId === "required-runtime-artifacts" ? "required-runtime-artifacts" : "application-lock";
        const target = result.data.find(check => check.prerequisite?.includes('"phase":"' + phase + '"'));
        const failures = new Map([
          ["mismatched-lock", "DEPENDENCY_LOCK_MISMATCH:pg"],
          ["homemade-serializer", "MAINTAINED_CANONICALIZER_PIN_MISMATCH"],
          ["writable-runtime-import", "WORKSPACE_PUBLIC_ENTRY_REFUSED:packages/ops"],
          ["startup-package-download", "STARTUP_DOWNLOAD_REFUSED:packages/ops:start"],
          ["lock-integrity", "DEPENDENCY_INTEGRITY_MISSING:canonicalize"]
        ]);
        const expectedReason = failures.get(caseId);
        const expected = expectedReason === undefined ? target?.state === (caseId === "required-runtime-artifacts" ? "BLOCKED" : "PASS") : target?.state === "FAIL" && target.prerequisite?.includes(JSON.stringify(expectedReason)) === true;
        const originalsUnchanged = readFileSync(join(root, lockPath), "utf8") === lock && readFileSync(join(root, packagePath), "utf8") === packageSource;
        const passed = expected && originalsUnchanged && result.data.length === 3 && protectedRelease?.state === "NOT_IMPLEMENTED" && protectedRelease.reasonCode === "OWNER_TRANSPORT_NOT_IMPLEMENTED";
        const pending = caseId === "required-runtime-artifacts" && passed;
        return checkViewSchema.parse({ id: "build.source-inventory", owner: "ops", state: pending ? "BLOCKED" : passed ? "PASS" : "FAIL", checkedAt: new Date().toISOString(), reasonCode: pending ? "REQUIRED_RUNTIME_ARTIFACTS_PENDING" : passed ? "SOURCE_INVENTORY_DIAGNOSTIC_PASS" : "SOURCE_INVENTORY_DIAGNOSTIC_FAIL", prerequisite: JSON.stringify({ caseId, phase, expectedReason: expectedReason ?? null, ownerState: target?.state ?? null, ownerReadback: target?.prerequisite ?? null, sourceOverlays: patches.length, originalsUnchanged, filesWritten: false, protectedReleaseState: protectedRelease?.state ?? null, protectedReleaseReason: protectedRelease?.reasonCode ?? null, installedServicesVerified: false, nativeAdmissionVerified: false, wholeATComplete: false }), nextCommandId: "probe.show", links: { recordRefs: [], observations: [], artifactDigests: [...new Set([digest(lock), digest(packageSource), ...result.data.flatMap(check => check.links.artifactDigests), digest(readFileSync(new URL("./build-inventory-probe.js", import.meta.url))), digest(readFileSync(new URL("../../ops/dist/build-inventory.js", import.meta.url)))])] } });
      });
      return TestProbeControl.run(input, context, checks);
    } catch { return denied(); }
  }
};
