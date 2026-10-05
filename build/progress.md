# Toy build progress

## 2026-10-04 — initial authoritative checkpoint

The implementation checkout started with instructions and launch prompts only, with a clean worktree at 9896649. No prior build/state.json or implementation existed. The complete R0–R5 objective remains active. The planning repository supplies the current cards and exact acceptance assertions; build/cards.json and tests/acceptance-index.json retain source digests and individual whole-assertion hashes.

Measured host: macOS 26.7.1 (25G241), ARM64, 8,589,934,592 bytes RAM, Node 24.21.0, npm 11.19.0. Approximately 119 GiB disk available. Existing ai.hermes.gateway PID 3736 and net.johansardar.assistant.core PID 3186 are running. Their profiles, files, credentials and services have not been changed. Memory reported 68% available; no disposable stack or additional model worker has been started.

R0.K1 is in progress: written owner/public-import graph, private workspace module skeletons, TypeScript strict/index checks, dependency-cruiser, isolated Python static-check configuration. The production control identities and independent filesystem ownership are still uninstalled/unverified. AT-hermes-config-101 remains pending until the complete K4 CLI-driven static assertion, references, generators and map checks exist. No R1 behavior, live-provider integration or deployment has started.

Next: run K1 compiler/import/Python gates and fixed negative fixtures, retain receipts, commit/push the coherent implementation-availability checkpoint, then R0.K2. Full AT verdicts remain pending rather than being inferred from compiler success.

## R0.K1 — implementation available, full acceptance pending

The eleven bootstrap compiler/import checks pass, including real compiler/import-linter rejection diagnostics for injected private/protected imports and unsafe TS/Python types. Evidence: build/evidence/R0.K1/foundations.json. The 83-card / 1,425-AT source index found 1,301 stale TEST-PLAN line references; unique actual assertion bindings and both line positions are retained in build/spec-index-drift.json and tests/acceptance-index.json. K1 is available for same-release integration; the whole AT-hermes-config-101 and independently protected production filesystem remain pending. Next unblocked card: R0.K2.

## R0.K2 — worker in progress, full source accounting

One gpt-6-luna/max worker owns the independent K2 lint/codegen card under frozen primitive schemas; no additional stack/model/VM process is admitted. The parent owns shared integration and build checkpoints. The source inventory now independently discovers all 1,425 assertions in current top-level specs, verifies every index definition/release/rung binding, and includes 13 integrated CLI cards. Required sets for R2.08, R4.06 and R5.05 are respectively 1,086, 98 and 1,425 IDs. Acceptance verdicts live in build/state.json separately from the regenerated source index so index regeneration cannot erase evidence. K2 and all release acceptance remain pending.

## K1 verification-fixture cleanup and K3 boundary

A negative TypeScript fixture exposed compiler emission into dist on failed checks. The shared compiler now forbids emission on errors, and the bootstrap gate removes outputs belonging to fixtures it actually created. All eleven checks pass again, with fresh evidence and no fixture artifacts remaining in cli/dist or packages. K1 acceptance remains pending the complete K4 assertion. The K3 public boundary is written in docs/adr/0003-cli-bootstrap.md; its implementation waits for K2 availability. Draft integration PR: https://github.com/JohanSardar/toy-harness/pull/1.

## K2 integration review and K3 contract preparation

The parent review found and corrected total uint64 validation, template-comment detection, failed-fixture cleanup and static receipt freshness issues. The worker is rerunning the gate with exclusive fixture ownership, empty-directory cleanup and per-attempt reports. Generated Swift contracts compile using the already installed macOS 26.5 SDK with Swift 6.3.3; the default macOS 27 SDK is incompatible. No system SDK selection, toolchain installation or existing service was changed. K2 availability is still awaiting the coherent handoff and fresh integration gate.

The unexported K3 contract draft records all 53 CLI command declarations and strict offline help/version/failure shapes. Its map rows are preparation only. Owner request/result schemas, generator support for compound shapes, executable behavior and all CLI acceptance remain pending.

## R0.K2 — implementation available; K3 started

Fresh parent integration gates pass: 14 foundation checks and 29 K2 static/codegen checks. Public entry boundaries now derive from the owner graph, accept declared compiled public interfaces and reject private contracts/peer/test imports. The source policy rejects template-hidden comments, typing aliases and unmarked pytest discovery; fixture cleanup preserves unowned changes. Generated TS/Python/Swift primitive artifacts and explicit Draft 2020-12 JSON schemas pass drift and compilation checks. Per-attempt receipts and source/generated hashes are retained. Research B02 records Zod 4.6.5 latest-tag metadata and locked integrity.

K2 is AVAILABLE for same-release integration, with the whole AT-hermes-config-101 still pending K4. Product/test JavaScript is denied; tooling JavaScript strict checking remains limited as documented. Compound schema projections and every runtime/identity/launcher acceptance remain open. K3 / CLI-01 is in progress. Existing recorded service PIDs remain present, memory reports 66% available and swap is stable at 1,727 MiB; no disposable stack, production cutover or deployment has occurred.

