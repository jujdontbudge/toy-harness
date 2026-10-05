import { z } from "zod";

export const moduleIdSchema = z.enum([
  "contracts", "obligations", "attention", "authority", "sources", "lifestore",
  "hermes", "client", "hands", "self-improvement", "adhd", "ops"
]);
export type ModuleId = z.infer<typeof moduleIdSchema>;

export const uuidSchema = z.uuid();
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const instantSchema = z.iso.datetime({ precision: 3 });
export const revisionSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const uint64Schema = revisionSchema.refine((value) => BigInt(value) <= 18446744073709551615n);
export type UUID = z.infer<typeof uuidSchema>;
export type Digest = z.infer<typeof digestSchema>;
export type Instant = z.infer<typeof instantSchema>;
export type Revision = z.infer<typeof revisionSchema>;
export type UInt64String = z.infer<typeof uint64Schema>;
