import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, readdirSync, writeFileSync
} from "node:fs";
import { userInfo } from "node:os";
import { join, isAbsolute } from "node:path";
import { performance } from "node:perf_hooks";
import { backup, DatabaseSync } from "node:sqlite";
import {
  bootstrapJournalBackupIntentSchema, bootstrapJournalBackupReceiptSchema, bootstrapJournalCountsSchema,
  bootstrapJournalMigrationSchema, bootstrapJournalOwnerSchema, bootstrapJournalReadSchema, bootstrapJournalStateSchema,
  bootstrapOperationRecordSchema, bootstrapUpRequestSchema, checkViewSchema, opsErrorMessages, opsTestStackResultSchema,
  uint64Maximum, uint64Schema
} from "@toy/contracts";
import type {
  BootstrapJournalBackupIntentV1, BootstrapJournalBackupReceiptV1, BootstrapJournalMigrationV1,
  BootstrapJournalOwnerV1, BootstrapOperationRecordV1, BootstrapUpRequestV1, CheckViewV1,
  OpsErrorCode, Result, TestStackOperationV1, TestStackUpInputV1
} from "@toy/contracts";

class JournalRefusal extends Error {
  constructor(readonly code: OpsErrorCode) { super(code); }
}

const refuse = (code: OpsErrorCode): never => { throw new JournalRefusal(code); };
const digest = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
const legacyDDL = [
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
const migrationDDL = [
  `CREATE TABLE bootstrap_migration (
    source_version INTEGER PRIMARY KEY CHECK (source_version = 1), target_version INTEGER NOT NULL CHECK (target_version = 2),
    id TEXT UNIQUE NOT NULL, backup_id TEXT UNIQUE NOT NULL, receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
    CHECK (json_extract(receipt_json,'$.schemaVersion') IS 'toy.bootstrap-journal-migration.v1'
      AND json_extract(receipt_json,'$.migrationId') IS id AND json_extract(receipt_json,'$.backupId') IS backup_id
      AND json_extract(receipt_json,'$.sourceVersion') IS source_version AND json_extract(receipt_json,'$.targetVersion') IS target_version)
  ) STRICT`,
  `CREATE TABLE bootstrap_attempt_owner (
    operation_id TEXT PRIMARY KEY NOT NULL REFERENCES ops_operation(id), generation TEXT UNIQUE NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('running','reconciliation-required','stopped')),
    record_json TEXT NOT NULL CHECK (json_valid(record_json)),
    CHECK (json_extract(record_json,'$.schemaVersion') IS 'toy.bootstrap-attempt-owner.v1'
      AND json_extract(record_json,'$.operationId') IS operation_id AND json_extract(record_json,'$.generation') IS generation
      AND json_extract(record_json,'$.state') IS state)
  ) STRICT`,
  `CREATE TABLE bootstrap_work_lease (
    id TEXT PRIMARY KEY NOT NULL, slot INTEGER NOT NULL CHECK (slot = 1),
    operation_id TEXT UNIQUE NOT NULL REFERENCES bootstrap_attempt_owner(operation_id),
    state TEXT NOT NULL CHECK (state IN ('held','reconciliation-required','released')),
    record_json TEXT NOT NULL CHECK (json_valid(record_json)),
    CHECK (json_extract(record_json,'$.schemaVersion') IS 'toy.bootstrap-work-lease.v1'
      AND json_extract(record_json,'$.leaseId') IS id AND json_extract(record_json,'$.operationId') IS operation_id
      AND json_extract(record_json,'$.state') IS state AND json_extract(record_json,'$.protectedGlobalLeaseVerified') IS 0)
  ) STRICT`,
  `CREATE UNIQUE INDEX bootstrap_single_active_lease ON bootstrap_work_lease(slot) WHERE state IN ('held','reconciliation-required')`,
  `CREATE TRIGGER bootstrap_migration_immutable_update BEFORE UPDATE ON bootstrap_migration BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RECORD'); END`,
  `CREATE TRIGGER bootstrap_migration_immutable_delete BEFORE DELETE ON bootstrap_migration BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RECORD'); END`
];
const legacySchemaSQL = [...legacyDDL].sort();
const currentSchemaSQL = [...legacyDDL, ...migrationDDL].sort();
const legacySchemaDigest = digest(JSON.stringify(legacySchemaSQL));
const currentSchemaDigest = digest(JSON.stringify(currentSchemaSQL));

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

const readOwned = (path: string, uid: number, maximumBytes: bigint): Buffer => {
  ownedFile(path, uid, maximumBytes);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.uid !== BigInt(uid) || before.nlink !== 1n || (before.mode & 0o077n) !== 0n || before.size > maximumBytes) return refuse("ATTESTATION_INVALID");
    const bytes = readFileSync(fd);
    const after = fstatSync(fd, { bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) return refuse("ATTESTATION_INVALID");
    return bytes;
  } finally { closeSync(fd); }
};

