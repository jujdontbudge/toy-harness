import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { hermesGatewayConsumerInventorySchema, hermesGatewayNativeObservationSchema, hermesGatewayProfileReceiptSchema, hermesGatewayProfileSchema, hermesMcpHttpNativeObservationSchema, hermesMcpHttpReceiptSchema, installedHermesDependencyRecordSchema, opsErrorMessages } from "@toy/contracts";
import type { HermesGatewayProfileReceiptV1, HermesGatewayProfileV1, HermesMcpHttpReceiptV1, OpsControlContextV1, OpsErrorCode, Result } from "@toy/contracts";
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
const nativeMcpHttp = `import contextlib, importlib.metadata, json, os, socket, sys, threading, time
sdk_version = importlib.metadata.version("mcp")
if sdk_version != "2.0.0":
    raise RuntimeError("SDK_PIN_MISMATCH")
with socket.socket() as reservation:
    reservation.bind(("127.0.0.1", 0))
    port = reservation.getsockname()[1]
counts = {"loopbackConnections": 0, "deniedNetworkAttempts": 0, "blockedSocketBinds": 0, "deniedSubprocessAttempts": 0}
def audit(event, args):
    if event == "socket.bind":
        if args[1] != ("127.0.0.1", port):
            counts["blockedSocketBinds"] += 1
            raise PermissionError("MCP_BIND_DENIED")
    elif event == "socket.connect":
        if args[1] == ("127.0.0.1", port):
            counts["loopbackConnections"] += 1
        else:
            counts["deniedNetworkAttempts"] += 1
            raise PermissionError("MCP_CONNECT_DENIED")
    elif event == "socket.getaddrinfo":
        if args[0] != "127.0.0.1" or args[1] != port:
            counts["deniedNetworkAttempts"] += 1
            raise PermissionError("MCP_DNS_DENIED")
    elif event in {"subprocess.Popen", "os.system", "os.posix_spawn", "os.posix_spawnp"}:
        counts["deniedSubprocessAttempts"] += 1
        raise PermissionError("MCP_SUBPROCESS_DENIED")
sys.addaudithook(audit)
sys.path.insert(0, sys.argv[1])
configured = {"life_store": {"url": "http://127.0.0.1:" + str(port) + "/mcp"}}
observed = {"pid": os.getpid(), "parentPid": os.getppid(), "uid": os.getuid(), "gid": os.getgid(), "sdkVersion": sdk_version,
    "configurationKeys": sorted(configured["life_store"]), "transport": "unobserved", "connected": False, "tools": 0,
    "registeredTools": [], "connectedAfterShutdown": True, "serverReady": False, "serverStopped": False, "failureStage": "import"}
server = None
thread = None
shutdown = None
with open(os.devnull, "w") as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
    try:
        from mcp.server import MCPServer
        import uvicorn
        from tools.mcp_tool_discovery import register_mcp_servers, get_mcp_status
        from tools.mcp_tool_lifecycle import shutdown_mcp_servers
        shutdown = shutdown_mcp_servers
        endpoint = MCPServer("toy-disposable-life-store")
        @endpoint.tool()
        def fixture_ping() -> str:
            return "TOY_MCP_HTTP_FIXTURE"
        observed["failureStage"] = "server-start"
        server = uvicorn.Server(uvicorn.Config(endpoint.streamable_http_app(), host="127.0.0.1", port=port, log_level="critical", access_log=False))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        deadline = time.monotonic() + 10
        while not server.started and thread.is_alive() and time.monotonic() < deadline:
            time.sleep(0.01)
        observed["serverReady"] = server.started and thread.is_alive()
        if not observed["serverReady"]:
            raise RuntimeError("MCP_SERVER_NOT_READY")
        observed["failureStage"] = "native-registration"
        observed["registeredTools"] = sorted(register_mcp_servers(configured))
        status = get_mcp_status(configured)
        if len(status) != 1 or status[0]["name"] != "life_store":
            raise RuntimeError("MCP_STATUS_NOT_OBSERVED")
        observed.update({"transport": status[0]["transport"], "connected": status[0]["connected"], "tools": status[0]["tools"]})
        observed["failureStage"] = "native-shutdown"
        shutdown(timeout=5)
        observed["connectedAfterShutdown"] = any(entry["connected"] for entry in get_mcp_status(configured))
        observed["failureStage"] = "none"
    except Exception:
        pass
    finally:
        if shutdown is not None:
            try:
                shutdown(timeout=5)
            except Exception:
                observed["failureStage"] = "native-shutdown"
        if server is not None:
            server.should_exit = True
        if thread is not None:
            thread.join(timeout=5)
            observed["serverStopped"] = not thread.is_alive()
            if not observed["serverStopped"]:
                observed["failureStage"] = "server-stop"
observed.update(counts)
print(json.dumps(observed))
`;

