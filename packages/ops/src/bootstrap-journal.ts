import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, readdirSync, writeFileSync
} from "node:fs";
import { userInfo } from "node:os";
import { join, isAbsolute } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import {
  bootstrapJournalOwnerSchema, bootstrapJournalStateSchema, bootstrapOperationRecordSchema,
  bootstrapUpRequestSchema, opsErrorMessages, opsTestStackResultSchema, uint64Maximum
} from "@toy/contracts";
import type {
  BootstrapJournalOwnerV1, BootstrapOperationRecordV1, BootstrapUpRequestV1,
  OpsErrorCode, Result, TestStackOperationV1, TestStackUpInputV1
} from "@toy/contracts";

class JournalRefusal extends Error {
  constructor(readonly code: OpsErrorCode) { super(code); }
}

const refuse = (code: OpsErrorCode): never => { throw new JournalRefusal(code); };
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
const ddl = [
  `CREATE TABLE bootstrap_owner (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    owner_json TEXT NOT NULL CHECK (json_valid(owner_json)),
    state_json TEXT NOT NULL CHECK (json_valid(state_json))
  ) STRICT`,
  `CREATE TABLE ops_operation (
    id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL CHECK (kind = 'stack.up'),
    idempotency_key TEXT UNIQUE NOT NULL, request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
    request_json TEXT NOT NULL CHECK (json_valid(request_json)),
    state TEXT NOT NULL CHECK (state IN ('queued','running','succeeded','failed','blocked')),
    created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, error_code TEXT, incident_id TEXT,
    CHECK (state = 'blocked' AND started_at IS NULL AND finished_at = created_at
      AND error_code = 'DEPENDENCY_UNAVAILABLE' AND incident_id IS NULL)
  ) STRICT`,
  `CREATE TABLE bootstrap_stack_operation (
    operation_id TEXT PRIMARY KEY NOT NULL REFERENCES ops_operation(id),
    stack_id TEXT UNIQUE NOT NULL, generation TEXT UNIQUE NOT NULL,
    receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
    CHECK (generation NOT GLOB '*[^0-9]*' AND length(generation) BETWEEN 1 AND 20
      AND (generation = '0' OR substr(generation,1,1) != '0')
      AND (length(generation) < 20 OR generation <= '18446744073709551615'))
  ) STRICT`,
  `CREATE TABLE ops_event (
    seq INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind = 'bootstrap.stack.blocked'),
    operation_id TEXT NOT NULL UNIQUE REFERENCES ops_operation(id), incident_id TEXT, release_id TEXT,
    detail_json TEXT NOT NULL CHECK (json_valid(detail_json)), CHECK (incident_id IS NULL AND release_id IS NULL)
  ) STRICT`,
  ...["ops_operation", "bootstrap_stack_operation", "ops_event"].flatMap((table) => [
    `CREATE TRIGGER ${table}_immutable_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RECORD'); END`,
    `CREATE TRIGGER ${table}_immutable_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RECORD'); END`
  ])
];
const schemaSQL = [...ddl].sort();

const decode = (value: unknown): unknown => {
  if (typeof value !== "string" || Buffer.byteLength(value) > 8192) return refuse("ATTESTATION_INVALID");
  try { const decoded: unknown = JSON.parse(value); return decoded; }
  catch { return refuse("ATTESTATION_INVALID"); }
};

const ownedDirectory = (path: string, uid: number, privateDirectory: boolean): void => {
  const info = lstatSync(path, { bigint: true });
  if (!info.isDirectory() || info.uid !== BigInt(uid) || (info.mode & 0o022n) !== 0n
    || privateDirectory && (info.mode & 0o077n) !== 0n) refuse("ATTESTATION_INVALID");
};

const ownedFile = (path: string, uid: number, maximumBytes: bigint): void => {
  const info = lstatSync(path, { bigint: true });
  if (!info.isFile() || info.uid !== BigInt(uid) || info.nlink !== 1n
    || (info.mode & 0o077n) !== 0n || info.size > maximumBytes) refuse("ATTESTATION_INVALID");
};

