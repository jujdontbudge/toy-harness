import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { modelAdmissionConnectionSchema, uuidSchema } from "@toy/contracts";
import type { ModelAdmissionConnectionV1 } from "@toy/contracts";
import { trustedCheckoutRoot } from "@toy/ops/public";
import { modelAdmissionMigration } from "./model-admission-migration.js";

const clientPath = "/opt/homebrew/opt/postgresql@17/bin/psql";
type AccountingReason = "ACCOUNTING_CLIENT_CHANGED" | "ACCOUNTING_DATABASE_UNAVAILABLE" | "ACCOUNTING_RESPONSE_INVALID" | "ACCOUNTING_DATABASE_SQL_FAILED" | "ACCOUNTING_DATABASE_PEER_AUTHENTICATION_FAILED" | "ACCOUNTING_DATABASE_PERMISSION_DENIED" | "ACCOUNTING_FIXTURE_OWNER_MISMATCH" | "ACCOUNTING_FIXTURE_SOCKET_IN_USE" | "ACCOUNTING_FIXTURE_INITIALIZATION_FAILED" | "ACCOUNTING_FIXTURE_INITIALIZATION_DENIED" | "ACCOUNTING_FIXTURE_OPTION_UNSUPPORTED" | "ACCOUNTING_FIXTURE_DATABASE_VERSION_MISMATCH" | "ACCOUNTING_FIXTURE_DATABASE_NOT_READY" | "ACCOUNTING_FIXTURE_MIGRATION_MISMATCH" | "ACCOUNTING_FIXTURE_TEARDOWN_UNCONFIRMED";
export class AccountingFailure extends Error {
  constructor(readonly reason: AccountingReason) { super(reason); }
}
export const sqlText = (value: string): string => "'" + value.replaceAll("'", "''") + "'";
export const sqlJson = (value: unknown): string => sqlText(JSON.stringify(value)) + "::jsonb";

const execute = (raw: ModelAdmissionConnectionV1, script: string, transactional = true): unknown => {
  const connection = modelAdmissionConnectionSchema.parse(raw);
  if (createHash("sha256").update(readFileSync(clientPath)).digest("hex") !== connection.clientDigest) throw new AccountingFailure("ACCOUNTING_CLIENT_CHANGED");
  const child = spawnSync(clientPath, ["-X", "-q", "-A", "-t", "-w", ...(transactional ? ["--single-transaction"] : []), "--file", "-", "--set", "ON_ERROR_STOP=1",
    "--host", connection.socketDirectory, "--port", "5432", "--dbname", connection.database, "--username", connection.peerRole], {
    input: script, encoding: "utf8", timeout: 5000, killSignal: "SIGKILL", maxBuffer: 1048576,
    env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin:/usr/sbin:/sbin", PGCONNECT_TIMEOUT: "3", PGCLIENTENCODING: "UTF8", PGPASSFILE: "/dev/null", PGSERVICEFILE: "/dev/null" },
    stdio: ["pipe", "pipe", "pipe"]
  });
  if (child.error || child.status !== 0) throw new AccountingFailure(/Peer authentication failed/i.test(child.stderr) ? "ACCOUNTING_DATABASE_PEER_AUTHENTICATION_FAILED"
    : /Permission denied|Operation not permitted/i.test(child.stderr) ? "ACCOUNTING_DATABASE_PERMISSION_DENIED"
      : /ERROR:/i.test(child.stderr) ? "ACCOUNTING_DATABASE_SQL_FAILED" : "ACCOUNTING_DATABASE_UNAVAILABLE");
  const lines = child.stdout.trim().split("\n").filter(line => line.trim() !== "");
  if (lines.length !== 1 || lines[0] === undefined) throw new AccountingFailure("ACCOUNTING_RESPONSE_INVALID");
  const result: unknown = JSON.parse(lines[0]);
  return result;
};

export const accountingQuery = (connection: ModelAdmissionConnectionV1, statement: string, mutation = false): unknown => execute(connection,
  "SET LOCAL standard_conforming_strings=on; SET LOCAL statement_timeout='4s'; SET TRANSACTION ISOLATION LEVEL READ COMMITTED;\n"
    + (mutation ? "SELECT pg_advisory_xact_lock(18374691);\n" : "") + statement + "\n");

export const accountingTestConnection = (stackId: string): ModelAdmissionConnectionV1 => modelAdmissionConnectionSchema.parse({
  socketDirectory: join("/private/tmp", "toy-pg-" + uuidSchema.parse(stackId)), database: "toy", peerRole: userInfo().username,
  clientDigest: createHash("sha256").update(readFileSync(clientPath)).digest("hex")
});

