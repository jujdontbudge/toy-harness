import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { nativeBuildManifestSchema, schemaBundleDigest, type NativeBuildManifestV1 } from "@toy/contracts";

type BuildInputSnapshot = {
  compilerPath: string;
  compilerDigest: string;
  sdkSettingsDigest: string;
  contractsSourceDigest: string;
  entryDigest: string;
  builderDigest: string;
  inputDigests: Record<string, string>;
  schemaBundleDigest: string;
};

type ValidGeneration = {
  manifest: NativeBuildManifestV1;
  manifestBytes: Buffer;
  parentPath: string;
  childPath: string;
};

const root = resolve(import.meta.dirname, "..");
const compiler = "/Library/Developer/CommandLineTools/usr/bin/swiftc";
const sdk = "/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk";
const outputRoot = resolve(root, "packages/ops/dist/native");
const contractSources = [
  "packages/contracts/src/primitives.ts",
  "packages/contracts/src/test-control.ts",
  "swift/ToyContracts/Contracts.swift"
];
const contractBuildInputs = [
  ...contractSources,
  "packages/contracts/src/generated-bundle.ts",
  "packages/contracts/generated/schemas/native-build-manifest-v1.schema.json",
  "packages/contracts/dist/public.js",
  "packages/contracts/dist/test-control.js",
  "packages/contracts/dist/generated-bundle.js"
];

const digest = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

const digestFiles = async (files: readonly string[]): Promise<string> => {
  const hash = createHash("sha256");
  for (const file of files) {
    const path = resolve(root, file);
    hash.update(relative(root, path));
    hash.update(Buffer.from([0]));
    hash.update(await readFile(path));
    hash.update(Buffer.from([0]));
  }
  return hash.digest("hex");
};

const statWithoutSymlink = async (path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> => {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error("symlink");
    return info;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
};

const assertOwned = (info: Awaited<ReturnType<typeof lstat>>): void => {
  const effectiveUid = process.geteuid?.();
  if (effectiveUid === undefined || info.uid !== effectiveUid) throw new Error("owner");
};

const ensureOwnedDirectory = async (path: string): Promise<void> => {
  const prior = await statWithoutSymlink(path);
  if (prior) {
    if (!prior.isDirectory()) throw new Error("directory");
    assertOwned(prior);
  }
  await mkdir(path, { recursive: true });
  const current = await statWithoutSymlink(path);
  if (!current || !current.isDirectory()) throw new Error("directory");
  assertOwned(current);
};

const digestSnapshot = async (): Promise<BuildInputSnapshot> => {
  const compilerPath = await realpath(compiler);
  if (!/^[a-f0-9]{64}$/.test(schemaBundleDigest)) throw new Error("contracts");
  const inputDigests: Record<string, string> = {};
  for (const file of contractBuildInputs) inputDigests[file] = digest(await readFile(resolve(root, file)));
  return {
    compilerPath,
    compilerDigest: digest(await readFile(compilerPath)),
    sdkSettingsDigest: digest(await readFile(resolve(sdk, "SDKSettings.json"))),
    contractsSourceDigest: await digestFiles(contractSources),
    entryDigest: digest(await readFile(resolve(root, "packages/ops/native/BootstrapEntry.swift"))),
    builderDigest: digest(await readFile(resolve(root, "scripts/build-native-bootstrap.mts"))),
    inputDigests,
    schemaBundleDigest
  };
};

const validatedManifest = (bytes: Buffer): NativeBuildManifestV1 => {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("manifest");
  }
  const validation = nativeBuildManifestSchema.safeParse(value);
  if (!validation.success) throw new Error("manifest");
  return validation.data;
};

const requireExactDirectory = async (path: string, entries: readonly string[]): Promise<void> => {
  const info = await statWithoutSymlink(path);
  if (!info || !info.isDirectory()) throw new Error("inventory");
  assertOwned(info);
  const actual = (await readdir(path)).sort();
  const expected = [...entries].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("inventory");
};

const requireRegularFile = async (path: string): Promise<void> => {
  const info = await statWithoutSymlink(path);
  if (!info || !info.isFile()) throw new Error("inventory");
  assertOwned(info);
};

