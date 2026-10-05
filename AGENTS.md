# AGENTS.md: rules for every agent working in this repo

This repo builds **Toy**, Johan's always-on personal assistant on Hermes Agent. The full spec is in `~/Documents/Codex/personal-assistant-harness/specs/` (start with `README.md`). These rules are **binding**. Their full text is `specs/PRINCIPLES.md`; names come from `specs/CONTRACTS.md`.

Sources: Johan's direct instructions; Lauren Tan (poteto), "How I shipped 2,000 PRs last month" (the X talk Johan sent); Matt Pocock's codebase-design / deep-modules skills.

## 1. Testing: only through the largest interface (Johan's rule)
**No test exists unless the behavior can't be tested from a larger interface.** For every behavior, use the first rung that can reach it:
1. **SIM:** a simulated Johan talks to the real Toy in a seeded fake world (`specs/user-sim-evals.md`).
2. **CLI:** the `toy` control CLI against the real local stack with fake external providers.
3. **Module interface:** the module's public interface, with its real database and fake external adapters.
4. **Internal:** only pure logic the rungs above can't reach (time math, DST, digests, parsers). Each one needs an entry in `tests/registry.yaml` (`{id, rung: INT, justification}`) explaining why rungs 1–3 can't reach it. CI fails without that entry.

Never test private functions. Never mock internal collaborators. Fakes exist **only** at external seams: providers, clock, model route, OS. A refactor that keeps interface behavior must never break a test. Every `AT-*` acceptance test runs at the rung `specs/TEST-PLAN.md` assigns.

## 2. Trust comes from verification
Don't claim something works because the code looks right. **Run the real system and collect evidence** (CLI output, receipts, readbacks, DB state, traces) before saying done. Every card's "done" means its ATs pass at their rung, with evidence saved in `build/evidence/`.

## 3. One control CLI: `toy`
All driving and inspection of the system goes through the `toy` CLI (`specs/cli.md`).
- **No one-off scripts** for poking the system. If the CLI can't do something, extend the CLI.
- The CLI is a thin adapter over module interfaces. It holds no logic and never escalates privileges.
- It has `--json` output on everything.

## 4. Feature map = the system's memory
`skills/toy-control/FEATURE-MAP.md` lists every feature: what it does, which requirement it serves, how a user reaches it, which module and CLI command exercise it, and which tests prove it. Every new feature, command or AT gets an entry in the same PR. CI fails on missing or dangling entries.

## 5. Deep modules
- Small interface, lots of behavior hidden behind it. Put seams only where something really varies: two adapters make a real seam; one is hypothetical.
- Apply the **deletion test** before adding a module: if deleting it just moves complexity to callers, it earned its place; if it was a pass-through, don't add it.
- A new module needs its written interface first.

## 6. The codebase is the agents' memory, so keep it pristine
Agents copy whatever patterns they see, and one workaround spreads everywhere.
- **One paved path** per concern. Use the generators: `toy new connector|tool|skill|migration`. Never hand-roll a second way.
- **No comments in code.** Rationale goes in the spec or `docs/adr/`; usage goes in the feature map and skills. The only exceptions are license headers and generated-file banners. Lint enforces this.
- **No TODO / FIXME / "workaround" markers.** Tech debt becomes a tracked item with an owner, plus a lint rule that stops it from spreading.
- Scope: these rules cover Toy-owned code. Patches to upstream projects (Hermes, etc.) follow that project's conventions and stay minimal.

## 7. The correction ladder
Whenever you or a reviewer find a mistake, fix it at the **highest** rung that works:
1. **Make it impossible:** architecture, types, data structures, DB constraints, module boundaries.
2. **Static analysis:** a lint rule, compiler diagnostic or CI check.
3. **Guidance:** skill text, rules, review checks.
4. **Style guide / human review:** last resort, never the only fix.

A repeated mistake may never be "fixed" with only a note or a memory entry.

## 8. Locked down by default
- Import boundaries between modules are enforced from the dependency graph: dependency-cruiser for TypeScript, import-linter for Python. A module imports only another module's public interface.
- TypeScript `strict` + `noUncheckedIndexedAccess`; Python `pyright --strict` + ruff.
- No `any`, no unchecked casts, no floating promises.
- Types come only from the generated `@toy/contracts` package; never hand-copy DTOs.
- Protected areas (Authority, graders, release rules) are unreachable by import and by file permission.

## 9. The gardener
A nightly job and skill (`toy-gardener`) weed out anti-patterns, duplicate paths, dead code, comment/TODO violations, boundary leaks and stale feature-map entries. It fixes them at rung 1–2 of the ladder, or at minimum adds a lint rule. Weed as you go too: leave every file in a state you'd be happy for the next agent to copy.

## 10. The outer loop
Events (Discord, Gmail, Canvas, calendar, wearables, CI, Toy's own incidents) flow into Toy's 3-minute review loop, which kicks off work automatically. Invest in the "kitchen" (skills, CLI, feature map, checks) rather than a separate "brain" layer.

## Hard rules from Johan (never break)
- **Build it ourselves** unless it's impossible from this Mac. The only external services are Backblaze B2 and Healthchecks.io.
- **Never pay extra:** no paid API keys, credits or paid fallbacks.
- **Secrets** never go in code, logs, chat, git or model context. Collect them only via the secure box → Keychain.
- Preserve the running `ai.hermes.gateway`, the `toy` Hermes profile, the old core service, Chrome profile, accounts and files. No destructive operations; back up before migrations.
- Toy never messages people Johan knows without scoped permission. Purchases and public posts need one-tap approval.
- **Don't stop when you can do it yourself.** Use the CLI, the browser and the machine. Ask Johan only for the steps the spec lists as his.
