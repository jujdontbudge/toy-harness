import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkViewSchema, focusSessionSchema, ingestReceiptSchema, observationEvidenceRefSchema, opsErrorMessages, registeredCliAcceptanceManifestInventory, runContextSchema, uint64Maximum } from "@toy/contracts";
import type { CheckViewV1, OpsControlContextV1, RegisteredProbeInputV1, RegisteredProbeOperationV1, Result } from "@toy/contracts";
import { OpsTestStack, TestProbeControl, trustedCheckoutRoot } from "@toy/ops/public";

const cases = ["tool-context-wire", "client-focus-wire", "ingest-counters-wire", "python-generated-wire", "utf8-observation-wire", "malformed-identifiers", "noncanonical-counters", "incomplete-observation-span"] as const;
const denied = (): Result<RegisteredProbeOperationV1> => ({ ok: false, error: { module: "ops", code: "ATTESTATION_INVALID", message: opsErrorMessages.ATTESTATION_INVALID, retryable: false, effectState: "none" } });
const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

export const dtoRoundtripProbe = (input: RegisteredProbeInputV1, context: OpsControlContextV1): Result<RegisteredProbeOperationV1> => {
  const owned = OpsTestStack.inspect(context);
  if (!owned.ok) return owned;
  if (input.probeId !== "AT-hermes-config-50" || input.caseId !== undefined || !owned.data.result?.ready
    || owned.data.result.release !== "R0" || owned.data.result.clock !== "fake" || owned.data.result.model !== "fake") return denied();
  const manifest = registeredCliAcceptanceManifestInventory.find(entry => entry.id === input.probeId);
  if (!manifest || manifest.owner !== "contracts" || manifest.scenarioId !== "contracts.dto-roundtrip" || manifest.firstRelease !== "R0" || manifest.kind !== "behavioral"
    || manifest.sourceAssertionHash !== "2d2e75c4c8e22b94d2f1fc10e237613182ddf8ef5daef01264eef72ed2cf6520" || manifest.faultControls.length !== 0
    || JSON.stringify(manifest.mandatoryCases.map(entry => entry.id)) !== JSON.stringify(cases)
    || manifest.mandatoryCases.some(entry => entry.phase !== entry.id || entry.publicOperation !== "@toy/contracts and generated Python DTOs")
    || manifest.observations.length !== 1 || JSON.stringify(manifest.observations[0]?.caseIds) !== JSON.stringify(cases)) return denied();
  try {
    const quote = "å 👩🏽‍💻 café";
    const observation = observationEvidenceRefSchema.parse({ observationRef: "life://observation/550e8400-e29b-41d4-a716-446655440009", documentId: "550e8400-e29b-41d4-a716-446655440008", byteFrom: "7", byteTo: String(7 + Buffer.byteLength(quote, "utf8")), quote });
    const tool = runContextSchema.parse({ profile: "toy", runId: "550e8400-e29b-41d4-a716-446655440001", parentRunId: null, actorId: "550e8400-e29b-41d4-a716-446655440002", sessionId: "dto-fixture-session", turnId: "dto-fixture-turn", wireSchemaVersion: "toy-agent/v1", contractVersion: 1, recordRevision: "9007199254740993", releaseDigest: "a".repeat(64), generation: "9007199254740995", source: "cli", permissionRefs: ["550e8400-e29b-41d4-a716-446655440003"] });
    const focus = focusSessionSchema.parse({ id: "550e8400-e29b-41d4-a716-446655440004", focusGeneration: "550e8400-e29b-41d4-a716-446655440005", revision: uint64Maximum, commitmentId: "550e8400-e29b-41d4-a716-446655440006", objective: "Synthetic DTO round-trip", startsAt: "2026-10-06T00:00:00.000Z", endsAt: "2026-10-06T00:25:00.000Z", state: "active", ruleSetId: "550e8400-e29b-41d4-a716-446655440007", policyHash: "b".repeat(64) });
    const ingest = ingestReceiptSchema.parse({ receiptId: "550e8400-e29b-41d4-a716-446655440010", deviceId: "550e8400-e29b-41d4-a716-446655440011", streamId: "550e8400-e29b-41d4-a716-446655440012", committedThroughSeq: "9007199254740997", committedEventIds: ["550e8400-e29b-41d4-a716-446655440013"], observationRefs: [observation], committedWatermark: "9007199254740999", serverTime: "2026-10-06T00:00:00.000Z", nextUploadAfterMs: 3000 });
    const toolWire: unknown = JSON.parse(JSON.stringify(tool));
    const focusWire: unknown = JSON.parse(JSON.stringify(focus));
    const ingestWire: unknown = JSON.parse(JSON.stringify(ingest));
    const observationWire: unknown = JSON.parse(JSON.stringify(observation));
    const toolReadback = runContextSchema.parse(toolWire);
    const focusReadback = focusSessionSchema.parse(focusWire);
    const ingestReadback = ingestReceiptSchema.parse(ingestWire);
    const observationReadback = observationEvidenceRefSchema.parse(observationWire);
    const root = trustedCheckoutRoot();
    const python = spawnSync(join(root, ".venv/bin/python"), ["-I", "-B", "-c", "import sys; sys.path.insert(0, sys.argv[1]); from toy_control.dto_roundtrip import roundtrip_fixture; print(roundtrip_fixture())", join(root, "python")], {
      encoding: "utf8", timeout: Math.min(10000, context.timeoutMs), maxBuffer: 16384,
      env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin", PYTHONDONTWRITEBYTECODE: "1" }, stdio: ["ignore", "pipe", "pipe"]
    });
    const pythonRaw: unknown = python.status === 0 && !python.error ? JSON.parse(python.stdout) : null;
    const pythonValues: readonly unknown[] = Array.isArray(pythonRaw) ? pythonRaw : [];
    const pythonTool = runContextSchema.safeParse(pythonValues[0]);
    const pythonFocus = focusSessionSchema.safeParse(pythonValues[1]);
    const pythonIngest = ingestReceiptSchema.safeParse(pythonValues[2]);
    const byteFrom = Number(observationReadback.byteFrom);
    const byteTo = Number(observationReadback.byteTo);
    const extracted = Buffer.from("before:" + quote + ":after", "utf8").subarray(byteFrom, byteTo);
    const invalidIdentifiers = [
      !runContextSchema.safeParse({ ...tool, actorId: "opaque-auth-user" }).success,
      !runContextSchema.safeParse({ ...tool, actorId: 1 }).success,
      !focusSessionSchema.safeParse({ ...focus, focusGeneration: "9007199254740993" }).success,
      !focusSessionSchema.safeParse({ ...focus, cycleId: focus.focusGeneration }).success
    ];
    const invalidCounters = [
      !runContextSchema.safeParse({ ...tool, recordRevision: 9007199254740992 }).success,
      ...["01", "-1", "5\n"].map(generation => !runContextSchema.safeParse({ ...tool, generation }).success),
      !ingestReceiptSchema.safeParse({ ...ingest, committedThroughSeq: 9007199254740992 }).success,
      !ingestReceiptSchema.safeParse({ ...ingest, committedWatermark: "01" }).success,
      !focusSessionSchema.safeParse({ ...focus, revision: (BigInt(uint64Maximum) + 1n).toString() }).success
    ];
    const incompleteSpans = [
      !observationEvidenceRefSchema.safeParse({ observationRef: observation.observationRef, documentId: observation.documentId, byteFrom: "7" }).success,
      !observationEvidenceRefSchema.safeParse({ observationRef: observation.observationRef, documentId: observation.documentId, byteTo: "7" }).success,
      !observationEvidenceRefSchema.safeParse({ observationRef: observation.observationRef, byteFrom: "7", byteTo: "8" }).success,
      !observationEvidenceRefSchema.safeParse({ ...observation, byteFrom: "8", byteTo: "7" }).success,
      !observationEvidenceRefSchema.safeParse({ ...observation, byteFrom: "invalid" }).success
    ];
    const passed = [
      JSON.stringify(toolReadback) === JSON.stringify(tool) && toolReadback.recordRevision !== toolReadback.generation,
      JSON.stringify(focusReadback) === JSON.stringify(focus) && focusReadback.focusGeneration !== focusReadback.id,
      JSON.stringify(ingestReadback) === JSON.stringify(ingest) && ingestReadback.committedThroughSeq !== ingestReadback.committedWatermark,
      pythonValues.length === 3 && pythonTool.success && pythonFocus.success && pythonIngest.success
        && JSON.stringify(pythonTool.data) === JSON.stringify(tool) && JSON.stringify(pythonFocus.data) === JSON.stringify(focus) && JSON.stringify(pythonIngest.data) === JSON.stringify(ingest),
      JSON.stringify(observationReadback) === JSON.stringify(observation) && extracted.equals(Buffer.from(quote, "utf8")),
      invalidIdentifiers.every(Boolean), invalidCounters.every(Boolean), incompleteSpans.every(Boolean)
    ];
    const artifacts = ["packages/contracts/generated/schemas/run-context.schema.json", "packages/contracts/generated/schemas/focus-session.schema.json", "packages/contracts/generated/schemas/ingest-receipt.schema.json", "packages/contracts/generated/schemas/observation-evidence-ref.schema.json", "python/toy_contracts/generated.py", "python/toy_control/dto_roundtrip.py"].map(path => digest(readFileSync(join(root, path))));
    const checks: CheckViewV1[] = cases.map((caseId, index) => checkViewSchema.parse({
      id: "contracts.dto-roundtrip", owner: "contracts", state: passed[index] === true ? "PASS" : "FAIL", checkedAt: new Date().toISOString(), reasonCode: passed[index] === true ? "DTO_REPRESENTATION_DIAGNOSTIC_PASS" : "DTO_REPRESENTATION_DIAGNOSTIC_FAIL", nextCommandId: "probe.show",
      prerequisite: JSON.stringify({ caseId, actorId: toolReadback.actorId, recordRevision: toolReadback.recordRevision, generation: toolReadback.generation, focusGeneration: focusReadback.focusGeneration, focusRevision: focusReadback.revision, committedThroughSeq: ingestReadback.committedThroughSeq, committedWatermark: ingestReadback.committedWatermark, quote: observationReadback.quote, byteFrom: observationReadback.byteFrom, byteTo: observationReadback.byteTo, pythonPid: python.pid, pythonExitCode: python.status, pythonRuntimeValidation: false, protectedPrincipalMappingVerified: false, clientOwnerVerified: false, retainedLifeEvidenceVerified: false, swiftVerified: false, wholeATComplete: false, liveProviderSends: 0 }),
      links: { recordRefs: [], observations: [], artifactDigests: artifacts }
    }));
    return TestProbeControl.run(input, context, checks);
  } catch { return denied(); }
};
