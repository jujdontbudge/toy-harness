import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { codexProtocolInspectionSchema } from "@toy/contracts";
import type { CodexProtocolInspectionV1 } from "@toy/contracts";
import { trustedToolEnvironment } from "./checkout-root.js";

const fields = (value: unknown, title: string): string[] => {
  if (!value || typeof value !== "object") return [];
  if ("title" in value && value.title === title && "properties" in value && value.properties && typeof value.properties === "object") return Object.keys(value.properties).sort();
  if (title in value) {
    const named: unknown = Reflect.get(value, title);
    if (named && typeof named === "object" && "properties" in named && named.properties && typeof named.properties === "object") return Object.keys(named.properties).sort();
  }
  for (const nested of Object.values(value)) {
    const result = fields(nested, title);
    if (result.length > 0) return result;
  }
  return [];
};

export const inspectCodexProtocol = (executable: string, remainingMs: number): CodexProtocolInspectionV1 => {
  const unavailable = codexProtocolInspectionSchema.parse({ state: "unavailable", schemaDigest: null, experimentalIncluded: false, threadFields: [], turnFields: [], dynamicToolFields: [], defaultToolsCanBeDisabled: false, inferenceAttested: false, authorizationInspected: false });
  if (remainingMs <= 0) return unavailable;
  const environment = trustedToolEnvironment();
  let directory: string | null = null;
  try {
    mkdirSync(environment.HOME, { recursive: true, mode: 0o700 });
    directory = mkdtempSync(join(environment.HOME, "codex-protocol-"));
    const started = process.hrtime.bigint();
    const options = { encoding: "utf8", timeout: Math.min(remainingMs, 5000), maxBuffer: 4096, env: { ...environment, CODEX_HOME: join(directory, "empty-home") } } as const;
    const help = spawnSync(executable, ["app-server", "generate-json-schema", "--help"], options);
    const experimentalIncluded = !help.error && help.status === 0 && /(?:^|\s)--experimental(?:\s|$)/.test(help.stdout);
    const availableMs = remainingMs - Number((process.hrtime.bigint() - started) / 1000000n);
    if (availableMs <= 0) return unavailable;
    const generated = spawnSync(executable, ["app-server", "generate-json-schema", ...(experimentalIncluded ? ["--experimental"] : []), "--out", directory], { ...options, timeout: Math.min(availableMs, 5000) });
    if (generated.error || generated.status !== 0) return unavailable;
    const documents: unknown[] = [];
    const hashes: { path: string; digest: string }[] = [];
    let bytes = 0;
    const read = (relative: string, depth: number): void => {
      if (directory === null || depth > 3) return;
      for (const entry of readdirSync(join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const path = join(relative, entry.name);
        if (entry.isDirectory()) read(path, depth + 1);
        else if (entry.isFile() && entry.name.endsWith(".json")) {
          const content = readFileSync(join(directory, path));
          bytes += content.length;
          if (bytes > 16 * 1024 * 1024) throw new Error("PROTOCOL_BUNDLE_LIMIT");
          const document: unknown = JSON.parse(content.toString("utf8"));
          documents.push(document);
          hashes.push({ path, digest: createHash("sha256").update(content).digest("hex") });
        }
      }
    };
    read("", 0);
    const find = (title: string): string[] => documents.flatMap(document => fields(document, title)).filter((name, index, values) => values.indexOf(name) === index).sort();
    const threadFields = find("ThreadStartParams");
    const turnFields = find("TurnStartParams");
    const dynamicToolFields = find("DynamicToolSpec");
    if (threadFields.length === 0 || turnFields.length === 0) return unavailable;
    return codexProtocolInspectionSchema.parse({ state: "observed", schemaDigest: createHash("sha256").update(JSON.stringify(hashes)).digest("hex"), experimentalIncluded, threadFields, turnFields, dynamicToolFields, defaultToolsCanBeDisabled: threadFields.includes("disableDefaultTools"), inferenceAttested: false, authorizationInspected: false });
  } catch { return unavailable; }
  finally { if (directory !== null) rmSync(directory, { recursive: true, force: true }); }
};
