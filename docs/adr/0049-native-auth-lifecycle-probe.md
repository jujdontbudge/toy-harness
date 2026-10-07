# ADR 0049: public auth lifecycle acceptance probe

Status: interface written before implementation, 2026-10-07. The bounded source handoff is `build/evidence/R0.03/lifecycle91-source-handoff.json`; no AT91 runtime claim is made here.

## Decision

Extend the existing `HermesAuthProbe.run` owner and `runHermesAuthFixture` with one closed `lifecycle` mode for AT-hermes-config-91. Keep the existing disposable root/profile home, pinned Hermes checkout, fake OAuth/model HTTP endpoint, child-local fake clock, process identity, public argv checks, digest reader, and `HermesAuthFixtureResultV1` receipt. Do not add a module, command, service, protocol, or DTO.

The interface is a fixed sixteen-cell `auth.lifecycle` manifest. The fixture creates one root-owned synthetic Codex credential and two distinct profile-owned credentials through public `auth add`. It moves one profile label to priority zero with public `auth priority`, then gives only that credential two synthetic provider HTTP 429 rate-limit responses and one exhausted-quota readback. A fresh public `auth list` must show the pinned public status text `rate-limited`; after targeted public `auth reset`, a new list must show the target present without that status. The existing fake clock then expires only that target and a fresh public chat refreshes its `added` generation to `added-rotated`; another fresh chat reloads the same generation. Finally, public `auth remove` deletes that profile label. A new profile list must show exactly the surviving sibling, and a fresh profile chat must use that sibling with zero later provider/model effects for the removed target. A fresh root list and chat prove profile lifecycle operations did not change or shadow the root grant.

Pinned supported argv are `hermes auth list openai-codex` for root readback, `hermes --profile toy auth list openai-codex`, `hermes --profile toy auth priority openai-codex toy-fixture-lifecycle-target 0`, `hermes --profile toy auth reset openai-codex toy-fixture-lifecycle-target`, and `hermes --profile toy auth remove openai-codex toy-fixture-lifecycle-target`. Login seeding uses the current public `auth add openai-codex --type oauth --no-browser --label <fixed-label>` path. Chat, expiry, and reload reuse the existing fresh tools-disabled public chat argv builder. No supplied argument can alter executable, profile, store path, endpoint, identity, or actor beyond the sealed case ID.

## Mandatory cells

The registered CLI manifest uses these exact IDs and maps each `phase` to its ID:

| ID | Fixture operation | Required public observation |
|---|---|---|
| `root-add` | `add` | The explicit root-owned seed changes only the disposable root auth digest. |
| `profile-add-target` | `add` | The target is profile-owned; root auth and environment digests stay fixed. |
| `profile-add-sibling` | `add` | A distinct sibling is profile-owned and independently usable. |
| `profile-initial-readback` | `list` | Fresh profile list has exactly the target and sibling labels. |
| `priority-reorder-target` | `priority-added` | Public priority targets the fixed label at zero; provider evidence identifies which row is used. |
| `priority-target-rate-limit` | `chat` | The fake observes two target 429s and one exhausted-quota readback. If Hermes rotates to the sibling, record that attempt and outcome honestly. |
| `reset-exhausted-readback` | `list` | Public list shows the target's `rate-limited` status and the sibling remains present. |
| `reset-target` | `reset` | Public reset names only the target label. |
| `reset-target-readback` | `list` | A fresh list has both active rows; the target remains at priority zero and its rate-limit marker is absent. |
| `reset-target-refresh` | `chat-expired` | The fake clock expires only the reset target; fresh public chat refreshes `added` to `added-rotated`. |
| `reset-target-reload` | `chat-reloaded` | A separate process uses the target's `added-rotated` generation. |
| `remove-target` | `remove` | Public remove names and removes only the target label. |
| `remove-fresh-readback` | `list` | Fresh profile list contains only the sibling; target label is absent. |
| `remove-sibling-fresh-use` | `chat` | Fresh profile chat uses the surviving sibling; removed target has no later provider/model effect. |
| `root-final-readback` | `list` | Fresh root list still contains the seeded root grant and root digests match the post-seed values. |
| `root-fresh-use` | `chat` | Fresh root chat uses the root-owned grant after the profile operations. |