const syncDirectory = (path: string): void => {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
};

const createDirectory = (path: string): boolean => {
  try { mkdirSync(path, { mode: 0o700 }); return true; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") return false;
    throw error;
  }
};

const inventory = (root: string, uid: number): void => {
  ownedDirectory(root, uid, true);
  for (const name of readdirSync(root)) {
    if (!["owner.json", "ops.db", "ops.db-wal", "ops.db-shm"].includes(name)) refuse("ATTESTATION_INVALID");
    ownedFile(join(root, name), uid, name === "owner.json" ? 8192n : 67108864n);
  }
};

const storeRoot = (): { root: string; owner: BootstrapJournalOwnerV1; created: boolean } => {
  if (process.platform !== "darwin" || process.versions.node !== "24.21.0"
    || !process.getuid || !process.geteuid || !process.getgid || !process.getegid) return refuse("DEPENDENCY_UNAVAILABLE");
  const account = userInfo();
  const uid = process.geteuid(); const gid = process.getegid();
  if (uid === 0 || uid !== process.getuid() || gid !== process.getgid() || uid !== account.uid || gid !== account.gid
    || !isAbsolute(account.homedir)) return refuse("UNAUTHORIZED");
  const library = join(account.homedir, "Library");
  const support = join(library, "Application Support");
  for (const path of [account.homedir, library, support]) ownedDirectory(path, uid, false);
  const base = join(support, "ToyBootstrap");
  createDirectory(base);
  ownedDirectory(base, uid, true);
  if (readdirSync(base).some((name) => name !== "control")) return refuse("ATTESTATION_INVALID");
  const root = join(base, "control");
  const created = createDirectory(root);
  ownedDirectory(root, uid, true);
  const info = lstatSync(root, { bigint: true });
  const markerPath = join(root, "owner.json");
  let owner: BootstrapJournalOwnerV1;
  if (created) {
    owner = bootstrapJournalOwnerSchema.parse({
      schemaVersion: "toy.bootstrap-journal-owner.v1", storeId: randomUUID(), uid, gid,
      device: info.dev.toString(), inode: info.ino.toString(), createdAt: new Date().toISOString()
    });
    const fd = openSync(markerPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, JSON.stringify(owner) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
    syncDirectory(root); syncDirectory(base); syncDirectory(support);
  } else {
    inventory(root, uid);
    ownedFile(markerPath, uid, 8192n);
    const fd = openSync(markerPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = fstatSync(fd, { bigint: true });
      const parsed = bootstrapJournalOwnerSchema.safeParse(decode(readFileSync(fd, "utf8")));
      if (!parsed.success || !before.isFile() || before.uid !== BigInt(uid) || before.nlink !== 1n
        || (before.mode & 0o077n) !== 0n || before.size > 8192n) return refuse("ATTESTATION_INVALID");
      owner = parsed.data;
      const after = fstatSync(fd, { bigint: true });
      if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) return refuse("ATTESTATION_INVALID");
    } finally { closeSync(fd); }
  }
  if (owner.uid !== uid || owner.gid !== gid || owner.device !== info.dev.toString() || owner.inode !== info.ino.toString()) return refuse("ATTESTATION_INVALID");
  inventory(root, uid);
  return { root, owner, created };
};

