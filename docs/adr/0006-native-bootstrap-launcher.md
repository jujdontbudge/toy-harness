# ADR 0006: isolated R0 bootstrap launcher and service-identity gates

Status: design only; no launcher was built, signed, installed, or run. Recorded 2026-10-04.

## Decision

Keep R0.K3/K4a bootstrap execution separate from the installed `_toy_agent` identity gate. A future R0 test-stack launcher may run as the caller's real OS UID inside a dedicated macOS App Sandbox, provided the Ops owner freezes the test-only launcher manifest and its public operation before implementation. The manifest records the UID/GID read from the running process; it never accepts an identity argument or changes UID/GID. This allows a truthful test-stack identity without claiming that it is `_toy_agent`.

The test launcher is a one-shot child of the Ops test-stack owner, invoked only through the versioned `toy` CLI. It launches only the manifest's sealed K4a fixture closure in a private R0 stack. It does not install a LaunchDaemon, touch the existing `ai.hermes.gateway` service or `toy` Hermes profile, or write under the production `$TOY_ROOT`. It cannot run arbitrary executables, SQL, URLs, shell text, caller-provided fixtures, or provider requests. Fake clock and fake model are the only K4a settings.

This is a separate local feasibility mechanism. It does not replace the canonical service launcher or prove any service-UID predicate. R0.04 still measures and records the real service UID/GID, protected parents, recovery identity, roles and socket/credential manifest. R0.05 still runs the denial matrix as the actual `_toy_agent` and verifies system-service lifetime separately from GUI capability. A caller-UID test receipt cannot close those gates.

Apple's current documentation shows an embedded command-line helper signed locally with the ad-hoc identity `-`, and documents App Sandbox inheritance for a child process. The required candidate shape is:

- Parent launcher: `com.apple.security.app-sandbox=true` only; no `inherit`, network, file-selection, Keychain, app-group, GUI, TCC, or privilege entitlement.
- Embedded child helpers: exactly `com.apple.security.app-sandbox=true` and `com.apple.security.inherit=true`.
- Sign helpers from the inside out with an ad-hoc local signature, then sign the immutable parent bundle; verify the exact bundle and child signatures and entitlement dictionaries before every stack admission. Record executable and CodeDirectory digests. A valid signature identifies sealed bytes and entitlements; it does not establish that runtime denials work.
- Use only fixed framed inherited pipes for launcher control, operation results, and any registered fake-provider/model seam. Stdout is protocol-only; stderr is bounded and redacted. Close every other inherited descriptor and construct a minimal explicit environment with no ambient credentials or user configuration. Node helpers run with `--jitless` as the existing Ops sandbox design specifies.
- Run the pinned PostgreSQL 17.11 test cluster as a child inside the same sandbox and use only a per-stack Unix socket under its private sandbox container. Set `listen_addresses=''`; do not bind a TCP listener. The private cluster, socket, migration schema and fake fixtures belong to the stack's disposable root. If the exact macOS sandbox blocks this socket or the pinned runtime, admission fails closed; do not add a network entitlement or move a helper outside the sandbox to make it work.

This parent/helper arrangement is a candidate extension of the generic signed, confined K3 launcher and the R5 App Sandbox/pipe design in Ops. The existing R5 bundle, `_toy_repair` identity, and `toy.replay-rpc/v1` protocol are not reused. Ops §5.1's explicit ban on Unix-socket service access is scoped to the R5 target worker; it does not establish that the K3 test parent may use PostgreSQL's private AF_UNIX socket. That remains a K3 feasibility predicate. The R0 test bundle identifier, artifact path, fixed control-frame schema, stack lifecycle/controller, durable operation ownership, and exact socket viability still require an Ops owner freeze. Because `stack up` and later `probe run/show/down` are separate CLI invocations, one invocation's inherited pipes cannot themselves serve as the later control transport. Freeze a bounded owner-supervised lifecycle/control contract before implementation; do not leave PostgreSQL detached or introduce an undeclared local control socket. These fields must be added to generated `@toy/contracts` and the registered owner inventory before any code is written. They are not hand-copied DTOs and are not yet canonical contract exports.

## Fixed manifest and admission contract

The Ops-owned per-stack manifest is immutable for the stack generation. The generated schema must include these fields; measured values remain absent until the owner produces a sealed test stack.

