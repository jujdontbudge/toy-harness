# Devin handoff: build Toy

You are building **Toy**, Johan's always-on personal assistant on top of **Hermes Agent**. The planning is done and signed off. Your job is to build it, following the specs exactly.

## Read in this order
1. `specs/README.md`: index, plus requirement → spec traceability.
2. `specs/PRINCIPLES.md`: **binding**.
   - Deep modules; poteto's verification-driven trust.
   - **Test only through the largest interface** (SIM → CLI → module → justified internal).
   - **No code comments** in Toy-owned code; the correction ladder; locked-down import boundaries; the gardener.
3. `specs/CONTRACTS.md`: **canonical** names, owners, tables, tools, ports, timings and the Amendments table. It wins every conflict.
4. `specs/FIXES.md`: release plan R0 → R5 and audit resolutions. Superseded rows are marked.
5. `specs/BUILD-PLAN.md`: the ordered build, day by day for R0/R1. **Start with the "kitchen" cards** (repo skeleton, strict checks, `@toy/contracts`, the `toy` CLI, the local fake-provider stack, generators, FEATURE-MAP).
6. `specs/TEST-PLAN.md` and `specs/user-sim-evals.md`: every AT-* acceptance test with its rung.
7. The module specs: obligations, attention, authority, sources, lifestore, hermes-config, client-apps, hands, self-improvement, adhd-features, activity-focus, ops, workflows, cli.
8. `REQUIREMENTS.md`: §0 principles, §A Johan's original words, §B grill decisions. `memory/*.md`: settled decisions.
9. `specs/gates/`:
   - `R0-research.md`: inference route, UIUC, Canvas, health, Oura/WHOOP, Postgres, backups.
   - `R0-facts.md`: verified facts and decisions.
   - `LOGINS-READY.md`: accounts that exist.

## Hard rules (Johan's, non-negotiable)
- **Build it ourselves unless it's impossible from the Mac.** The only external services are Backblaze B2 and Healthchecks.io. Grafana, Composio and Bitwarden are **dropped**; secrets live in the macOS Keychain.
- **Never pay extra.** No paid API keys, no credits, no paid fallback. The model route is ChatGPT **Pro** through the official **"Sign in with ChatGPT"** plan-usage OAuth → Responses API (see R0-research §1). The legacy `chatgpt.com/backend-api` route must be retired.
- **Johan's 3-minute cadence:** a full AI review every 3 minutes, including during sleep, is authoritative. Reduced modes are experimental trial arms only.
- **Sleep is the only quiet time.** The drill-sergeant escalation ladder lives in `behavior/attention.yaml`.
- **Authority:** no messages to people Johan knows without scoped permission. Purchases and public posts need one-tap approval. Toy can never edit its own permissions, graders or release rules.
- **Secrets** never go in code, logs, chat, git or model context.
- Use fake providers until a release's gate says otherwise.

## Environment facts
- **Server:** MacBook Air M2, 8 GB, macOS 26.7.1, Tailscale `100.78.200.121`, passwordless sudo. Homebrew + PostgreSQL 17.11 installed (not started). Node 24.21.
- **Hermes:** `~/.hermes/hermes-agent` at commit `8d5e3e4`; profile `toy` at `~/.hermes/profiles/toy`.
  - Live today on Discord (bot "Toy", private) using the legacy route.
  - Host gateway LaunchAgent: `ai.hermes.gateway`.
- **Old custom Node core** (`src/`, `test/`, `net.johansardar.assistant.core`) runs ledger, backups and the secure box on port 8787. It is to be **retired and migrated** per `specs/obligations.md` §15 and `specs/ops.md`.
- **Accounts ready:**
  - Google Cloud project `toy-assistant-510700`: Gmail + Calendar APIs, OAuth consent "Toy", External/Testing, Desktop client "Toy server (Mac)". Publish to production before live Gmail use, since Testing tokens expire after 7 days.
  - Backblaze bucket `toy-backup-js77-q8f3`.
  - Healthchecks.io account.
  - iCloud Drive as the second backup target.
  - Apple Developer (Johan's Apple ID).
  - iPhone on the tailnet.
- **Secrets** are collected on the Mac only, via the secure box into the Keychain, at the moment the code that uses them is deployed. They are never sent to your cloud environment.
- **Deferred by Johan:** Oura (he has a custom Rust setup), the wake word, WHOOP (R2), Microsoft Graph for UIUC (needs IT approval; mail forwarding is the interim).

## Workflow
1. Build and test in your environment against the fake-provider stack (`toy stack up`).
2. Push to the harness repo, one PR per BUILD-PLAN card. Each PR lists its AT IDs and their passing rung, plus its FEATURE-MAP entry.
3. Deployment to the Mac (LaunchAgents, users, Keychain, live logins) is done on the Mac by Claude/Johan from your merged releases, following `specs/ops.md`.

## First milestone
The R0 kitchen cards, then **R0.01: the Sign in with ChatGPT Hermes provider** (R0-research §1). That work is a Hermes patch on branch `toy/siwc-provider`, kept minimal and upstreamable.