const checkSchema = (db: DatabaseSync, owner: BootstrapJournalOwnerV1): void => {
  const version = db.prepare("PRAGMA user_version").get();
  if (version?.user_version !== 1) return refuse("INCOMPATIBLE_SCHEMA");
  const rows = db.prepare("SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL").all();
  const actual = rows.map((row) => {
    if (typeof row.sql !== "string") return refuse("ATTESTATION_INVALID");
    return row.sql;
  }).sort();
  if (JSON.stringify(actual) !== JSON.stringify(schemaSQL)) return refuse("INCOMPATIBLE_SCHEMA");
  const row = db.prepare("SELECT owner_json, state_json FROM bootstrap_owner WHERE singleton = 1").get();
  const parsedOwner = bootstrapJournalOwnerSchema.safeParse(decode(row?.owner_json));
  const state = bootstrapJournalStateSchema.safeParse(decode(row?.state_json));
  if (!parsedOwner.success || !state.success || JSON.stringify(parsedOwner.data) !== JSON.stringify(owner)
    || state.data.storeId !== owner.storeId) return refuse("ATTESTATION_INVALID");
  if (db.prepare("PRAGMA journal_mode").get()?.journal_mode !== "wal"
    || db.prepare("PRAGMA synchronous").get()?.synchronous !== 2
    || db.prepare("PRAGMA foreign_keys").get()?.foreign_keys !== 1) return refuse("ATTESTATION_INVALID");
};

const projection = (record: BootstrapOperationRecordV1): Result<TestStackOperationV1> => opsTestStackResultSchema.parse({
  ok: true, data: {
    operation: { operationId: record.operationId, state: record.state, acceptedAt: record.acceptedAt },
    requestId: record.requestId, stackId: record.stackId, result: null,
    links: { recordRefs: [
      { module: "ops", kind: "ops_operation", id: record.operationId },
      { module: "ops", kind: "bootstrap_stack", id: record.stackId }
    ], observations: [], artifactDigests: [] }
  }
});

const allocate = (db: DatabaseSync, owner: BootstrapJournalOwnerV1, request: BootstrapUpRequestV1): BootstrapOperationRecordV1 => {
  const requestJSON = JSON.stringify(request); const requestHash = digest(requestJSON);
  const key = "stack.up:" + request.requestId;
  const prior = db.prepare(`SELECT o.*, s.stack_id, s.generation, s.receipt_json, e.detail_json
    FROM ops_operation o JOIN bootstrap_stack_operation s ON s.operation_id = o.id
    JOIN ops_event e ON e.operation_id = o.id WHERE o.idempotency_key = ?`).get(key);
  if (prior) {
    const parsedRequest = bootstrapUpRequestSchema.safeParse(decode(prior.request_json));
    const parsedRecord = bootstrapOperationRecordSchema.safeParse(decode(prior.receipt_json));
    if (!parsedRequest.success || !parsedRecord.success) return refuse("ATTESTATION_INVALID");
    const record = parsedRecord.data;
    if (digest(JSON.stringify(parsedRequest.data)) !== prior.request_hash || record.requestDigest !== prior.request_hash
      || record.storeId !== owner.storeId || record.operationId !== prior.id || record.stackId !== prior.stack_id
      || record.generation !== prior.generation || record.acceptedAt !== prior.created_at || record.state !== prior.state
      || record.errorCode !== prior.error_code || record.requestId !== parsedRequest.data.requestId
      || prior.detail_json !== prior.receipt_json) return refuse("ATTESTATION_INVALID");
    if (prior.request_hash !== requestHash || prior.request_json !== requestJSON) return refuse("CONFLICT");
    return record;
  }
  if (db.prepare("SELECT id FROM ops_operation WHERE idempotency_key = ?").get(key)) return refuse("ATTESTATION_INVALID");
  if (request.release !== "R0" || request.clock !== "fake" || request.model !== "fake") return refuse("DEPENDENCY_UNAVAILABLE");
  const row = db.prepare("SELECT state_json FROM bootstrap_owner WHERE singleton = 1").get();
  const state = bootstrapJournalStateSchema.parse(decode(row?.state_json));
  if (state.storeId !== owner.storeId || state.nextGeneration === uint64Maximum) return refuse("CONFLICT");
  const record = bootstrapOperationRecordSchema.parse({
    schemaVersion: "toy.bootstrap-operation-record.v1", storeId: owner.storeId,
    operationId: randomUUID(), requestId: request.requestId, stackId: randomUUID(), generation: state.nextGeneration,
    requestDigest: requestHash, acceptedAt: new Date().toISOString(), state: "blocked", errorCode: "DEPENDENCY_UNAVAILABLE",
    nativeExecutionPerformed: false, resourcePermitIssued: false
  });
  const receiptJSON = JSON.stringify(record);
  db.prepare(`INSERT INTO ops_operation
    (id,kind,idempotency_key,request_hash,request_json,state,created_at,finished_at,error_code)
    VALUES (?,'stack.up',?,?,?,'blocked',?,?,'DEPENDENCY_UNAVAILABLE')`).run(
    record.operationId, key, requestHash, requestJSON, record.acceptedAt, record.acceptedAt
  );
  db.prepare("INSERT INTO bootstrap_stack_operation VALUES (?,?,?,?)").run(record.operationId, record.stackId, record.generation, receiptJSON);
  db.prepare("INSERT INTO ops_event (at,kind,operation_id,detail_json) VALUES (?,'bootstrap.stack.blocked',?,?)").run(record.acceptedAt, record.operationId, receiptJSON);
  const next = bootstrapJournalStateSchema.parse({ ...state, nextGeneration: (BigInt(state.nextGeneration) + 1n).toString() });
  db.prepare("UPDATE bootstrap_owner SET state_json = ? WHERE singleton = 1").run(JSON.stringify(next));
  return record;
};

