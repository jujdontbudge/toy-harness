import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { modelAdmissionConnectionSchema } from "@toy/contracts";
import type { ModelAdmissionConnectionV1 } from "@toy/contracts";

const clientPath = "/opt/homebrew/opt/postgresql@17/bin/psql";
export const sqlText = (value: string): string => "'" + value.replaceAll("'", "''") + "'";
export const sqlJson = (value: unknown): string => sqlText(JSON.stringify(value)) + "::jsonb";

export const accountingQuery = (raw: ModelAdmissionConnectionV1, statement: string, mutation = false): unknown => {
  const connection = modelAdmissionConnectionSchema.parse(raw);
  if (createHash("sha256").update(readFileSync(clientPath)).digest("hex") !== connection.clientDigest) throw new Error("ACCOUNTING_CLIENT_CHANGED");
  const script = "SET LOCAL standard_conforming_strings=on; SET LOCAL statement_timeout='4s'; SET TRANSACTION ISOLATION LEVEL READ COMMITTED;\n"
    + (mutation ? "SELECT pg_advisory_xact_lock(18374691);\n" : "") + statement + "\n";
  const child = spawnSync(clientPath, ["-X", "-q", "-A", "-t", "-w", "--single-transaction", "--file", "-", "--set", "ON_ERROR_STOP=1",
    "--host", connection.socketDirectory, "--port", "5432", "--dbname", connection.database, "--username", connection.peerRole], {
    input: script, encoding: "utf8", timeout: 5000, killSignal: "SIGKILL", maxBuffer: 1048576,
    env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin:/usr/sbin:/sbin", PGCONNECT_TIMEOUT: "3", PGCLIENTENCODING: "UTF8", PGPASSFILE: "/dev/null", PGSERVICEFILE: "/dev/null" },
    stdio: ["pipe", "pipe", "pipe"]
  });
  if (child.error || child.status !== 0) throw new Error("ACCOUNTING_DATABASE_UNAVAILABLE");
  const lines = child.stdout.trim().split("\n").filter(line => line.trim() !== "");
  if (lines.length !== 1 || lines[0] === undefined) throw new Error("ACCOUNTING_RESPONSE_INVALID");
  const result: unknown = JSON.parse(lines[0]);
  return result;
};
