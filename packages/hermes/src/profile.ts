import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { hermesGatewayConsumerInventorySchema, hermesGatewayNativeObservationSchema, hermesGatewayProfileReceiptSchema, hermesGatewayProfileSchema, installedHermesDependencyRecordSchema, opsErrorMessages } from "@toy/contracts";
import type { HermesGatewayProfileReceiptV1, HermesGatewayProfileV1, OpsControlContextV1, OpsErrorCode, Result } from "@toy/contracts";
import { OpsTestStack, trustedCheckoutRoot, trustedToolEnvironment } from "@toy/ops/public";

const installedRoot = "/Users/johansardar/.hermes/hermes-agent";
const sourceCommit = "8d5e3e412138342e8bf30443e72bd4e6a9abd057";
const digest = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const keys = ["gateway.multiplex_profiles", "gateway.loop_watchdog", "gateway.loop_watchdog_probe_interval_s", "gateway.loop_watchdog_probe_timeout_s", "gateway.loop_watchdog_max_strikes", "platforms.discord.enabled", "streaming.enabled"];
const consumers = ["GatewayConfig", "GatewayConfig", "GatewayConfig", "GatewayConfig", "GatewayConfig", "PlatformConfig", "StreamingConfig"];
const fail = (code: OpsErrorCode): Result<HermesGatewayProfileReceiptV1> => ({ ok: false, error: { module: "ops", code, message: opsErrorMessages[code], retryable: code === "DEPENDENCY_UNAVAILABLE" } });
const nativeConsumer = `import contextlib, io, json, os, sys
network_attempts = 0
blocked_socket_binds = 0
def audit(event, args):
    global network_attempts, blocked_socket_binds
    if event == "socket.bind":
        blocked_socket_binds += 1
        raise PermissionError("NATIVE_PROFILE_BIND_DENIED")
    if event in {"socket.connect", "socket.getaddrinfo"}:
        network_attempts += 1
        raise PermissionError("NATIVE_PROFILE_NETWORK_DENIED")
sys.addaudithook(audit)
sys.path.insert(0, sys.argv[1])
with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
    from gateway.config import Platform, load_gateway_config
    config = load_gateway_config()
effective = {
    "gateway": {
        "multiplex_profiles": config.multiplex_profiles,
        "loop_watchdog": config.loop_watchdog,
        "loop_watchdog_probe_interval_s": config.loop_watchdog_probe_interval_s,
        "loop_watchdog_probe_timeout_s": config.loop_watchdog_probe_timeout_s,
        "loop_watchdog_max_strikes": config.loop_watchdog_max_strikes
    },
    "platforms": {"discord": {"enabled": config.platforms[Platform.DISCORD].enabled}},
    "streaming": {"enabled": config.streaming.enabled}
}
print(json.dumps({"effective": effective, "pid": os.getpid(), "parentPid": os.getppid(), "uid": os.getuid(), "gid": os.getgid(), "networkAttempts": network_attempts, "blockedSocketBinds": blocked_socket_binds}))
`;