const writeNewJSON = (root: string, path: string, value: unknown): void => {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, JSON.stringify(value) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
  syncDirectory(root);
};

const inventory = (root: string, uid: number, storeId: string): void => {
  ownedDirectory(root, uid, true);
  const names = readdirSync(root);
  const intents = new Map<string, BootstrapJournalBackupIntentV1>();
  for (const name of names) {
    if (["owner.json", "ops.db", "ops.db-wal", "ops.db-shm"].includes(name)) {
      ownedFile(join(root, name), uid, name === "owner.json" ? 8192n : 67108864n);
      continue;
    }
    const matched = /^backup\.([a-f0-9-]{36})\.(intent\.json|receipt\.json|db(?:-journal|-wal|-shm)?)$/.exec(name);
    if (!matched?.[1] || !matched[2]) return refuse("ATTESTATION_INVALID");
    ownedFile(join(root, name), uid, matched[2].endsWith("json") ? 8192n : 67108864n);
    if (matched[2] === "intent.json") {
      const intent = bootstrapJournalBackupIntentSchema.safeParse(decode(readOwned(join(root, name), uid, 8192n).toString("utf8")));
      if (!intent.success || intent.data.backupId !== matched[1] || intent.data.storeId !== storeId || intent.data.sourceSchemaDigest !== legacySchemaDigest) return refuse("BACKUP_INCOMPLETE");
      intents.set(matched[1], intent.data);
    }
  }
  if (intents.size > 8) return refuse("BACKUP_INCOMPLETE");
  for (const name of names.filter((entry) => entry.startsWith("backup."))) {
    const id = name.slice(7, 43);
    const intent = intents.get(id);
    if (!intent) return refuse("BACKUP_INCOMPLETE");
    if (name.endsWith(".receipt.json")) {
      const receipt = bootstrapJournalBackupReceiptSchema.safeParse(decode(readOwned(join(root, name), uid, 8192n).toString("utf8")));
      if (!receipt.success || receipt.data.backupId !== id || receipt.data.storeId !== storeId
        || receipt.data.sourceSchemaDigest !== intent.sourceSchemaDigest || receipt.data.sourceLogicalDigest !== intent.sourceLogicalDigest
        || receipt.data.nextGeneration !== intent.nextGeneration || receipt.data.startedAt !== intent.startedAt
        || JSON.stringify(receipt.data.counts) !== JSON.stringify(intent.counts)) return refuse("BACKUP_INCOMPLETE");
    }
  }
};

