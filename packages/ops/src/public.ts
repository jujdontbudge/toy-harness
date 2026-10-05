import {
  capabilityViewSchema, checkViewSchema, cliDeclarations, controlStatusInputSchema, controlStatusSchema, doctorInputSchema, doctorReportSchema,
  evidenceLinksSchema, opsControlContextSchema, opsControlReadInventory, releaseSchema, secretReadinessSchema, serviceIdSchema
} from "@toy/contracts";
import type { ControlStatusInputV1, ControlStatusV1, DoctorInputV1, DoctorReportV1, OpsControlContextV1, Release } from "@toy/contracts";
export type { ModuleId } from "@toy/contracts";

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
    return Promise.resolve(unavailableSnapshot(request.release ?? "R0", context));
  },
  doctor(input: DoctorInputV1, context: OpsControlContextV1): Promise<DoctorReportV1> {
    const request = doctorInputSchema.parse(input);
    const snapshot = unavailableSnapshot(request.release ?? "R0", context);
    return Promise.resolve(doctorReportSchema.parse({
      requiredRelease: snapshot.requiredRelease, deep: request.deep, checks: snapshot.probes, verdict: "NOT_IMPLEMENTED",
      complete: false, links: { recordRefs: [], observations: [], artifactDigests: [] }
    }));
  }
};