const verifyGeneration = async (generationRoot: string, rootEntries: readonly string[] = ["Contents", "manifest.json"]): Promise<ValidGeneration> => {
  await requireExactDirectory(generationRoot, rootEntries);
  const manifestPath = resolve(generationRoot, "manifest.json");
  await requireRegularFile(manifestPath);
  const manifestBytes = await readFile(manifestPath);
  const manifest = validatedManifest(manifestBytes);
  const contentsPath = resolve(generationRoot, "Contents");
  await requireExactDirectory(contentsPath, ["Helpers", "MacOS"]);
  const helperDirectory = resolve(contentsPath, "Helpers");
  const parentDirectory = resolve(contentsPath, "MacOS");
  await requireExactDirectory(helperDirectory, ["bootstrap-child"]);
  await requireExactDirectory(parentDirectory, ["bootstrap-parent"]);
  const parentPath = resolve(parentDirectory, "bootstrap-parent");
  const childPath = resolve(helperDirectory, "bootstrap-child");
  await requireRegularFile(parentPath);
  await requireRegularFile(childPath);
  const parentDigest = digest(await readFile(parentPath));
  const childDigest = digest(await readFile(childPath));
  if (manifest.artifacts.parent !== parentDigest || manifest.artifacts.child !== childDigest) throw new Error("inventory");
  return { manifest, manifestBytes, parentPath, childPath };
};

const inspectCurrentOutput = async (): Promise<ValidGeneration | null> => {
  const rootInfo = await statWithoutSymlink(outputRoot);
  if (!rootInfo || !rootInfo.isDirectory()) throw new Error("output");
  assertOwned(rootInfo);
  const entries = (await readdir(outputRoot)).sort();
  const hasManifest = entries.includes("manifest.json");
  if (!hasManifest) {
    if (entries.length !== 0) throw new Error("output");
    return null;
  }
  const expectedEntries: readonly string[] = entries.includes(".history")
    ? [".history", "Contents", "manifest.json"]
    : ["Contents", "manifest.json"];
  if (JSON.stringify(entries) !== JSON.stringify(expectedEntries) || !entries.includes("Contents")) throw new Error("output");
  const manifestPath = resolve(outputRoot, "manifest.json");
  const manifestInfo = await statWithoutSymlink(manifestPath);
  if (!manifestInfo || !manifestInfo.isFile()) throw new Error("output");
  assertOwned(manifestInfo);
  if (entries.includes(".history")) {
    const historyInfo = await statWithoutSymlink(resolve(outputRoot, ".history"));
    if (!historyInfo || !historyInfo.isDirectory()) throw new Error("output");
    assertOwned(historyInfo);
  }
  return verifyGeneration(outputRoot, expectedEntries);
};

const preserveGeneration = async (current: ValidGeneration | null): Promise<void> => {
  if (!current) return;
  await ensureOwnedDirectory(resolve(outputRoot, ".history"));
  const archiveName = digest(current.manifestBytes);
  const archivePath = resolve(outputRoot, ".history", archiveName);
  const archiveInfo = await statWithoutSymlink(archivePath);
  if (archiveInfo) {
    if (!archiveInfo.isDirectory()) throw new Error("history");
    assertOwned(archiveInfo);
    const archived = await verifyGeneration(archivePath);
    if (!archived.manifestBytes.equals(current.manifestBytes)) throw new Error("history");
    return;
  }
  await mkdir(archivePath, { recursive: false });
  await mkdir(resolve(archivePath, "Contents/MacOS"), { recursive: true });
  await mkdir(resolve(archivePath, "Contents/Helpers"), { recursive: true });
  await copyFile(current.parentPath, resolve(archivePath, "Contents/MacOS/bootstrap-parent"));
  await copyFile(current.childPath, resolve(archivePath, "Contents/Helpers/bootstrap-child"));
  await writeFile(resolve(archivePath, "manifest.json"), current.manifestBytes, { flag: "wx", mode: 0o600 });
  const archived = await verifyGeneration(archivePath);
  if (!archived.manifestBytes.equals(current.manifestBytes)) throw new Error("history");
};

