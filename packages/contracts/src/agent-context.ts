import { z } from "zod";
import { digestSchema, revisionSchema, uuidSchema } from "./primitives.js";

export const runContextSchema = z.strictObject({
  profile: z.literal("toy"), runId: uuidSchema, parentRunId: uuidSchema.nullable(), actorId: uuidSchema,
  sessionId: z.string().min(1).nullable(), turnId: z.string().min(1).nullable(),
  wireSchemaVersion: z.literal("toy-agent/v1"), contractVersion: z.int().positive(),
  recordRevision: revisionSchema, releaseDigest: digestSchema, generation: revisionSchema,
  source: z.enum(["discord", "cli", "rpc", "runs", "cron", "event", "continuation", "codex"]),
  permissionRefs: z.array(uuidSchema)
});
export type RunContext = z.infer<typeof runContextSchema>;
export const agentContextSchemaInventory = { RunContext: runContextSchema };