const storeRoot = (mode: "create" | "inspect" = "create"): { root: string; owner: BootstrapJournalOwnerV1; created: boolean } => {
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
  if (mode === "create") createDirectory(base);
  else if (!existsSync(base)) return refuse("DEPENDENCY_UNAVAILABLE");
  ownedDirectory(base, uid, true);
  if (readdirSync(base).some((name) => name !== "control")) return refuse("ATTESTATION_INVALID");
  const root = join(base, "control");
  const created = mode === "create" ? createDirectory(root) : false;
  if (mode === "inspect" && !existsSync(root)) return refuse("DEPENDENCY_UNAVAILABLE");
  ownedDirectory(root, uid, true);
  const info = lstatSync(root, { bigint: true });
  const markerPath = join(root, "owner.json");
  let owner: BootstrapJournalOwnerV1;
  if (created) {
    owner = bootstrapJournalOwnerSchema.parse({
      schemaVersion: "toy.bootstrap-journal-owner.v1", storeId: randomUUID(), uid, gid,
      device: info.dev.toString(), inode: info.ino.toString(), createdAt: new Date().toISOString()
    });
    writeNewJSON(root, markerPath, owner);
    syncDirectory(root); syncDirectory(base); syncDirectory(support);
  } else {
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
  inventory(root, uid, owner.storeId);
  return { root, owner, created };
};

const checkSchema = (db: DatabaseSync, owner: BootstrapJournalOwnerV1, snapshot = false): 1 | 2 => {
  const version = db.prepare("PRAGMA user_version").get();
  if (version?.user_version !== 1 && version?.user_version !== 2) return refuse("INCOMPATIBLE_SCHEMA");
  if (snapshot && version.user_version !== 1) return refuse("BACKUP_INCOMPLETE");
  const rows = db.prepare("SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL").all();
  const actual = rows.map((row) => {
    if (typeof row.sql !== "string") return refuse("ATTESTATION_INVALID");
    return row.sql;
  }).sort();
  if (JSON.stringify(actual) !== JSON.stringify(version.user_version === 1 ? legacySchemaSQL : currentSchemaSQL)) return refuse("INCOMPATIBLE_SCHEMA");
  const row = db.prepare("SELECT owner_json, state_json FROM bootstrap_owner WHERE singleton = 1").get();
  const parsedOwner = bootstrapJournalOwnerSchema.safeParse(decode(row?.owner_json));
  const state = bootstrapJournalStateSchema.safeParse(decode(row?.state_json));
  if (!parsedOwner.success || !state.success || JSON.stringify(parsedOwner.data) !== JSON.stringify(owner)
    || state.data.storeId !== owner.storeId) return refuse("ATTESTATION_INVALID");
  if (db.prepare("PRAGMA journal_mode").get()?.journal_mode !== (snapshot ? "delete" : "wal")
    || db.prepare("PRAGMA synchronous").get()?.synchronous !== 2
    || db.prepare("PRAGMA foreign_keys").get()?.foreign_keys !== 1) return refuse("ATTESTATION_INVALID");
  return version.user_version;
};

const openDatabase = (path: string, deadline: number, readOnly = false): DatabaseSync => {
  if (performance.now() >= deadline) return refuse("TIMEOUT");
  const db = new DatabaseSync(path, {
    readOnly, timeout: Math.max(1, Math.min(5000, Math.floor(deadline - performance.now()))),
    enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false,
    allowExtension: false, defensive: true, limits: { length: 1048576, sqlLength: 32768, column: 64, attach: 0 }
  });
  try { db.exec("PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;"); return db; }
  catch (error) { db.close(); throw error; }
};

const operationQuery = `SELECT o.*, s.stack_id, s.generation, s.receipt_json, e.detail_json,
  e.at AS event_at, e.kind AS event_kind, CAST(e.seq AS TEXT) AS event_sequence
  FROM ops_operation o JOIN bootstrap_stack_operation s ON s.operation_id = o.id
  JOIN ops_event e ON e.operation_id = o.id`;

const recordedOperation = (row: Record<string, unknown>, owner: BootstrapJournalOwnerV1): BootstrapOperationRecordV1 => {
  const request = bootstrapUpRequestSchema.safeParse(decode(row.request_json));
  const parsed = bootstrapOperationRecordSchema.safeParse(decode(row.receipt_json));
  const sequence = uint64Schema.safeParse(row.event_sequence);
  if (!request.success || !parsed.success || !sequence.success || sequence.data === "0") return refuse("ATTESTATION_INVALID");
  const record = parsed.data;
  if (request.data.release !== "R0" || request.data.clock !== "fake" || request.data.model !== "fake"
    || request.data.requestId !== request.data.requestId.toLowerCase() || row.kind !== "stack.up"
    || row.idempotency_key !== "stack.up:" + request.data.requestId || record.generation === "0"
    || digest(JSON.stringify(request.data)) !== row.request_hash || row.request_json !== JSON.stringify(request.data)
    || record.requestDigest !== row.request_hash || record.storeId !== owner.storeId
    || record.operationId !== row.id || record.stackId !== row.stack_id || record.generation !== row.generation
    || record.acceptedAt !== row.created_at || record.state !== row.state || record.errorCode !== row.error_code
    || record.requestId !== request.data.requestId || row.started_at !== null || row.finished_at !== record.acceptedAt
    || row.incident_id !== null || row.event_at !== record.acceptedAt || row.event_kind !== "bootstrap.stack.blocked"
    || row.detail_json !== row.receipt_json || row.receipt_json !== JSON.stringify(record)) return refuse("ATTESTATION_INVALID");
  return record;
};

const logicalSnapshot = (db: DatabaseSync, owner: BootstrapJournalOwnerV1): Pick<BootstrapJournalBackupIntentV1, "counts" | "nextGeneration" | "sourceLogicalDigest"> => {
  const count = (table: "ops_operation" | "bootstrap_stack_operation" | "ops_event"): string => uint64Schema.parse(db.prepare("SELECT CAST(count(*) AS TEXT) AS count FROM " + table).get()?.count);
  const counts = bootstrapJournalCountsSchema.parse({ operations: count("ops_operation"), bindings: count("bootstrap_stack_operation"), events: count("ops_event") });
  if (counts.operations !== counts.bindings || counts.operations !== counts.events) return refuse("ATTESTATION_INVALID");
  const row = db.prepare("SELECT owner_json, state_json FROM bootstrap_owner WHERE singleton = 1").get();
  const state = bootstrapJournalStateSchema.parse(decode(row?.state_json));
  const rows = db.prepare(operationQuery + " ORDER BY o.id").all();
  if (BigInt(rows.length) !== BigInt(counts.operations)) return refuse("ATTESTATION_INVALID");
  for (const current of rows) {
    const record = recordedOperation(current, owner);
    if (BigInt(record.generation) >= BigInt(state.nextGeneration)) return refuse("ATTESTATION_INVALID");
  }
  if (db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok" || db.prepare("PRAGMA foreign_key_check").all().length !== 0) return refuse("ATTESTATION_INVALID");
  return { counts, nextGeneration: state.nextGeneration, sourceLogicalDigest: digest(JSON.stringify({ owner: row, rows })) };
};

const verifyBackup = (root: string, owner: BootstrapJournalOwnerV1, backupId: string, deadline: number): BootstrapJournalBackupReceiptV1 => {
  const stem = join(root, "backup." + backupId);
  const intent = bootstrapJournalBackupIntentSchema.parse(decode(readOwned(stem + ".intent.json", owner.uid, 8192n).toString("utf8")));
  const receipt = bootstrapJournalBackupReceiptSchema.parse(decode(readOwned(stem + ".receipt.json", owner.uid, 8192n).toString("utf8")));
  const bytes = readOwned(stem + ".db", owner.uid, 16777216n);
  if (intent.backupId !== backupId || receipt.backupId !== backupId || intent.storeId !== owner.storeId || receipt.storeId !== owner.storeId
    || intent.sourceSchemaDigest !== legacySchemaDigest || receipt.sourceSchemaDigest !== legacySchemaDigest
    || intent.startedAt !== receipt.startedAt || intent.sourceLogicalDigest !== receipt.sourceLogicalDigest
    || intent.nextGeneration !== receipt.nextGeneration || JSON.stringify(intent.counts) !== JSON.stringify(receipt.counts)
    || digest(bytes) !== receipt.artifactDigest || String(bytes.length) !== receipt.byteLength) return refuse("BACKUP_INCOMPLETE");
  const db = openDatabase(stem + ".db", deadline, true);
  try {
    db.exec("BEGIN"); checkSchema(db, owner, true);
    const snapshot = logicalSnapshot(db, owner);
    if (snapshot.sourceLogicalDigest !== receipt.sourceLogicalDigest || snapshot.nextGeneration !== receipt.nextGeneration
      || JSON.stringify(snapshot.counts) !== JSON.stringify(receipt.counts)
      || String(db.prepare("PRAGMA page_count").get()?.page_count) !== receipt.pageCount) return refuse("BACKUP_INCOMPLETE");
    db.exec("COMMIT");
  } finally { db.close(); }
  if (performance.now() >= deadline) return refuse("TIMEOUT");
  if (digest(readOwned(stem + ".db", owner.uid, 16777216n)) !== receipt.artifactDigest) return refuse("BACKUP_INCOMPLETE");
  return receipt;
};

const createBackup = async (root: string, owner: BootstrapJournalOwnerV1, writer: DatabaseSync, deadline: number): Promise<BootstrapJournalBackupReceiptV1> => {
  if (readdirSync(root).filter((name) => name.endsWith(".intent.json")).length >= 8) return refuse("BACKUP_INCOMPLETE");
  const source = openDatabase(join(root, "ops.db"), deadline, true);
  try {
    source.exec("BEGIN");
    if (checkSchema(source, owner) !== 1) return refuse("INCOMPATIBLE_SCHEMA");
    const snapshot = logicalSnapshot(source, owner);
    if (JSON.stringify(snapshot) !== JSON.stringify(logicalSnapshot(writer, owner))) return refuse("BACKUP_INCOMPLETE");
    const intent = bootstrapJournalBackupIntentSchema.parse({
      schemaVersion: "toy.bootstrap-journal-backup-intent.v1", backupId: randomUUID(), storeId: owner.storeId,
      sourceVersion: 1, targetVersion: 2, startedAt: new Date().toISOString(), sourceSchemaDigest: legacySchemaDigest, ...snapshot
    });
    const stem = join(root, "backup." + intent.backupId);
    writeNewJSON(root, stem + ".intent.json", intent);
    const fd = openSync(stem + ".db", constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const before = (() => { try { const info = fstatSync(fd, { bigint: true }); fsyncSync(fd); return info; } finally { closeSync(fd); } })();
    syncDirectory(root);
    const pages = await backup(source, stem + ".db", { rate: 16, progress: () => { if (performance.now() >= deadline) refuse("TIMEOUT"); } });
    if (performance.now() >= deadline) return refuse("TIMEOUT");
    if (!Number.isSafeInteger(pages) || pages < 1) return refuse("BACKUP_INCOMPLETE");
    const after = lstatSync(stem + ".db", { bigint: true });
    if (after.dev !== before.dev || after.ino !== before.ino) return refuse("BACKUP_INCOMPLETE");
    ownedFile(stem + ".db", owner.uid, 16777216n);
    const normalized = openDatabase(stem + ".db", deadline);
    try {
      if (normalized.prepare("PRAGMA journal_mode=DELETE").get()?.journal_mode !== "delete") return refuse("BACKUP_INCOMPLETE");
    } finally { normalized.close(); }
    const independent = openDatabase(stem + ".db", deadline, true);
    try {
      independent.exec("BEGIN"); checkSchema(independent, owner, true);
      if (JSON.stringify(logicalSnapshot(independent, owner)) !== JSON.stringify(snapshot)) return refuse("BACKUP_INCOMPLETE");
      independent.exec("COMMIT");
    } finally { independent.close(); }
    const backupFd = openSync(stem + ".db", constants.O_RDONLY | constants.O_NOFOLLOW);
    try { fsyncSync(backupFd); } finally { closeSync(backupFd); }
    const bytes = readOwned(stem + ".db", owner.uid, 16777216n);
    const receipt = bootstrapJournalBackupReceiptSchema.parse({
      ...intent, schemaVersion: "toy.bootstrap-journal-backup-receipt.v1", completedAt: new Date().toISOString(),
      artifactDigest: digest(bytes), byteLength: String(bytes.length), pageCount: String(pages), integrityVerified: true, sourceSnapshotVerified: true
    });
    writeNewJSON(root, stem + ".receipt.json", receipt);
    inventory(root, owner.uid, owner.storeId);
    return verifyBackup(root, owner, intent.backupId, deadline);
  } finally { source.close(); }
};

const migrationRecord = (db: DatabaseSync, owner: BootstrapJournalOwnerV1): BootstrapJournalMigrationV1 => {
  const rows = db.prepare("SELECT * FROM bootstrap_migration").all();
  if (rows.length !== 1) return refuse("BACKUP_INCOMPLETE");
  const row = rows[0];
  const parsed = bootstrapJournalMigrationSchema.safeParse(decode(row?.receipt_json));
  if (!parsed.success || row?.source_version !== 1 || row.target_version !== 2 || row.id !== parsed.data.migrationId
    || row.backup_id !== parsed.data.backupId || parsed.data.storeId !== owner.storeId
    || parsed.data.sourceSchemaDigest !== legacySchemaDigest || parsed.data.targetSchemaDigest !== currentSchemaDigest) return refuse("BACKUP_INCOMPLETE");
  return parsed.data;
};

const verifiedMigration = (db: DatabaseSync, root: string, owner: BootstrapJournalOwnerV1, deadline: number) => {
  const migration = migrationRecord(db, owner);
  const retained = verifyBackup(root, owner, migration.backupId, deadline);
  if (digest(JSON.stringify(retained)) !== migration.backupReceiptDigest || retained.sourceLogicalDigest !== migration.preservedLogicalDigest
    || JSON.stringify(retained.counts) !== JSON.stringify(migration.preservedCounts)) return refuse("BACKUP_INCOMPLETE");
  return { migration, retained };
};

const migrate = async (db: DatabaseSync, root: string, owner: BootstrapJournalOwnerV1, deadline: number): Promise<void> => {
  const receipt = await createBackup(root, owner, db, deadline);
  const snapshot = logicalSnapshot(db, owner);
  if (snapshot.sourceLogicalDigest !== receipt.sourceLogicalDigest || JSON.stringify(snapshot.counts) !== JSON.stringify(receipt.counts)) return refuse("BACKUP_INCOMPLETE");
  const record = bootstrapJournalMigrationSchema.parse({
    schemaVersion: "toy.bootstrap-journal-migration.v1", migrationId: randomUUID(), storeId: owner.storeId,
    sourceVersion: 1, targetVersion: 2, appliedAt: new Date().toISOString(), backupId: receipt.backupId,
    backupReceiptDigest: digest(JSON.stringify(receipt)), sourceSchemaDigest: legacySchemaDigest, targetSchemaDigest: currentSchemaDigest,
    preservedLogicalDigest: snapshot.sourceLogicalDigest, preservedCounts: snapshot.counts
  });
  for (const sql of migrationDDL) db.exec(sql);
  db.prepare("INSERT INTO bootstrap_migration VALUES (1,2,?,?,?)").run(record.migrationId, record.backupId, JSON.stringify(record));
  db.exec("PRAGMA user_version=2");
  if (checkSchema(db, owner) !== 2 || JSON.stringify(logicalSnapshot(db, owner)) !== JSON.stringify(snapshot)) return refuse("BACKUP_INCOMPLETE");
  if (performance.now() >= deadline) return refuse("TIMEOUT");
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

const existingOperation = (db: DatabaseSync, owner: BootstrapJournalOwnerV1, request: BootstrapUpRequestV1): BootstrapOperationRecordV1 | null => {
  const requestJSON = JSON.stringify(request); const requestHash = digest(requestJSON);
  const key = "stack.up:" + request.requestId;
  const prior = db.prepare(operationQuery + " WHERE o.idempotency_key = ?").get(key);
  if (prior) {
    const record = recordedOperation(prior, owner);
    if (prior.request_hash !== requestHash || prior.request_json !== requestJSON) return refuse("CONFLICT");
    return record;
  }
  if (db.prepare("SELECT id FROM ops_operation WHERE idempotency_key = ?").get(key)) return refuse("ATTESTATION_INVALID");
  return null;
};

const allocate = (db: DatabaseSync, owner: BootstrapJournalOwnerV1, request: BootstrapUpRequestV1): BootstrapOperationRecordV1 => {
  const prior = existingOperation(db, owner, request);
  if (prior) return prior;
  const requestJSON = JSON.stringify(request); const requestHash = digest(requestJSON);
  const key = "stack.up:" + request.requestId;
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

const errorCode = (error: unknown): OpsErrorCode => error instanceof JournalRefusal ? error.code
  : error instanceof Error && "errcode" in error && (error.errcode === 5 || error.errcode === 6) ? "TIMEOUT" : "ATTESTATION_INVALID";

export const findBlockedBootstrapUp = (input: TestStackUpInputV1, timeoutMs: number): Result<TestStackOperationV1> | null => {
  let db: DatabaseSync | undefined;
  try {
    const deadline = performance.now() + timeoutMs;
    const { root, owner } = storeRoot("inspect");
    const request = bootstrapUpRequestSchema.parse({
      schemaVersion: "toy.bootstrap-up-request.v1", requestId: input.requestId.toLowerCase(), release: input.release,
      world: input.world ?? "r0-bootstrap", clock: input.clock, model: input.model
    });
    ownedFile(join(root, "ops.db"), owner.uid, 16777216n);
    db = openDatabase(join(root, "ops.db"), deadline, true);
    checkSchema(db, owner);
    const prior = existingOperation(db, owner, request);
    return prior === null ? null : projection(prior);
  } catch (error) {
    const code = errorCode(error);
    return code === "DEPENDENCY_UNAVAILABLE" ? null : opsTestStackResultSchema.parse({
      ok: false, error: { module: "ops", code, retryable: code === "TIMEOUT", message: opsErrorMessages[code] }
    });
  } finally { db?.close(); }
};

export const recordBlockedBootstrapUp = async (input: TestStackUpInputV1, timeoutMs: number): Promise<Result<TestStackOperationV1>> => {
  const deadline = performance.now() + timeoutMs;
  const inTime = (): void => { if (performance.now() >= deadline) refuse("TIMEOUT"); };
  let db: DatabaseSync | undefined;
  try {
    inTime();
    const request = bootstrapUpRequestSchema.parse({
      schemaVersion: "toy.bootstrap-up-request.v1", requestId: input.requestId.toLowerCase(), release: input.release,
      world: input.world ?? "r0-bootstrap", clock: input.clock, model: input.model
    });
    const supported = request.release === "R0" && request.clock === "fake" && request.model === "fake";
    const { root, owner, created } = storeRoot(supported ? "create" : "inspect");
    const path = join(root, "ops.db");
    if (created) {
      const fd = openSync(path, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { fsyncSync(fd); } finally { closeSync(fd); }
      syncDirectory(root);
    } else if (!existsSync(path)) return refuse("ATTESTATION_INVALID");
    ownedFile(path, owner.uid, 16777216n);
    inTime();
    db = openDatabase(path, deadline, !supported);
    if (supported) db.exec("PRAGMA journal_mode=WAL;");
    inventory(root, owner.uid, owner.storeId);
    inTime();
    db.exec(supported ? "BEGIN IMMEDIATE" : "BEGIN");
    let transactionOpen = true;
    try {
      if (created) {
        for (const sql of legacyDDL) db.exec(sql);
        const state = bootstrapJournalStateSchema.parse({ schemaVersion: "toy.bootstrap-journal-state.v1", storeId: owner.storeId, nextGeneration: "1" });
        db.prepare("INSERT INTO bootstrap_owner VALUES (1,?,?)").run(JSON.stringify(owner), JSON.stringify(state));
        db.exec("PRAGMA user_version=1");
        db.exec("COMMIT");
        transactionOpen = false;
        db.exec("BEGIN IMMEDIATE");
        transactionOpen = true;
      }
      const version = checkSchema(db, owner);
      existingOperation(db, owner, request);
      if (!supported) return refuse("DEPENDENCY_UNAVAILABLE");
      if (version === 1) await migrate(db, root, owner, deadline);
      else verifiedMigration(db, root, owner, deadline);
      const record = allocate(db, owner, request);
      inTime(); inventory(root, owner.uid, owner.storeId);
      db.exec("COMMIT");
      transactionOpen = false;
      syncDirectory(root);
      return projection(record);
    } catch (error) { if (transactionOpen) db.exec("ROLLBACK"); throw error; }
  } catch (error) {
    const code = errorCode(error);
    return opsTestStackResultSchema.parse({ ok: false, error: { module: "ops", code, retryable: code === "TIMEOUT", message: opsErrorMessages[code] } });
  } finally { db?.close(); }
};

export const inspectBootstrapJournal = (timeoutMs: number): CheckViewV1 => {
  const deadline = performance.now() + timeoutMs;
  let db: DatabaseSync | undefined;
  try {
    const { root, owner } = storeRoot("inspect");
    ownedFile(join(root, "ops.db"), owner.uid, 16777216n);
    db = openDatabase(join(root, "ops.db"), deadline, true);
    db.exec("BEGIN");
    const version = checkSchema(db, owner);
    const snapshot = logicalSnapshot(db, owner);
    let migration: BootstrapJournalMigrationV1 | null = null;
    let retained: BootstrapJournalBackupReceiptV1 | null = null;
    let ownerCount = "0"; let leaseCount = "0";
    if (version === 2) {
      const verified = verifiedMigration(db, root, owner, deadline);
      migration = verified.migration; retained = verified.retained;
      ownerCount = uint64Schema.parse(db.prepare("SELECT CAST(count(*) AS TEXT) AS count FROM bootstrap_attempt_owner").get()?.count);
      leaseCount = uint64Schema.parse(db.prepare("SELECT CAST(count(*) AS TEXT) AS count FROM bootstrap_work_lease").get()?.count);
      if (ownerCount !== "0" || leaseCount !== "0") return refuse("ATTESTATION_INVALID");
    }
    const view = bootstrapJournalReadSchema.parse({
      schemaVersion: "toy.bootstrap-journal-read.v1", observedAt: new Date().toISOString(), storeId: owner.storeId,
      storeVersion: String(version), nextGeneration: snapshot.nextGeneration, counts: snapshot.counts,
      migrationId: migration?.migrationId ?? null, backupId: retained?.backupId ?? null,
      backupArtifactDigest: retained?.artifactDigest ?? null, backupReceiptDigest: migration?.backupReceiptDigest ?? null,
      preservedLogicalDigest: migration?.preservedLogicalDigest ?? null, preservedCounts: migration?.preservedCounts ?? null,
      backupVerified: retained !== null, ownerCount, leaseCount, runtimeAdmissionAvailable: false, protectedGlobalLeaseVerified: false
    });
    inventory(root, owner.uid, owner.storeId);
    if (performance.now() >= deadline) return refuse("TIMEOUT");
    db.exec("COMMIT");
    return checkViewSchema.parse({
      id: "bootstrap.journal", owner: "ops", state: version === 2 ? "PASS" : "BLOCKED", checkedAt: view.observedAt,
      reasonCode: version === 2 ? "BOOTSTRAP_V2_BACKUP_VERIFIED" : "BOOTSTRAP_V1_MIGRATION_REQUIRED",
      prerequisite: JSON.stringify(view), nextCommandId: "stack.up",
      links: { recordRefs: migration ? [{ module: "ops", kind: "bootstrap_migration", id: migration.migrationId }] : [],
        observations: [], artifactDigests: retained ? [retained.artifactDigest] : [] }
    });
  } catch (error) {
    const code = errorCode(error);
    return checkViewSchema.parse({
      id: "bootstrap.journal", owner: "ops", state: ["ATTESTATION_INVALID", "INCOMPATIBLE_SCHEMA", "BACKUP_INCOMPLETE"].includes(code) ? "FAIL" : "BLOCKED",
      checkedAt: new Date().toISOString(), reasonCode: code, prerequisite: opsErrorMessages[code], nextCommandId: "stack.up",
      links: { recordRefs: [], observations: [], artifactDigests: [] }
    });
  } finally { db?.close(); }
};
