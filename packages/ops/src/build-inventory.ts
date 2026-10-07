import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import canonicalize from "canonicalize";
import { checkViewSchema, filePatchSchema, opsControlContextSchema, opsErrorMessages, serviceIdSchema } from "@toy/contracts";
import type { CheckViewV1, FilePatchV1, OpsControlContextV1, Result } from "@toy/contracts";
import { trustedCheckoutRoot } from "./checkout-root.js";
import { fixtureStackInspect } from "./fixture-stack.js";

const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const record = (value: unknown): Record<string, unknown> | null => isRecord(value) ? value : null;
const refused = (code: "INVALID_INPUT" | "ARTIFACT_MISMATCH"): Result<CheckViewV1[]> => ({ ok: false, error: { module: "ops", code, message: opsErrorMessages[code], retryable: false } });

export const inspectBuildInventory = (context: OpsControlContextV1, testSources: readonly FilePatchV1[]): Result<CheckViewV1[]> => {
  if (!opsControlContextSchema.safeParse(context).success || testSources.length > 16 || testSources.some(source => !filePatchSchema.safeParse(source).success)) return refused("INVALID_INPUT");
  if (testSources.length > 0) {
    const owned = fixtureStackInspect(context);
    if (!owned.ok) return owned;
    if (!owned.data.result?.ready || owned.data.result.release !== "R0" || owned.data.result.clock !== "fake" || owned.data.result.model !== "fake") return refused("INVALID_INPUT");
  }
  try {
    const root = realpathSync(trustedCheckoutRoot());
    const inputs = new Map<string, string>();
    const actual = (path: string): string => {
      const full = resolve(root, path);
      if (relative(root, full).startsWith("..") || realpathSync(full) !== full || !lstatSync(full).isFile()) throw new Error("UNSAFE_INVENTORY_SOURCE");
      return readFileSync(full, "utf8");
    };
    const graph: unknown = JSON.parse(actual("architecture/modules.json"));
    const graphRecord = record(graph);
    const modules = Array.isArray(graphRecord?.modules) ? graphRecord.modules.map(record) : [];
    if (modules.length === 0 || modules.some(module => typeof module?.id !== "string" || !/^[a-z-]+$/.test(module.id))) throw new Error("INVALID_OWNER_GRAPH");
    const workspaces = ["", ...modules.flatMap(module => typeof module?.id === "string" ? ["packages/" + module.id] : []), "cli"];
    const manifests = workspaces.map(path => path === "" ? "package.json" : path + "/package.json");
    const allowed = new Set(["package-lock.json", ...manifests]);
    const overlays = new Map<string, FilePatchV1>();
    for (const source of testSources) {
      if (!allowed.has(source.path) || overlays.has(source.path) || source.kind !== "update") return refused("INVALID_INPUT");
      if (source.beforeDigest !== digest(actual(source.path)) || source.afterDigest !== digest(source.patch)) return refused("ARTIFACT_MISMATCH");
      overlays.set(source.path, source);
    }
    const read = (path: string): string => {
      const content = overlays.get(path)?.patch ?? actual(path);
      inputs.set(path, digest(content));
      return content;
    };
    const json = (path: string): Record<string, unknown> => {
      const value: unknown = JSON.parse(read(path));
      const output = record(value);
      if (!output) throw new Error("INVALID_INVENTORY_RECORD");
      return output;
    };
    read("architecture/modules.json");
    const planning = join(dirname(root), "personal-assistant-harness/specs");
    const contracts = readFileSync(join(planning, "CONTRACTS.md"), "utf8");
    const authority = readFileSync(join(planning, "authority.md"), "utf8");
    inputs.set("planning:specs/CONTRACTS.md", digest(contracts));
    inputs.set("planning:specs/authority.md", digest(authority));
    const canonical = new Map(contracts.split(/\r?\n/).flatMap(line => {
      const cells = line.split("|").map(cell => cell.trim());
      const component = cells[1];
      const pin = cells[2]?.match(/`([^`]+)`/)?.[1];
      return component && pin ? [[component, pin] as const] : [];
    }));
    const shared = new Map([["pg", "`pg`"], ["pg-boss", "pg-boss"], ["next", "Next.js"], ["react", "React/React DOM"], ["react-dom", "React/React DOM"], ["expo", "Expo"], ["react-native", "React Native"], ["expo-notifications", "expo-notifications"], ["better-auth", "Better Auth and matching plugins"]]);
    const canonicalizerPin = /^\| `canonicalize` \| `([^`]+)`/m.exec(authority)?.[1];
    const rootManifest = json("package.json");
    const lock = json("package-lock.json");
    const locked = record(lock.packages);
    if (!locked || lock.lockfileVersion !== 3) throw new Error("INVALID_APPLICATION_LOCK");
    const nearest = (path: string, name: string): Record<string, unknown> | null => {
      const ancestry = path === "" ? [""] : path.split("/").map((_, index, parts) => parts.slice(0, parts.length - index).join("/")).concat("");
      return ancestry.map(parent => record(locked[(parent === "" ? "" : parent + "/") + "node_modules/" + name])).find(entry => entry !== null) ?? null;
    };
    const failures: string[] = [];
    const nodePin = canonical.get("Node");
    if (!nodePin || record(rootManifest.engines)?.node !== nodePin || record(record(locked[""])?.engines)?.node !== nodePin) failures.push("NODE_PIN_MISMATCH");
    let dependencyRows = 0;
    for (const path of workspaces) {
      const manifest = path === "" ? rootManifest : json(path + "/package.json");
      const lockedManifest = record(locked[path]);
      if (!lockedManifest) { failures.push("WORKSPACE_LOCK_MISSING:" + path); continue; }
      for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
        const dependencies = record(manifest[section]) ?? {};
        const declarations = record(lockedManifest[section]) ?? {};
        if (JSON.stringify(Object.entries(dependencies).sort()) !== JSON.stringify(Object.entries(declarations).sort())) failures.push("DECLARATION_LOCK_MISMATCH:" + path + ":" + section);
        for (const [name, version] of Object.entries(dependencies)) {
          dependencyRows += 1;
          const resolved = nearest(path, name);
          const pinKey = shared.get(name);
          if (typeof version !== "string" || pinKey && version !== canonical.get(pinKey)) failures.push("CANONICAL_PIN_MISMATCH:" + name);
          if (name.startsWith("@toy/")) {
            if (resolved?.link !== true || typeof resolved.resolved !== "string" || record(locked[resolved.resolved])?.version !== version) failures.push("OWNER_LOCK_MISMATCH:" + name);
          } else {
            if (resolved?.version !== version) failures.push("DEPENDENCY_LOCK_MISMATCH:" + name);
            if (typeof resolved?.integrity !== "string" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(resolved.integrity)) failures.push("DEPENDENCY_INTEGRITY_MISSING:" + name);
            if (typeof resolved?.resolved !== "string" || !resolved.resolved.startsWith("https://registry.npmjs.org/")) failures.push("DEPENDENCY_SOURCE_REFUSED:" + name);
          }
        }
      }
      if (path.startsWith("packages/") || path === "cli") {
        const entry = record(record(manifest.exports)?.["./public"]);
        if (path !== "cli" && path !== "packages/contracts" && (entry?.import !== "./dist/public.js" || entry.types !== "./dist/public.d.ts")) failures.push("WORKSPACE_PUBLIC_ENTRY_REFUSED:" + path);
      }
      const scripts = record(manifest.scripts) ?? {};
      for (const name of ["prestart", "start", "poststart", "preinstall", "install", "postinstall"]) {
        const source = scripts[name];
        if (source !== undefined && (typeof source !== "string" || /\b(?:npm\s+(?:install|i|ci)|npx|pnpm\s+(?:add|install|dlx)|yarn\s+(?:add|install)|curl|wget)\b/.test(source))) failures.push("STARTUP_DOWNLOAD_REFUSED:" + path + ":" + name);
      }
      if (path !== "") for (const entry of readdirSync(join(root, path))) if (/^(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/.test(entry)) failures.push("WORKSPACE_LOCK_REFUSED:" + path + "/" + entry);
    }
    const opsManifest = json("packages/ops/package.json");
    const canonicalizer = nearest("packages/ops", "canonicalize");
    const canonicalizerFailures: string[] = [];
    if (!canonicalizerPin || record(opsManifest.dependencies)?.canonicalize !== canonicalizerPin || canonicalizer?.version !== canonicalizerPin) canonicalizerFailures.push("MAINTAINED_CANONICALIZER_PIN_MISMATCH");
    const metadata = json("node_modules/canonicalize/package.json");
    if (metadata.name !== "canonicalize" || metadata.version !== canonicalizerPin || record(record(metadata.exports)?.["."])?.import !== "./lib/canonicalize.js") canonicalizerFailures.push("MAINTAINED_CANONICALIZER_ARTIFACT_MISMATCH");
    inputs.set("node_modules/canonicalize/lib/canonicalize.js", digest(readFileSync(join(root, "node_modules/canonicalize/lib/canonicalize.js"))));
    const vectors = json("behavior/rfc8785-vectors.json");
    if (vectors.source !== "https://www.rfc-editor.org/rfc/rfc8785.html" || typeof vectors.sampleInput !== "string" || typeof vectors.sampleCanonicalHex !== "string" || typeof vectors.sortInput !== "string" || typeof vectors.sortCanonicalHex !== "string" || !Array.isArray(vectors.numbers)) throw new Error("RFC_VECTOR_ARTIFACT_INVALID");
    const sample: unknown = JSON.parse(vectors.sampleInput);
    const sorted: unknown = JSON.parse(vectors.sortInput);
    const canonicalSample = canonicalize(sample);
    const canonicalSorted = canonicalize(sorted);
    if (canonicalSample === undefined || Buffer.from(canonicalSample, "utf8").toString("hex") !== vectors.sampleCanonicalHex) canonicalizerFailures.push("RFC_UTF8_VECTOR_MISMATCH");
    if (canonicalSorted === undefined || Buffer.from(canonicalSorted, "utf8").toString("hex") !== vectors.sortCanonicalHex) canonicalizerFailures.push("RFC_UTF16_SORT_MISMATCH");
    let numberVectors = 0;
    for (const raw of vectors.numbers) {
      const vector = record(raw);
      if (!vector || typeof vector.ieee754 !== "string" || !/^[0-9a-f]{16}$/.test(vector.ieee754) || vector.expected !== null && typeof vector.expected !== "string") throw new Error("RFC_NUMBER_VECTOR_INVALID");
      const number = Buffer.from(vector.ieee754, "hex").readDoubleBE();
      let result: string | undefined;
      let rejected = false;
      try { result = canonicalize(number); } catch { rejected = true; }
      if (vector.expected === null ? !rejected : rejected || result !== vector.expected) canonicalizerFailures.push("RFC_NUMBER_MISMATCH:" + vector.ieee754);
      numberVectors += 1;
    }
    const missing: string[] = [];
    for (const [name, pin] of [["better-auth", "1.7.7"], ["@better-auth/passkey", "1.7.7"], ["@simplewebauthn/server", "14.0.3"], ["@simplewebauthn/browser", "14.0.3"]]) if (name !== undefined && nearest("packages/authority", name)?.version !== pin) missing.push("AUTH_ARTIFACT_MISSING:" + name);
    for (const path of ["plugins/toy/plugin.yaml", "plugins/toy/authority_tools.py", "plugins/toy/authority_schemas.py", "behavior/skills/toy-interact/SKILL.md"]) {
      if (!existsSync(join(root, path))) missing.push("CANONICAL_PLUGIN_ARTIFACT_MISSING:" + path);
      else read(path);
    }
    missing.push("OFFICIAL_TYPED_ADAPTER_INVENTORY_UNVERIFIED", "PROTECTED_INSTALLED_RELEASE_TRANSPORT_UNVERIFIED");
    const sourceDigests = [...inputs].map(([path, sha256]) => ({ path, sha256 }));
    const inventoryDigest = digest(JSON.stringify(sourceDigests));
    const phases = [
      { phase: "application-lock", state: failures.length === 0 ? "PASS" : "FAIL", failures },
      { phase: "canonicalization", state: canonicalizerFailures.length === 0 ? "PASS" : "FAIL", failures: canonicalizerFailures },
      { phase: "required-runtime-artifacts", state: "BLOCKED", failures: missing }
    ];
    return { ok: true, data: phases.map(phase => checkViewSchema.parse({ id: "build.source-inventory", owner: "ops", state: phase.state, checkedAt: new Date().toISOString(), reasonCode: phase.state === "PASS" ? "SOURCE_BUILD_INVENTORY_PASS" : phase.state === "FAIL" ? "SOURCE_BUILD_INVENTORY_FAIL" : "REQUIRED_RUNTIME_ARTIFACTS_PENDING", prerequisite: JSON.stringify({ phase: phase.phase, failures: phase.failures.slice(0, 12), sourceInventoryDigest: inventoryDigest, sourceCount: sourceDigests.length, dependencyRows, declaredServiceCount: serviceIdSchema.options.length, canonicalizerPin, numberVectors, sourceOverlays: testSources.length, filesWritten: false, installedServicesVerified: false, nativeAdmissionVerified: false, wholeATComplete: false }), nextCommandId: "probe.run", links: { recordRefs: [], observations: [], artifactDigests: [...new Set(inputs.values())] } })) };
  } catch { return refused("ARTIFACT_MISMATCH"); }
};
