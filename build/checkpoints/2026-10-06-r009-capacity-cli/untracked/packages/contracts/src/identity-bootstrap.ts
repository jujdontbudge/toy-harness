import { z } from "zod";
import { digestSchema, instantSchema, uuidSchema } from "./primitives.js";
import { serviceRoleIdentityObservationSchema, serviceRoleNameSchema } from "./test-control.js";

export const roleBootstrapRoot = "/Library/Application Support/Toy";
export const roleBootstrapInputSchema = z.strictObject({
  plan: z.boolean(), requestId: uuidSchema, expectedSnapshotDigest: digestSchema.nullable()
}).refine(value => value.plan === (value.expectedSnapshotDigest === null), "Plan has no snapshot; apply requires one");
export const roleBootstrapRoleSchema = z.strictObject({
  observation: serviceRoleIdentityObservationSchema,
  candidateUid: z.int().min(300).max(499).nullable(), candidateGid: z.int().min(300).max(499).nullable()
}).refine(value => value.candidateUid === value.candidateGid, "Each proposed role has one dedicated UID/GID pair");
export const roleBootstrapDirectorySchema = z.strictObject({
  path: z.enum([roleBootstrapRoot, roleBootstrapRoot + "/control", roleBootstrapRoot + "/state", roleBootstrapRoot + "/state/homes", roleBootstrapRoot + "/run", ...serviceRoleNameSchema.options.map(role => roleBootstrapRoot + "/state/homes/" + role)]),
  owner: z.enum(["root", ...serviceRoleNameSchema.options]), mode: z.enum(["0700", "0711", "0755"])
});
export const roleBootstrapReportSchema = z.strictObject({
  schemaVersion: z.literal("toy.role-identity-bootstrap.v1"), requestId: uuidSchema, observedAt: instantSchema,
  mode: z.enum(["plan", "apply"]), state: z.enum(["planned", "blocked", "created", "partial"]),
  reasonCode: z.enum(["PLAN_READY", "ROOT_CALLER_REQUIRED", "SNAPSHOT_CHANGED", "DIRECTORY_QUERY_UNAVAILABLE", "DIRECTORY_QUERY_DENIED", "DIRECTORY_QUERY_TIMEOUT", "DIRECTORY_QUERY_INVALID", "ROLE_NAME_CONFLICT", "ID_POOL_EXHAUSTED", "PATH_CONFLICT", "OS_CHANGE_FAILED", "ROLE_IDENTITIES_CREATED"]),
  snapshotDigest: digestSchema.nullable(), allocationMethod: z.literal("observed_vacancy"),
  callerUid: z.int().nonnegative().max(4294967295), roles: z.array(roleBootstrapRoleSchema).length(8),
  directories: z.array(roleBootstrapDirectorySchema).length(13), accountsVerified: z.int().min(0).max(8),
  effectState: z.enum(["none", "confirmed", "unknown"]),
  identityGateVerified: z.literal(false), maintenanceIdentityVerified: z.literal(false), servicesActivated: z.literal(false)
}).refine(value => new Set(value.roles.map(role => role.observation.role)).size === 8, "Canonical roles appear once")
  .refine(value => new Set(value.directories.map(directory => directory.path)).size === 13, "Canonical directories appear once")
  .refine(value => value.state === "partial" ? value.effectState === "unknown" && value.mode === "apply" : value.state === "created" ? value.mode === "apply" : value.effectState === "none", "State and effect evidence agree")
  .refine(value => value.state !== "created" || value.accountsVerified === 8 && value.effectState === "confirmed" && value.roles.every(role => role.observation.state === "observed" && role.observation.uid === role.candidateUid && role.observation.gid === role.candidateGid && role.observation.adminGroupObserved === false), "Created report requires all role readbacks and confirmed effects");
export type RoleBootstrapInputV1 = z.infer<typeof roleBootstrapInputSchema>;
export type RoleBootstrapRoleV1 = z.infer<typeof roleBootstrapRoleSchema>;
export type RoleBootstrapDirectoryV1 = z.infer<typeof roleBootstrapDirectorySchema>;
export type RoleBootstrapReportV1 = z.infer<typeof roleBootstrapReportSchema>;
export const identityBootstrapSchemaInventory = {
  RoleBootstrapInputV1: roleBootstrapInputSchema, RoleBootstrapRoleV1: roleBootstrapRoleSchema,
  RoleBootstrapDirectoryV1: roleBootstrapDirectorySchema, RoleBootstrapReportV1: roleBootstrapReportSchema
};