The only external controls are the fixed fake provider response, the existing fake clock, and OS isolation inside temporary homes. The fixture records the two target-bound fake 429s and single quota check with `AUTH_PROVIDER_RATE_LIMIT_OBSERVED`; any native sibling rotation remains visible through the model-request ledger, accepted synthetic generation, and `fallback_attempted`. No host auth store, installed credential, browser session, real account, or live provider is used.

## Receipt and generated contract

Keep each serialized child fixture result below 2000 characters. Emit only fixed argv and labels, exit and process identity, bounded enum markers, generation names, credential count/target presence, HTTP ledger counts, synthetic-store digests, and a fallback boolean. Do not emit raw stdout/stderr, response bodies, account identifiers, credential rows, or token bytes.

The parent integrates the canonical generated contract before source verification. The minimum expected additions to `HermesAuthFixtureResultV1` are operation enum values `remove` and `reset`; phase enum values `remove` and `reset`; and markers `AUTH_REMOVE_OK`, `AUTH_RESET_OK`, `AUTH_LIST_TARGET_RATE_LIMITED`, and `AUTH_PROVIDER_RATE_LIMIT_OBSERVED`. Existing `target_label_present`, `credential_count`, `fallback_attempted`, access-generation, and HTTP-ledger fields carry the remaining predicates, so no `target_status` field is needed. Preserve all existing result fields and old probe defaults.

## Boundaries

The worker-owned source is limited to this ADR, `packages/hermes/src/auth-fixture.ts`, `packages/hermes/src/auth-probe.ts`, `patches/hermes-auth-fixture.patch`, and the source handoff artifact. The parent owns `packages/contracts/src/hermes-runtime.ts`, `tests/registry.yaml`, fixture-stack/CLI/features integration, and generated artifacts. The parent may begin integration and the assigned CLI proof only after every source worker stops.

The owner hashes only synthetic files below the disposable Hermes home and never parses credential rows. Real host paths and inherited provider configuration stay unavailable. Child UID/GID is process evidence, not a protected service identity. This bounded fixture is not the whole AT91 or a release claim; `wholeATComplete` and `acceptanceComplete` remain false until the registered CLI probe and separate protected gates provide their required evidence.

The first native attempt exposed the pinned rate-limit recovery sequence: two target 429 responses (initial call and one retry) precede credential rotation. The exhausted Codex row then makes a quota early-reopen request. The fake handles only `GET https://chatgpt.com/backend-api/wham/usage` in the sealed target-rate-limit actor, after exactly two target responses, with the exact synthetic target authorization. Its fixed response reports a full primary window with a future reset, so the native predicate keeps the row exhausted. Other requests remain denied. The existing provider-observed marker now requires exactly two target 429s and one such quota check. Sibling rotation is recorded only if the accepted synthetic generation is the sibling and the model ledger has three requests. No receipt field, module, command or unrelated protocol is added; this refinement is required by the observed first CLI failure. The original one-response assumption is superseded for this fixed fault.

The second native attempt passed the provider fault and every profile lifecycle cell, then failed the exact model ledger on the final root chat: response and generation were correct, stores stayed unchanged, but two model requests were observed. The existing fixture disables auxiliary title generation through public configuration only in the profile and borrowed-root mode. Apply the same public `config set auxiliary.title_generation.enabled false` to the disposable root in lifecycle mode before seeding, retaining the one-model-request predicate. The pinned title generator otherwise defaults to enabled and starts a separate model-upgrade thread. This changes only temporary fixture configuration, not host settings or lifecycle expectations.