export const HermesProfile = {
  generateGateway(): HermesGatewayProfileV1 {
    return hermesGatewayProfileSchema.parse({
      gateway: { multiplex_profiles: true, loop_watchdog: true, loop_watchdog_probe_interval_s: 30, loop_watchdog_probe_timeout_s: 10, loop_watchdog_max_strikes: 3 },
      platforms: { discord: { enabled: false } }, streaming: { enabled: false }
    });
  },
  consumeGateway(input: unknown, context: OpsControlContextV1): Promise<Result<HermesGatewayProfileReceiptV1>> {
    const profile = hermesGatewayProfileSchema.safeParse(input);
    if (!profile.success) return Promise.resolve(fail("INVALID_INPUT"));
    const owned = OpsTestStack.inspect(context);
    if (!owned.ok) return Promise.resolve(owned);
    const snapshot = owned.data.result;
    if (!snapshot?.ready || snapshot.release !== "R0" || snapshot.clock !== "fake" || snapshot.model !== "fake") return Promise.resolve(fail("INVALID_INPUT"));
    try {
      const checkout = trustedCheckoutRoot();
      const inventoryBytes = readFileSync(join(checkout, "behavior/hermes-gateway-consumers.json"));
      const inventory = hermesGatewayConsumerInventorySchema.parse(JSON.parse(inventoryBytes.toString("utf8")));
      if (JSON.stringify(inventory.keys.map(entry => entry.path)) !== JSON.stringify(keys) || JSON.stringify(inventory.keys.map(entry => entry.consumer)) !== JSON.stringify(consumers) || JSON.stringify(inventory.sources.map(entry => entry.path)) !== JSON.stringify(["gateway/config.py", "gateway/config_loader.py", "hermes_cli/config.py"])) return Promise.resolve(fail("ATTESTATION_INVALID"));
      const environment = trustedToolEnvironment();
      const started = process.hrtime.bigint();
      const remainingMs = (): number => context.timeoutMs - Number((process.hrtime.bigint() - started) / 1000000n);
      const pinned = spawnSync("/usr/bin/git", ["-C", installedRoot, "rev-parse", "HEAD"], { encoding: "utf8", env: environment, timeout: Math.min(context.timeoutMs, 3000), maxBuffer: 4096 });
      if (pinned.error || pinned.status !== 0 || pinned.stdout.trim() !== sourceCommit) return Promise.resolve(fail("ATTESTATION_INVALID"));
      for (const source of inventory.sources) {
        const committed = spawnSync("/usr/bin/git", ["-C", installedRoot, "show", `${sourceCommit}:${source.path}`], { env: environment, timeout: Math.max(1, Math.min(remainingMs(), 3000)), maxBuffer: 1048576 });
        if (committed.error || committed.status !== 0 || digest(committed.stdout) !== source.digest || digest(readFileSync(join(installedRoot, source.path))) !== source.digest) return Promise.resolve(fail("ATTESTATION_INVALID"));
      }
      const installState = join("/Users/johansardar/.hermes/installs", digest(realpathSync(installedRoot)).slice(0, 16));
      const record = installedHermesDependencyRecordSchema.parse(JSON.parse(readFileSync(join(installState, "facts.json"), "utf8")));
      const generation = realpathSync(record.packages.venv.environment);
      const generationRoot = realpathSync(join(installState, "environments"));
      const generationRelative = relative(generationRoot, generation);
      if (!generationRelative || generationRelative.startsWith("..") || isAbsolute(generationRelative) || !statSync(join(generation, "pyvenv.cfg")).isFile()) return Promise.resolve(fail("ATTESTATION_INVALID"));
      const home = mkdtempSync(join(checkout, "build/.toy-r0-fixtures", snapshot.stackId, "native-profile-"));
      const profileBytes = JSON.stringify(profile.data) + "\n";
      writeFileSync(join(home, "config.yaml"), profileBytes, { mode: 0o600, flag: "wx" });
      if (remainingMs() <= 0) return Promise.resolve(fail("DEPENDENCY_UNAVAILABLE"));
      const child = spawnSync(join(generation, "bin/python3"), ["-I", "-B", "-c", nativeConsumer, installedRoot], {
        cwd: home, encoding: "utf8", timeout: remainingMs(), maxBuffer: 65536,
        env: { ...environment, HOME: home, HERMES_HOME: home, TMPDIR: home, PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1" }
      });
      if (child.error || child.status !== 0) return Promise.resolve(fail("DEPENDENCY_UNAVAILABLE"));
      const observed = hermesGatewayNativeObservationSchema.parse(JSON.parse(child.stdout));
      if (observed.parentPid !== process.pid || observed.pid === process.pid || observed.uid !== process.getuid?.() || observed.gid !== process.getgid?.() || observed.networkAttempts !== 0 || JSON.stringify(observed.effective) !== JSON.stringify(profile.data)) return Promise.resolve(fail("ATTESTATION_INVALID"));
      return Promise.resolve({ ok: true, data: hermesGatewayProfileReceiptSchema.parse({
        scope: "gateway-fragment", profile: profile.data, profileDigest: digest(profileBytes), consumerInventoryDigest: digest(inventoryBytes), sourceCommit,
        native: observed, nativeExitCode: 0, nativeConsumerMatched: true, profilePublicationPerformed: false, liveProviderSends: 0, acceptanceComplete: false
      }) });
    } catch { return Promise.resolve(fail("ATTESTATION_INVALID")); }
  }
};