const build = async (): Promise<void> => {
  if (process.argv.length !== 2) throw new Error("arguments");
  await ensureOwnedDirectory(resolve(root, "build/tmp"));
  await ensureOwnedDirectory(dirname(outputRoot));
  await ensureOwnedDirectory(outputRoot);

  const sdkInfo = await lstat(sdk);
  if (!sdkInfo.isDirectory() || sdkInfo.isSymbolicLink()) throw new Error("sdk");
  const tempRoot = await mkdtemp(resolve(root, "build/tmp/native-bootstrap-"));
  const cleanEnvironment = {
    PATH: "/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
    TMPDIR: tempRoot
  };
  try {
    const before = await digestSnapshot();
    const version = spawnSync(compiler, ["--version"], {
      cwd: root,
      env: cleanEnvironment,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 10000
    });
    if (version.error || version.status !== 0 || !/(?:Apple )?Swift version 6\.3\.3(?:\s|$)/m.test(version.stdout)) throw new Error("compiler");

    const stagedParentDirectory = resolve(tempRoot, "Contents/MacOS");
    const stagedChildDirectory = resolve(tempRoot, "Contents/Helpers");
    const stagedParent = resolve(stagedParentDirectory, "bootstrap-parent");
    const stagedChild = resolve(stagedChildDirectory, "bootstrap-child");
    const moduleCache = resolve(tempRoot, "module-cache");
    await mkdir(stagedParentDirectory, { recursive: true });
    await mkdir(stagedChildDirectory, { recursive: true });
    await mkdir(moduleCache, { recursive: true });

    const commonArguments: string[] = [
      "-swift-version", "6",
      "-strict-concurrency=complete",
      "-warnings-as-errors",
      "-sdk", sdk,
      "-module-cache-path", moduleCache,
      resolve(root, "swift/ToyContracts/Contracts.swift"),
      resolve(root, "packages/ops/native/BootstrapEntry.swift")
    ];
    const compile = (arguments_: readonly string[]): void => {
      const result = spawnSync(compiler, arguments_, {
        cwd: root,
        env: cleanEnvironment,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        timeout: 120000
      });
      if (result.error || result.status !== 0) throw new Error("compile");
    };
    compile([...commonArguments, "-o", stagedParent]);
    compile(["-D", "BOOTSTRAP_CHILD", ...commonArguments, "-o", stagedChild]);

    const parentBytes = await readFile(stagedParent);
    const childBytes = await readFile(stagedChild);
    const after = await digestSnapshot();
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("input-drift");
    const manifest: NativeBuildManifestV1 = {
      schemaVersion: "toy.bootstrap-native-build.v1",
      generatedAt: new Date().toISOString(),
      schemaDigest: before.schemaBundleDigest,
      compilerVersion: "6.3.3",
      compilerDigest: before.compilerDigest,
      sdk: "MacOSX26.5.sdk",
      sdkSettingsDigest: before.sdkSettingsDigest,
      sourceDigests: {
        contracts: before.contractsSourceDigest,
        entry: before.entryDigest,
        builder: before.builderDigest
      },
      artifacts: {
        parent: digest(parentBytes),
        child: digest(childBytes)
      }
    };
    const validation = nativeBuildManifestSchema.safeParse(manifest);
    if (!validation.success) throw new Error("manifest");
    const manifestBytes = Buffer.from(JSON.stringify(validation.data, null, 2) + "\n", "utf8");
    const stagedManifest = resolve(tempRoot, "manifest.json");
    await writeFile(stagedManifest, manifestBytes, { flag: "wx", mode: 0o600 });

    const current = await inspectCurrentOutput();
    await preserveGeneration(current);
    const contents = resolve(outputRoot, "Contents");
    const manifestPath = resolve(outputRoot, "manifest.json");
    if (current === null) {
      const entries = await readdir(outputRoot);
      if (entries.length !== 0) throw new Error("output");
    }
    await rm(manifestPath, { force: true });
    await rm(contents, { recursive: true, force: true });
    await rename(resolve(tempRoot, "Contents"), contents);
    await rename(stagedManifest, manifestPath);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

try {
  await build();
} catch {
  process.stderr.write("NATIVE_BUILD_FAILED\n");
  process.exitCode = 1;
}
