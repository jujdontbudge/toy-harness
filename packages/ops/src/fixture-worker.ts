import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { fixtureStackRecordSchema, fixtureWorkerStateSchema } from "@toy/contracts";

const worldRoot = process.argv[2];
if (!worldRoot) process.exit(2);
const decoded: unknown = JSON.parse(readFileSync(worldRoot + "/manifest.json", "utf8"));
const manifest = fixtureStackRecordSchema.parse(decoded);
if (manifest.schemaVersion !== "toy.r0-fixture-stack.v1" || process.getuid?.() !== manifest.ownerUid) process.exit(3);
const db = new DatabaseSync(worldRoot + "/world.db");
db.exec("PRAGMA busy_timeout=1000");
const deadline = process.hrtime.bigint() + 7200000000000n;
let checks = 0n;
const record = (state: "running" | "stopped"): void => {
  const value = fixtureWorkerStateSchema.parse({
    stackId: manifest.stackId, nonce: manifest.nonce, pid: process.pid, state,
    checkedAt: new Date().toISOString(), heartbeatCount: String(checks)
  });
  db.prepare("INSERT OR REPLACE INTO worker VALUES (1,?)").run(JSON.stringify(value));
};
try {
  while (process.hrtime.bigint() < deadline && db.prepare("SELECT stop FROM control WHERE singleton=1").get()?.stop === 0) {
    checks += 1n;
    record("running");
    await delay(100);
  }
  record("stopped");
} finally { db.close(); }