## K3 offline executable checkpoint

The sole generator now emits 26 named schema types, six concrete help/version command aliases and five code artifacts, including the schema-bundle digest. TypeScript/Python/Swift compilation, boundaries and the fresh 29-check K2 policy/drift gate pass. Review fixed optional non-null Swift field decoding and keyword field names, rejected unsupported exclusive unions and made the ESLint root-config project selection deterministic. Generated DTOs remain static wire projections; runtime JSON-schema validation and cross-language round-trip acceptance are still pending.

The packed, offline-installed `toy` executable passes five test groups through subprocesses: complete declaration inventory and every group's explicit/bare help in human/JSON output, actual executable/schema artifact digests, malformed options/IDs and privilege flag denial, lossless large decimal arguments, production test denial and unavailable owner results. Receipts and source hashes are in build/evidence/R0.K3/bootstrap.json. These prove only the offline/parser subset, not a complete AT. Owner schemas, reference metadata, authorized input files, status/doctor and confined stack/clock/probe paths remain open; K3 stays IN_PROGRESS.

K4a's sole worker delivered a written plan for exactly four references, with historical source snapshots and pending protected registration/owner prerequisites. No reference, provider or migration was exercised. Existing recorded service PIDs remain present; memory reports 65% available and swap 1,719 MiB. No production change, cutover or deployment occurred.

## K3 strict diagnostic interface and unavailable-state reads

The sole contract generator now emits 83 named schemas, twelve concrete help/version/status/doctor aliases and five code artifacts. Canonical Life Store record/evidence references, Sources coverage/status, Ops service/quota/cadence/secret views, strict Attention snapshot and publisher compatibility compose the diagnostic payloads. Cadence arguments and exhaustive counts derive from one enum. All 29 fresh static/compiler/import/codegen checks pass; generated TypeScript, Python and Swift compile.

The existing Ops public read interface reports all nineteen expected service IDs, six unavailable diagnostic reads, unknown secret readiness and all 53 CLI capabilities without inventing installed identity, health or acceptance. Packed offline CLI checks pass six groups / 88 subprocess invocations, including explicit/default release, deep/human diagnostics and unattested-stack rejection. These prove only the unavailable-state subset; full K3 and every whole AT remain pending. Current hashes and receipts are in build/evidence/R0.K3/bootstrap.json.

K4a now has the exact local toy-control source extraction, still without protected registration/manifest/reference verification. Native bootstrap design records actual-caller-UID App Sandbox execution as conditional, separate from real _toy_agent gates. Persistent supervised stack ownership and same-sandbox PostgreSQL AF_UNIX behavior require a frozen interface and runtime proof; no launcher, signing, stack or service change occurred. One Luna/max child is reviewing this bounded increment. Existing observed Node PID 3186 and osascript wrapper PID 3736 remain present under UID 501; this is preservation observation, not Hermes supervision acceptance. Memory reports 61% available and swap 1719 MiB.

## Diagnostic checkpoint review and identifier correction

The independent Luna/max review accepts the bounded unavailable-state path and requires further design before non-null owner reads. The parent fixed arbitrary check/capability identifiers at the type/schema rung: finite enums derive from the nineteen service plus six read checks and all 53 CLI capabilities. The current generator emits 85 named schemas, twelve command aliases and five code artifacts (102 total). All 29 fresh static checks and six packed CLI checks / 88 invocations pass after the correction. Human diagnostics show the complete validated inventory/freshness fields, with terminal escaping and a 2 MiB output ceiling. The remaining service/source/cadence detail representation is tracked as Ops interface work before transport admission; no full K3 acceptance or runtime health is claimed.

## Receipt privacy correction and temporary-stack interface

The packed CLI collector no longer stores argument values or raw stderr, and it retains stdout only after public protocol and disclosure validation. Unvalidated output is represented by byte counts and null. Fresh unpredictable canaries are checked against raw, canonical JSON and final archived output; fixture cleanup runs even if archival fails. Seven historical receipt files were transformed with original SHA-256 and unchanged-acceptance metadata. Fresh six-check / 88-invocation packed CLI verification and the full strict compilation, boundaries, Python, source policy and 102-artifact generation checks pass. Evidence: build/evidence/R0.K3/receipt-privacy.json. Full AT-cli-9 remains pending.

ADR 0009 records the required versioned strict service/source/cadence/obligation detail composition; it admits no non-null owner transport. ADR 0010 freezes the temporary Ops stack lifecycle and supervised native pipe/controller proposal before implementation. Actual App Sandbox entry, inherited PostgreSQL AF_UNIX access, native peer authentication and cleanup remain unproven. The sole Luna/max child is reviewing that lifecycle; no signing, database, stack, identity installation or production change occurred. K3 stays IN_PROGRESS and all whole acceptance assertions remain NOT_IMPLEMENTED.