export const HermesProfile = {
  generateGateway(): HermesGatewayProfileV1 {
    return hermesGatewayProfileSchema.parse({
      gateway: { multiplex_profiles: true, loop_watchdog: true, loop_watchdog_probe_interval_s: 30, loop_watchdog_probe_timeout_s: 10, loop_watchdog_max_strikes: 3 },
      platforms: { discord: { enabled: false } }, streaming: { enabled: false }
    });
  },
  consumeMcpHttp(context: OpsControlContextV1): Promise<Result<HermesMcpHttpReceiptV1>> {
    const failed = (code: OpsErrorCode): Result<HermesMcpHttpReceiptV1> => ({ ok: false, error: { module: "ops", code, message: opsErrorMessages[code], retryable: code === "DEPENDENCY_UNAVAILABLE" } });
    const owned = OpsTestStack.inspect(context);
    if (!owned.ok) return Promise.resolve(owned);
    const snapshot = owned.data.result;
    if (!snapshot?.ready || snapshot.release !== "R0" || snapshot.clock !== "fake" || snapshot.model !== "fake") return Promise.resolve(failed("INVALID_INPUT"));
    try {
      const environment = trustedToolEnvironment();
      const started = process.hrtime.bigint();
      const remainingMs = (): number => context.timeoutMs - Number((process.hrtime.bigint() - started) / 1000000n);
      const pinned = spawnSync("/usr/bin/git", ["-C", installedRoot, "rev-parse", "HEAD"], { encoding: "utf8", env: environment, timeout: Math.min(context.timeoutMs, 3000), maxBuffer: 4096 });
      if (pinned.error || pinned.status !== 0 || pinned.stdout.trim() !== sourceCommit) return Promise.resolve(failed("ATTESTATION_INVALID"));
      const sources = ["uv.lock", "tools/mcp_tool.py", "tools/mcp_tool_discovery.py", "tools/mcp_tool_lifecycle.py", "tools/mcp_tool_transport.py", "tools/mcp_tool_registration.py", "tools/mcp_tool_schema.py"];
      const sourceDigests: string[] = [];
      for (const path of sources) {
        const committed = spawnSync("/usr/bin/git", ["-C", installedRoot, "show", `${sourceCommit}:${path}`], { env: environment, timeout: Math.max(1, Math.min(remainingMs(), 3000)), maxBuffer: 2097152 });
        if (committed.error || committed.status !== 0 || digest(committed.stdout) !== digest(readFileSync(join(installedRoot, path)))) return Promise.resolve(failed("ATTESTATION_INVALID"));
        sourceDigests.push(digest(committed.stdout));
      }
      const installState = join("/Users/johansardar/.hermes/installs", digest(realpathSync(installedRoot)).slice(0, 16));
      const record = installedHermesDependencyRecordSchema.parse(JSON.parse(readFileSync(join(installState, "facts.json"), "utf8")));
      const generation = realpathSync(record.packages.venv.environment);
      const generationRelative = relative(realpathSync(join(installState, "environments")), generation);
      if (!generationRelative || generationRelative.startsWith("..") || isAbsolute(generationRelative) || !statSync(join(generation, "pyvenv.cfg")).isFile()) return Promise.resolve(failed("ATTESTATION_INVALID"));
      const sdkPath = "lib/python3.14/site-packages/mcp/server/mcpserver/server.py";
      const sdkDigest = digest(readFileSync(join(generation, sdkPath)));
      if (sdkDigest !== "cc4fc52d14f07826977c9a2a386719b732507186c081601987dd58dfcee054aa") return Promise.resolve(failed("ATTESTATION_INVALID"));
      const home = mkdtempSync(join(trustedCheckoutRoot(), "build/.toy-r0-fixtures", snapshot.stackId, "native-mcp-"));
      if (remainingMs() <= 0) return Promise.resolve(failed("DEPENDENCY_UNAVAILABLE"));
      const child = spawnSync(join(generation, "bin/python3"), ["-I", "-B", "-c", nativeMcpHttp, installedRoot], {
        cwd: home, encoding: "utf8", timeout: Math.min(remainingMs(), 45000), maxBuffer: 65536,
        env: { ...environment, HOME: home, HERMES_HOME: home, TMPDIR: home, PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1" }
      });
      if (child.error || child.status !== 0) return Promise.resolve(failed("DEPENDENCY_UNAVAILABLE"));
      const observed = hermesMcpHttpNativeObservationSchema.parse(JSON.parse(child.stdout));
      if (observed.parentPid !== process.pid || observed.pid === process.pid || observed.uid !== process.getuid?.() || observed.gid !== process.getgid?.()) return Promise.resolve(failed("ATTESTATION_INVALID"));
      return Promise.resolve({ ok: true, data: hermesMcpHttpReceiptSchema.parse({ scope: "disposable-mcp-http", sourceCommit,
        sourceInventoryDigest: digest(JSON.stringify({ sources, sourceDigests, sdkPath, sdkDigest })), native: observed,
        transportOverrideUsed: false, profilePublicationPerformed: false, liveProviderSends: 0, acceptanceComplete: false }) });
    } catch { return Promise.resolve(failed("ATTESTATION_INVALID")); }
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
