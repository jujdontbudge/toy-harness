import {
  capabilityViewSchema, checkViewSchema, cliDeclarations, controlStatusInputSchema, controlStatusSchema, doctorInputSchema, doctorReportSchema,
  evidenceLinksSchema, opsControlContextSchema, opsControlReadInventory, opsErrorMessages, opsTestStackResultSchema,
  releaseSchema, secretReadinessSchema, serviceIdSchema, testStackDownInputSchema, testStackUpInputSchema
} from "@toy/contracts";
import type {
  ControlStatusInputV1, ControlStatusV1, DoctorInputV1, DoctorReportV1, OpsControlContextV1, OpsErrorCode, Release,
  Result, TestStackDownInputV1, TestStackOperationV1, TestStackUpInputV1
} from "@toy/contracts";
export type { ModuleId } from "@toy/contracts";
import { inspectBootstrapJournal } from "./bootstrap-journal.js";
import { measureBootstrapResources } from "./bootstrap-resources.js";
import { fixtureStackUp, fixtureStackDown, fixtureStackInspect, FixtureClock, FixtureProbe } from "./fixture-stack.js";
export { FixtureClock as TestClockControl, FixtureProbe as TestProbeControl };

const unavailableSnapshot = (release: Release, context: OpsControlContextV1): ControlStatusV1 => {
  opsControlContextSchema.parse(context);
  const evaluatedAt = new Date().toISOString();
  const links = evidenceLinksSchema.parse({ recordRefs: [], observations: [], artifactDigests: [] });
  const probes = opsControlReadInventory.map((probe) => checkViewSchema.parse({
    ...probe, state: "NOT_IMPLEMENTED", checkedAt: evaluatedAt, reasonCode: "OWNER_TRANSPORT_NOT_IMPLEMENTED",
    prerequisite: "Verified installed-service manifest and authenticated public owner transport are required.", links
  }));
  const capabilities = cliDeclarations.map((declaration) => capabilityViewSchema.parse({
    id: declaration.featureIds[0], firstRelease: declaration.firstRelease,
    required: releaseSchema.options.indexOf(declaration.firstRelease) <= releaseSchema.options.indexOf(release),
    implementation: declaration.implementation, state: "NOT_IMPLEMENTED", tested: false, installed: false, deployed: false,
    checkedAt: evaluatedAt, prerequisite: "Current digest-bound acceptance, installation and deployment records are required.", links
  }));
  const secrets = serviceIdSchema.options.map((serviceId) => secretReadinessSchema.parse({ serviceId, state: "unknown", checkedAt: evaluatedAt, expiresAt: null }));
  return controlStatusSchema.parse({
    requiredRelease: release, ops: null, probes, sources: null, attention: null, quota: null, cadence: null, release: null,
    secrets, capabilities, complete: false
  });
};

export const OpsControlRead = {
  status(input: ControlStatusInputV1, context: OpsControlContextV1): Promise<ControlStatusV1> {
    const request = controlStatusInputSchema.parse(input);
    const snapshot = unavailableSnapshot(request.release ?? "R0", context);
    if (context.environment.kind === "test") {
      const fixture = fixtureStackInspect(context);
      if (fixture.ok && fixture.data.result) snapshot.probes.push(...fixture.data.result.components);
    }
    return Promise.resolve(controlStatusSchema.parse(snapshot));
  },
  async doctor(input: DoctorInputV1, context: OpsControlContextV1): Promise<DoctorReportV1> {
    const started = process.hrtime.bigint();
    const request = doctorInputSchema.parse(input);
    const snapshot = unavailableSnapshot(request.release ?? "R0", context);
    const checks = [...snapshot.probes];
    if (context.environment.kind === "test") {
      const fixture = fixtureStackInspect(context);
      if (fixture.ok && fixture.data.result) checks.push(...fixture.data.result.components);
    }
    if (request.deep) {
      checks.push(inspectBootstrapJournal(context.timeoutMs - Number((process.hrtime.bigint() - started) / 1000000n)));
      const measured = await measureBootstrapResources(context.timeoutMs - Number((process.hrtime.bigint() - started) / 1000000n));
      checks.push(checkViewSchema.parse({
        id: "bootstrap.resource-admission", owner: "ops", state: measured.admissionState === "admitted" ? "PASS" : "BLOCKED", checkedAt: measured.measuredAt,
        reasonCode: measured.reasons.join(",") || "MEMORY_ADMITTED", nextCommandId: "stack.up", links: { recordRefs: [], observations: [], artifactDigests: [] },
        prerequisite: JSON.stringify(measured)
      }));
    }
    return doctorReportSchema.parse({
      requiredRelease: snapshot.requiredRelease, deep: request.deep, checks, verdict: checks.some((check) => check.state === "FAIL") ? "FAIL" : "NOT_IMPLEMENTED",
      complete: false, links: { recordRefs: [], observations: [], artifactDigests: [] }
    });
  }
};

const unavailableStack = (code: OpsErrorCode): Result<TestStackOperationV1> => opsTestStackResultSchema.parse({
  ok: false, error: { module: "ops", code, retryable: false, message: opsErrorMessages[code] }
});

export const OpsTestStack = {
  up(input: TestStackUpInputV1, context: OpsControlContextV1): Promise<Result<TestStackOperationV1>> {
    if (!testStackUpInputSchema.safeParse(input).success || !opsControlContextSchema.safeParse(context).success) {
      return Promise.resolve(unavailableStack("INVALID_INPUT"));
    }
    if (context.environment.kind !== "test") return Promise.resolve(unavailableStack("UNAUTHORIZED"));
    if (context.environment.stackId !== null) return Promise.resolve(unavailableStack("INVALID_INPUT"));
    return fixtureStackUp(input, context);
  },
  down(input: TestStackDownInputV1, context: OpsControlContextV1): Promise<Result<TestStackOperationV1>> {
    if (!testStackDownInputSchema.safeParse(input).success || !opsControlContextSchema.safeParse(context).success) {
      return Promise.resolve(unavailableStack("INVALID_INPUT"));
    }
    if (context.environment.kind !== "test") return Promise.resolve(unavailableStack("UNAUTHORIZED"));
    if (context.environment.stackId === null) return Promise.resolve(unavailableStack("INVALID_INPUT"));
    return fixtureStackDown(input, context);
  },
  inspect(context: OpsControlContextV1): Result<TestStackOperationV1> {
    if (!opsControlContextSchema.safeParse(context).success) return unavailableStack("INVALID_INPUT");
    return fixtureStackInspect(context);
  }
};
