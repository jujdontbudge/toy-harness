# ADR 0057: Read-only PostgreSQL artifact inspection through doctor

Status: accepted for the R0.04 artifact-descriptor step only. The inspection was verified through ordinary-caller `toy doctor --deep --json` on 2026-10-07: actual initdb 17.11, all seven required option names, executable and receipt digests. Native installation, cluster initialization, service readiness, and the whole acceptance remain pending. Evidence: `build/evidence/R0.04/pg-artifact-descriptor-final-verification.json`.

## Context

The planning contract pins native Apple Silicon Homebrew PostgreSQL 17.11, requires the executable path and package identity to be recorded, and assigns the future cluster to the separate Toy data path. The existing disposable accounting owner already selects `initdb` from `/opt/homebrew/opt/postgresql@17/bin` (`packages/self-improvement/src/accounting-postgres.ts`). That Homebrew `opt` link is an acquisition selector and may move as packages are updated. It is not an acceptable future privileged execution path.

Ops deep doctor already reports a registered `service.postgres` check. This step replaces only that check's generic not-implemented view with a private read-only artifact descriptor. It does not require an installed-service manifest or add a public owner API, CLI command, DTO, or service protocol.

## Decision

An ordinary, non-root deep doctor may resolve the existing initdb acquisition selector once to a versioned canonical Cellar path, hash the resolved executable, and invoke only its bounded `--version` and `--help` reads with a sanitized environment and bounded output. It records the exact resolved path, observed version, executable digest, supported option names, and the digest of the adjacent Homebrew installation receipt when that receipt is present and readable. Missing or unreadable metadata is reported as such; no bottle identity is inferred from a path or invented.

Inspection is blocked before path resolution or process execution when effective or real UID is root, because the acquisition selector may resolve to user-modifiable bytes. Future privileged execution must consume the exact resolved versioned path and descriptor, then independently validate the path and recheck its hash. It must not resolve or execute the mutable `opt` selector again.

The descriptor requires observed initdb version 17.11. `--help` is used only to record presence of the fixed initialization option names. It cannot prove that a particular authentication value is accepted, and a successful descriptor is not proof of a valid authentication configuration.

The first admitted doctor measurement returned `POSTGRES_VERSION_NOT_OBSERVED` without preserving raw stdout or stderr. The second measured readback confirms a successful canonical version banner with a Homebrew suffix, which the first strict parser omitted. The version parser accepts only the anchored canonical `initdb (PostgreSQL) <version>` line, optionally followed by the exact literal ` (Homebrew)`, and still requires the parsed version to equal 17.11. Its readback reports only a bounded exit status, allowlisted signal token (or `OTHER`), allowlisted error category, and booleans for the canonical prefix and Homebrew suffix. It never returns command output, error text, argv, or environment values.

The `service.postgres` CheckView remains `BLOCKED` for service readiness in every outcome. A measured executable is artifact evidence only; it does not prove package installation provenance, service installation, identity enforcement, initialized data, socket ownership, daemon state, or readiness. If the artifact is absent, unreadable, outside the expected versioned Cellar path, mismatched, or cannot be measured within bounds, doctor reports the exact safe reason and omits unobserved values.

## Consequences

This provides the smallest existing public readback for the exact executable that a later fixed preparation owner may consider. The root preparation owner, authentication flags, database administrator role, creation of `/Library/Application Support/Toy/data/postgres/17`, and any runtime or migration operation remain separate work behind their existing gates. No service is started and no database path is written by artifact inspection.

The existing `service.postgres` inventory slot remains the public feature entry. Feature facts link the read to `OpsControlRead.doctor` and the existing `doctor` command; no new acceptance claim is created. AT-ops-30, service installation, and readiness remain pending.

The selected Homebrew package and receipt format may vary. If the executable or receipt cannot be measured safely, the descriptor stays incomplete and the service check stays blocked rather than falling back to PATH, a mutable alias, or a guessed bottle identity.