export const recordBlockedBootstrapUp = (input: TestStackUpInputV1, timeoutMs: number): Result<TestStackOperationV1> => {
  const deadline = performance.now() + timeoutMs;
  const inTime = (): void => { if (performance.now() >= deadline) refuse("TIMEOUT"); };
  let db: DatabaseSync | undefined;
  try {
    inTime();
    const request = bootstrapUpRequestSchema.parse({
      schemaVersion: "toy.bootstrap-up-request.v1", requestId: input.requestId.toLowerCase(), release: input.release,
      world: input.world ?? "r0-bootstrap", clock: input.clock, model: input.model
    });
    const { root, owner, created } = storeRoot();
    const path = join(root, "ops.db");
    if (created) {
      const fd = openSync(path, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { fsyncSync(fd); } finally { closeSync(fd); }
      syncDirectory(root);
    } else if (!existsSync(path)) return refuse("ATTESTATION_INVALID");
    ownedFile(path, owner.uid, 16777216n);
    inTime();
    db = new DatabaseSync(path, {
      timeout: Math.max(1, Math.min(5000, Math.floor(deadline - performance.now()))),
      enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false,
      allowExtension: false, defensive: true, limits: { length: 1048576, sqlLength: 32768, column: 64, attach: 0 }
    });
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    inventory(root, owner.uid);
    inTime();
    db.exec("BEGIN IMMEDIATE");
    try {
      if (created) {
        for (const sql of ddl) db.exec(sql);
        const state = bootstrapJournalStateSchema.parse({ schemaVersion: "toy.bootstrap-journal-state.v1", storeId: owner.storeId, nextGeneration: "1" });
        db.prepare("INSERT INTO bootstrap_owner VALUES (1,?,?)").run(JSON.stringify(owner), JSON.stringify(state));
        db.exec("PRAGMA user_version=1");
      }
      checkSchema(db, owner);
      const record = allocate(db, owner, request);
      inTime(); inventory(root, owner.uid);
      db.exec("COMMIT");
      syncDirectory(root);
      return projection(record);
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  } catch (error) {
    const code = error instanceof JournalRefusal ? error.code
      : error instanceof Error && "errcode" in error && (error.errcode === 5 || error.errcode === 6) ? "TIMEOUT"
      : "ATTESTATION_INVALID";
    return opsTestStackResultSchema.parse({ ok: false, error: { module: "ops", code, retryable: code === "TIMEOUT", message: opsErrorMessages[code] } });
  } finally { db?.close(); }
};