| Manifest section | Required contents | Admission rule |
|---|---|---|
| Stack binding | `stackId`, generation, `release=R0`, registered world ID, registered K4a case inventory digest, request ID, `clock=fake`, `model=fake` | Values come from the CLI's registered schema and Ops registration. The caller cannot provide manifest bytes, code, SQL or expectations. |
| Test launcher | Bundle ID and protected artifact reference; executable, dependency-closure, entitlement and CodeDirectory SHA-256 digests; signing mode; signature verification result; fixed argv and frame-schema version | Verify all bytes immediately before spawn and reject changed, unsigned, substituted or partially signed artifacts. No launchd label is installed for this test-only launcher. |
| Actual process identity | Effective UID/GID read by the launcher and independently read back for every child; process incarnation/PID; parent identity | Must equal the actual invoking OS identity. Never accept a caller-supplied UID, `--as`, `--uid`, `UserName`, or service name as a substitute. Never record this UID as `_toy_agent`. |
| Process closure | Exact executables and versions for launcher, Node 24.21.0, Python adapter and PostgreSQL 17.11; argv, working directory, environment allowlist, parent/child relation, cancellation behavior | Reject undeclared children, detached processes, package downloads, inherited secrets and unregistered listeners. Every child inherits the sandbox. |
| Private resources | Per-stack sandbox-container root, private PostgreSQL cluster/database `toy`/schema `pgboss`, Unix socket path, registered fixture roots, allocated IPC handles, owned process-incarnation references | No path may resolve into production `$TOY_ROOT`, a Hermes profile/home, Johan's Chrome/profile, existing databases, or a production service socket. `toy stack down` may clean only resources proved owned by this stack generation. |
| Capabilities | Exact framed pipes, fake-only provider/model seams, fake test clock, read-only static artifact inputs and bounded disposable output | No network entitlements, TCP bind, DNS, live provider, credentials, GUI/TCC, Keychain, broker, raw database socket outside the stack, or protected control endpoint. A capability absent from the generated manifest is denied. |
| Resource admission | Provisional 1,024 MiB aggregate stack ceiling, measured headroom, normal memory pressure/stable swap, at least 1.5 GB available memory, 512 MiB margin, one heavy-work lease | A missing launcher or resource measurement blocks the dependent probe. These thresholds are conditions, not current measurements or proof that the ceiling is safe. |
| Attestation | Manifest digest, stack generation, exact source/release/control/schema digests, registered case-manifest digest, actual caller UID/GID, fixed IPC/resource bindings, and expiry/freshness | Revalidate before each mutation. Invalid, stale, writable-by-target, symlink-escaped, substituted or production-pointing attestations fail closed. Never serialize credentials or capability bytes. |

The public control sequence is the K3 interface already declared in the CLI contract:

```text
toy --env test stack up --release R0 --request-id <UUID> --world <registered-world-id> --clock fake --model fake --json
toy --env test --stack <returned-stack-UUID> probe run <registered-AT-id> --request-id <UUID> --case <registered-case-id> --wait-ms 120000 --json
toy --env test --stack <returned-stack-UUID> probe show <returned-operation-UUID> --json
toy --env test --stack <returned-stack-UUID> stack down --request-id <UUID> --json
```

Ops owns `OpsTestStack.up/down` and read-only `OpsControlRead.status/doctor`; the registered evaluator/test controller owns `runRegisteredProbe/registeredProbeStatus`. K4a references use only sealed registered cases that call the real public owner operations. The Sources fake is a registered in-process external seam. The tool adapter crosses only the registered owner transport. The migration is applied by the Obligations owner to the disposable stack, then read back through Obligations public operations. The skill probe records the local source digest and metadata; it does not publish or load the skill. The CLI never asserts private database state itself.

The returned public receipt is the generated `toy.cli.v1` envelope and `RegisteredProbeOperationV1` / `RegisteredProbeReportV1`, bound to the stack, artifact, case-manifest digest and operation ID. Each mandatory source-assertion cell carries a safe `CheckViewV1` state and independent record/evidence links. `toy stack down` returns resource ownership, stopped-process and retained-evidence references. The contract preserves `NOT_IMPLEMENTED`, `DEPENDENCY_UNAVAILABLE`, `BLOCKED`, `FAIL`, and `PASS` as distinct outcomes. A compile receipt or signature-verification receipt is static evidence only; neither is a runtime K4a receipt or an AT PASS.

## R0 order and acceptance boundary

`BUILD-PLAN.md` makes compiled implementation availability distinct from assigned-rung acceptance. R0.K4a depends on available K3 implementation and frozen owner interfaces; R0.K4a requires the four references to compile through their public boundaries, while R0.K3's actual-identity/launcher cases remain blocked until R0.04–05. This design preserves that distinction:

1. K3 freezes and implements its generated public operations and fixed stack/probe registrations. The CLI's current offline checkpoint is not those transports.
2. K4a freezes the four named public references and case registrations, then compiles them through generated owner interfaces and runs their public CLI probes only after Ops can attest the dedicated test launcher and exact stack.
3. The bootstrap launcher's actual caller UID and sandbox receipts prove only that isolated test stack. K4 may consume verified K4a references and static/public receipts without claiming that the actual `_toy_agent` service boundary has passed.
4. R0.04 measures real service identities and protection. R0.05 then runs its exact denial matrix under real `_toy_agent`; a test stack running under the builder UID is not evidence for this step.

