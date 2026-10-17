import { z } from "zod";

export const installedHermesDependencyRecordSchema = z.object({
  packages: z.object({ venv: z.object({ environment: z.string().min(1).max(4096) }) })
});
export const hermesPublicRuntimeCommandSchema = z.array(z.string().min(1).max(16384)).length(5);
export type InstalledHermesDependencyRecordV1 = z.infer<typeof installedHermesDependencyRecordSchema>;
export type HermesPublicRuntimeCommandV1 = z.infer<typeof hermesPublicRuntimeCommandSchema>;
export const hermesRuntimeSchemaInventory = {
  InstalledHermesDependencyRecordV1: installedHermesDependencyRecordSchema,
  HermesPublicRuntimeCommandV1: hermesPublicRuntimeCommandSchema
};