export const withAccountingFixture = async <Data>(stackId: string, timeoutMs: number, run: () => Data | Promise<Data>): Promise<Data> => {
  const connection = accountingTestConnection(stackId);
  const worldDirectory = join(trustedCheckoutRoot(), "build/.toy-r0-fixtures", uuidSchema.parse(stackId));
  const owner = userInfo();
  const privateDirectory = (path: string): void => {
    const file = lstatSync(path);
    if (!file.isDirectory() || file.isSymbolicLink() || file.uid !== owner.uid || (file.mode & 0o077) !== 0) throw new AccountingFailure("ACCOUNTING_FIXTURE_OWNER_MISMATCH");
  };
  privateDirectory(worldDirectory);
  if (!existsSync(connection.socketDirectory)) mkdirSync(connection.socketDirectory, { mode: 0o700 });
  privateDirectory(connection.socketDirectory);
  if (existsSync(join(connection.socketDirectory, ".s.PGSQL.5432"))) throw new AccountingFailure("ACCOUNTING_FIXTURE_SOCKET_IN_USE");
  const dataDirectory = join(worldDirectory, "postgres-data");
  const binaries = "/opt/homebrew/opt/postgresql@17/bin";
  const env = { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin:/usr/sbin:/sbin", TMPDIR: worldDirectory };
  const deadline = process.hrtime.bigint() + BigInt(Math.min(timeoutMs, 30000)) * 1000000n;
  if (!existsSync(dataDirectory)) mkdirSync(dataDirectory, { mode: 0o700 });
  privateDirectory(dataDirectory);
  if (!existsSync(join(dataDirectory, "PG_VERSION"))) {
    const initialized = spawnSync(join(binaries, "initdb"), ["--pgdata", dataDirectory, "--locale", "C", "--encoding", "UTF8", "--auth-local", "peer", "--auth-host", "reject", "--username", connection.peerRole, "--no-instructions"], {
      env, encoding: "utf8", timeout: Math.min(timeoutMs, 20000), killSignal: "SIGKILL", maxBuffer: 262144, stdio: ["ignore", "pipe", "pipe"]
    });
    if (initialized.error || initialized.status !== 0) throw new AccountingFailure(/invalid authentication method|unrecognized option/i.test(initialized.stderr) ? "ACCOUNTING_FIXTURE_OPTION_UNSUPPORTED"
      : /Permission denied|Operation not permitted/i.test(initialized.stderr) ? "ACCOUNTING_FIXTURE_INITIALIZATION_DENIED" : "ACCOUNTING_FIXTURE_INITIALIZATION_FAILED");
  }
  privateDirectory(dataDirectory);
  if (readFileSync(join(dataDirectory, "PG_VERSION"), "utf8") !== "17\n") throw new AccountingFailure("ACCOUNTING_FIXTURE_DATABASE_VERSION_MISMATCH");
  if (process.hrtime.bigint() >= deadline) throw new AccountingFailure("ACCOUNTING_FIXTURE_DATABASE_NOT_READY");
  const child = spawn(join(binaries, "postgres"), ["-D", dataDirectory, "-k", connection.socketDirectory, "-p", "5432", "-c", "listen_addresses=", "-c", "max_connections=4", "-c", "shared_buffers=16MB", "-c", "log_statement=none", "-c", "log_min_error_statement=panic"], {
    env, stdio: "ignore", detached: false
  });
  let closed = false;
  let failed = false;
  child.on("close", () => { closed = true; });
  child.on("error", () => { failed = true; });
  try {
    let ready = false;
    while (!closed && !failed && process.hrtime.bigint() < deadline) {
      try { ready = accountingQuery({ ...connection, database: "postgres" }, "SELECT 'true'::jsonb;") === true; } catch { ready = false; }
      if (ready) break;
      await delay(25);
    }
    if (!ready) throw new AccountingFailure("ACCOUNTING_FIXTURE_DATABASE_NOT_READY");
    const databaseExists = accountingQuery({ ...connection, database: "postgres" }, `SELECT to_jsonb(EXISTS (SELECT 1 FROM pg_database WHERE datname=${sqlText(connection.database)}));`);
    if (databaseExists !== true) execute({ ...connection, database: "postgres" }, `CREATE DATABASE "${connection.database}"; SELECT 'true'::jsonb;`, false);
    const schemaExists = accountingQuery(connection, "SELECT to_jsonb(EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='toy_si'));");
    if (schemaExists !== true) {
      const source = readFileSync(join(trustedCheckoutRoot(), "packages/self-improvement/migrations/model-admission.sql"), "utf8");
      if (source !== modelAdmissionMigration) throw new AccountingFailure("ACCOUNTING_FIXTURE_MIGRATION_MISMATCH");
      execute(connection, source + "SELECT 'true'::jsonb;", false);
    }
    return await run();
  } finally {
    if (!closed && !failed) child.kill("SIGINT");
    const stopDeadline = process.hrtime.bigint() + 5000000000n;
    while (!closed && process.hrtime.bigint() < stopDeadline) await delay(25);
    if (!closed) child.kill("SIGKILL");
    const killDeadline = process.hrtime.bigint() + 1000000000n;
    while (!closed && process.hrtime.bigint() < killDeadline) await delay(25);
    if (!closed) throw new AccountingFailure("ACCOUNTING_FIXTURE_TEARDOWN_UNCONFIRMED");
  }
};