The first source snapshot for this ADR showed an offline/parser-only CLI. During the design review, the parent added the public `OpsControlRead.status/doctor` adapter and its registered safe projections (ADR 0008). On the latest captured source snapshot, production `status/doctor` calls return explicit `NOT_IMPLEMENTED` owner probes and capability states; test-environment status/doctor remains attestation-gated. These diagnostic reads do not create an Ops test-stack transport or K4a public receipt. `stack`, test-clock and registered-probe invocations still lack their owner transport and return `DEPENDENCY_UNAVAILABLE`. Existing K3 evidence remains an offline/parser-only checkpoint; K4a evidence remains preparation only. Thus this ADR provides a written candidate interface and ordering, not a runnable bootstrap route. Until the Ops test-launcher manifest, lifecycle/controller contract and actual per-stack attestation exist, the public `stack/probe` operations remain blocked; there is no source-supported fallback to an unconfined helper, private script/database call, production service, or simulated service UID.

Full `AT-cli-4`, `AT-cli-6`, `AT-cli-10`, R0.04, and R0.05 acceptance remains independently pending. The candidate caller-UID launcher does not satisfy any requirement for installed-identity positive/negative evidence, memory-pressure enforcement, or installed native service lifetime. The 1,024 MiB ceiling remains provisional until the complete required `capacity.stack` evidence is collected.

## Exact unresolved predicates

- Ops has not frozen a K3-specific sandbox bundle identifier, immutable artifact path, public test-launcher manifest schema, or fixed internal pipe-frame schema.
- K3 has not frozen how one stack generation is owned across separate `stack up` and `probe run/show/down` CLI invocations. An inherited pipe only connects its creating process tree; no source declares a persistent controller transport or permits an unowned/detached PostgreSQL process. The Ops owner must freeze this lifecycle/control boundary before implementation.
- No source-backed implementation confirms that the pinned PostgreSQL 17.11 server and client can use a per-stack Unix socket inside the same App Sandbox with all network entitlements absent. This must be proven through the future `toy stack up/status/doctor/probe` path; a denial blocks this design branch.
- Apple documents entitlement signing and child inheritance, but the R0 bundle has not been signed or launched on this host. The prior Ops R5 probe signed and verified artifacts but aborted before parent or child entry markers; it did not prove enforcement. No new R0 result is inferred from it.
- The test bundle's exact SDK/build/runtime hashes, executable closure, resource measurements, attestation freshness and cleanup receipts do not exist yet.
- Numeric service UID/GID, protected parent permissions, recovery identity and actual `_toy_agent` positive/denial results remain R0.04–05 facts to be measured. No number is guessed here.

No explicit user-only signing or installer step is specified for this local feasibility launcher. Ops §5.1 selects ad-hoc local signing and says it assumes no paid developer membership. BUILD-PLAN lists only an unavoidable macOS administrator identity dialog at R0.04, with the builder performing setup; R0.05 lists no human step except any recovery/login interaction the OS actually requires. Do not ask Johan for a new signing approval, purchase, or installation action on the basis of this design.

## Sources

- Binding source order and guardrails: repo `AGENTS.md`; `specs/PRINCIPLES.md`; `specs/CONTRACTS.md` and its Amendments.
- R0 same-release availability and pending acceptance: `specs/BUILD-PLAN.md` lines 27, 37–43, 47, 50–52.
- K3 public/test boundaries, caller identity, test manifest, and public receipts: `specs/cli.md` §§3.1–3.2, 4.2, 5.1, 6, and `AT-cli-4/6`.
- Actual service identities, canonical ports, launchd contract, R5 sandbox design and recorded failed probe: `specs/CONTRACTS.md` service registry; `specs/ops.md` §§4–5.1 and launchd contract; `specs/authority.md` AT-authority-35/37/69/73.
- K3 implementation boundary and K4a receipt route: `docs/adr/0003-cli-bootstrap.md` and `docs/adr/0004-bootstrap-reference-contracts.md`.
- Apple primary documentation: [Embedding a command-line tool in a sandboxed app](https://developer.apple.com/documentation/xcode/embedding-a-helper-tool-in-a-sandboxed-app), [App Sandbox inheritance entitlement reference](https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/EntitlementKeyReference/Chapters/EnablingAppSandbox.html), [Protecting user data with App Sandbox](https://developer.apple.com/documentation/security/protecting-user-data-with-app-sandbox), and [Apple Code Signing Guide: understanding signatures](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/AboutCS/AboutCS.html). Apple's helper guide demonstrates an ad-hoc `-` signature for a helper; its distribution example later re-signs the helper with the parent app's signing identity. Applicability to a complete locally ad-hoc-signed R0 bundle therefore remains a runtime predicate, not an unconditional Apple guarantee.
