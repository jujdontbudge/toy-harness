import { spawnSync } from "node:child_process";
import { checkViewSchema, serviceRoleIdentityInventorySchema, serviceRoleIdentityObservationSchema, serviceRoleNameSchema } from "@toy/contracts";
import type { CheckViewV1, ServiceRoleIdentityObservationV1, ServiceRoleNameV1 } from "@toy/contracts";

const identity = (role: ServiceRoleNameV1, deadline: bigint): ServiceRoleIdentityObservationV1 => {
  const unknown = serviceRoleIdentityObservationSchema.parse({ role, state: "unknown", uid: null, gid: null, adminGroupObserved: null });
  if (process.platform !== "darwin") return unknown;
  const query = (option: "-u" | "-g" | "-Gn") => {
    const remaining = Number((deadline - process.hrtime.bigint()) / 1000000n);
    if (remaining < 1) return null;
    try {
      return spawnSync("/usr/bin/id", [option, role], { env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 8192, timeout: Math.min(500, remaining) });
    } catch { return null; }
  };
  const uidResult = query("-u");
  if (uidResult?.error === undefined && uidResult?.status === 1 && /no such user/i.test(uidResult.stderr)) return { ...unknown, state: "missing" };
  const numeric = (result: ReturnType<typeof query>): number | null => {
    if (result === null || result.error !== undefined || result.status !== 0 || !/^(?:0|[1-9][0-9]{0,9})\s*$/.test(result.stdout)) return null;
    const value = Number(result.stdout.trim());
    return Number.isSafeInteger(value) && value <= 4294967295 ? value : null;
  };
  const uid = numeric(uidResult);
  if (uid === null) return unknown;
  const gid = numeric(query("-g"));
  const groups = query("-Gn");
  if (gid === null || groups === null || groups.error !== undefined || groups.status !== 0) return { ...unknown, uid, gid };
  const groupNames = groups.stdout.trim().split(/\s+/);
  if (groupNames.length > 128 || groupNames.some(name => !/^[A-Za-z0-9_.-]{1,256}$/.test(name))) return { ...unknown, uid, gid };
  return serviceRoleIdentityObservationSchema.parse({ role, state: "observed", uid, gid, adminGroupObserved: groupNames.includes("admin") });
};

export const inspectRoleIdentities = (remainingMs: number): CheckViewV1 => {
  const deadline = process.hrtime.bigint() + BigInt(Math.max(0, Math.floor(remainingMs))) * 1000000n;
  const roles = serviceRoleNameSchema.options.map(role => identity(role, deadline));
  const observed = roles.filter(role => role.state === "observed");
  const inventory = serviceRoleIdentityInventorySchema.parse({ schemaVersion: "toy.service-role-identity-inventory.v1", observedAt: new Date().toISOString(), roles, allExpectedIdentitiesObserved: observed.length === roles.length, identityGateVerified: false, maintenanceIdentityVerified: false });
  const unsafe = observed.some(role => role.adminGroupObserved || role.uid === 0) || new Set(observed.map(role => role.uid)).size !== observed.length;
  return checkViewSchema.parse({ id: "bootstrap.role-identities", owner: "ops", state: unsafe ? "FAIL" : "BLOCKED", checkedAt: inventory.observedAt, reasonCode: unsafe ? "SERVICE_IDENTITY_UNSAFE" : roles.some(role => role.state === "unknown") ? "SERVICE_IDENTITY_OBSERVATION_UNAVAILABLE" : roles.some(role => role.state === "missing") ? "SERVICE_IDENTITIES_MISSING" : "IDENTITIES_OBSERVED_ENFORCEMENT_PENDING", nextCommandId: "doctor", prerequisite: JSON.stringify(inventory), links: { recordRefs: [], observations: [], artifactDigests: [] } });
};
