import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { checkViewSchema } from "@toy/contracts";
import type { CheckViewV1, OpsControlContextV1, RegisteredTestCaseV1 } from "@toy/contracts";
import { TestClockControl, trustedCheckoutRoot } from "@toy/ops/public";
import { k4aReferenceSourceAdapter, k4aReferenceSourceDigest } from "@toy/sources/public";
import { opsStatusToolRegistration, toyOpsStatus } from "./reference-tools/ops-status.js";

const digest = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

export const referenceCheck = async (caseId: RegisteredTestCaseV1, context: OpsControlContextV1): Promise<CheckViewV1> => {
  const common = { checkedAt: new Date().toISOString(), nextCommandId: "probe.show", links: { recordRefs: [], observations: [], artifactDigests: [] } };
  const clock = TestClockControl.get(context);
  if (!clock.ok) throw new Error("OWNED_CLOCK_UNAVAILABLE");
  if (caseId === "k4a-connector") {
    const deadline = performance.now() + Math.min(context.timeoutMs, 5000);
    const ctx = { abortSignal: AbortSignal.timeout(Math.min(context.timeoutMs, 5000)), remainingMs: () => deadline - performance.now(), now: () => clock.data.virtualWall };
    const adapter = k4aReferenceSourceAdapter;
    const capabilities = adapter.capabilities();
    const connection = await adapter.validateConnection(ctx);
    const partitions = [];
    for await (const partition of adapter.enumeratePartitions(ctx)) partitions.push(partition);
    const partition = partitions[0];
    if (!partition) throw new Error("REFERENCE_PARTITION_UNAVAILABLE");
    const page = await adapter.readPage(ctx, { partition, mode: "incremental", cursor: null, snapshotId: null, pageBudgetBytes: 4096 });
    const pass = connection.valid && capabilities.authKind === "none" && capabilities.permittedHosts.length === 0 && page.items.length === 0 && page.exhausted && page.providerCheckedAt === clock.data.virtualWall;
    return checkViewSchema.parse({ ...common, id: "bootstrap.reference.connector", owner: "sources", state: pass ? "PASS" : "FAIL", reasonCode: "PUBLIC_FAKE_ADAPTER_READBACK", prerequisite: JSON.stringify({ provider: adapter.provider, connectionValid: connection.valid, partitions: partitions.length, items: page.items.length, exhausted: page.exhausted, providerCheckedAt: page.providerCheckedAt }), links: { ...common.links, artifactDigests: [k4aReferenceSourceDigest] } });
  }
  if (caseId === "k4a-tool") {
    const status = await toyOpsStatus({ release: "R0" }, context);
    const pass = status.requiredRelease === "R0" && !status.complete && status.probes.some(check => check.id === "bootstrap.fixture-runtime" && check.state === "PASS");
    return checkViewSchema.parse({ ...common, id: "bootstrap.reference.tool", owner: "self-improvement", state: pass ? "PASS" : "FAIL", reasonCode: "ACTUAL_PUBLIC_OPS_TOOL_READBACK", prerequisite: JSON.stringify({ registration: opsStatusToolRegistration, complete: status.complete, fixtureReady: pass, unavailableOwners: status.probes.filter(check => check.state === "NOT_IMPLEMENTED").length }), links: { ...common.links, artifactDigests: [digest(readFileSync(join(import.meta.dirname, "reference-tools/ops-status.js")))] } });
  }
  if (caseId !== "k4a-skill") throw new Error("UNREGISTERED_REFERENCE_CASE");
  const path = join(trustedCheckoutRoot(), "skills/toy-control/SKILL.md");
  if (!lstatSync(path).isFile()) throw new Error("REFERENCE_SKILL_UNAVAILABLE");
  const bytes = readFileSync(path);
  const pass = bytes.length <= 262144 && bytes.toString("utf8").startsWith("---\nname: toy-control\n") && bytes.toString("utf8").includes("version: 1.0.0\n") && existsSync(join(dirname(path), "FEATURE-MAP.md"));
  return checkViewSchema.parse({ ...common, id: "bootstrap.reference.skill", owner: "self-improvement", state: pass ? "PASS" : "FAIL", reasonCode: "LOCAL_CANONICAL_SKILL_STATIC_READBACK", prerequisite: JSON.stringify({ name: "toy-control", version: "1.0.0", published: false, bytes: bytes.length, companionPresent: true }), links: { ...common.links, artifactDigests: [digest(bytes)] } });
};
