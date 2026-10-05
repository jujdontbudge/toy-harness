# Toy build progress

## 2026-10-04 — initial authoritative checkpoint

The implementation checkout started with instructions and launch prompts only, with a clean worktree at 9896649. No prior build/state.json or implementation existed. The complete R0–R5 objective remains active. The planning repository supplies the current cards and exact acceptance assertions; build/cards.json and tests/acceptance-index.json retain source digests and individual whole-assertion hashes.

Measured host: macOS 26.7.1 (25G241), ARM64, 8,589,934,592 bytes RAM, Node 24.21.0, npm 11.19.0. Approximately 119 GiB disk available. Existing ai.hermes.gateway PID 3736 and net.johansardar.assistant.core PID 3186 are running. Their profiles, files, credentials and services have not been changed. Memory reported 68% available; no disposable stack or additional model worker has been started.

R0.K1 is in progress: written owner/public-import graph, private workspace module skeletons, TypeScript strict/index checks, dependency-cruiser, isolated Python static-check configuration. The production control identities and independent filesystem ownership are still uninstalled/unverified. AT-hermes-config-101 remains pending until the complete K4 CLI-driven static assertion, references, generators and map checks exist. No R1 behavior, live-provider integration or deployment has started.

Next: run K1 compiler/import/Python gates and fixed negative fixtures, retain receipts, commit/push the coherent implementation-availability checkpoint, then R0.K2. Full AT verdicts remain pending rather than being inferred from compiler success.

## R0.K1 — implementation available, full acceptance pending

The eleven bootstrap compiler/import checks pass, including real compiler/import-linter rejection diagnostics for injected private/protected imports and unsafe TS/Python types. Evidence: build/evidence/R0.K1/foundations.json. The 83-card / 1,425-AT source index found 1,301 stale TEST-PLAN line references; unique actual assertion bindings and both line positions are retained in build/spec-index-drift.json and tests/acceptance-index.json. K1 is available for same-release integration; the whole AT-hermes-config-101 and independently protected production filesystem remain pending. Next unblocked card: R0.K2.
