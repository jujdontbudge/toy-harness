# ADR 0045: mixed copied-root and independent-profile auth probe

Status: interface accepted before implementation, 2026-10-07. The bounded AT-hermes-config-89 native CLI unit is verified and stopped; evidence is `build/evidence/R0.03/mixed89-first-verification.json`. Protected identity and whole acceptance remain pending.

## Decision

Extend the existing `HermesAuthProbe.run` owner and `runHermesAuthFixture` with one closed `mixed-lineage` fixture mode. Continue to use the pinned public Hermes CLI, the external fake OAuth/model HTTP endpoints, the child-local fake clock, and the existing `HermesAuthFixtureResultV1` receipt. Do not add a module, route, protocol, endpoint, runtime, DTO, or provider.

The fixture creates one synthetic Codex grant in the temporary root through public `hermes auth add`. After creating temporary profile `toy`, an OS fixture control copies that synthetic root `auth.json` byte-for-byte to the profile store. The control is restricted to the fixture's verified temporary Hermes home. A fresh public profile `auth list` triggers the pinned `load_pool()` lineage healer; the receipt binds equal pre-read copy digests, public list count/label, a changed profile-store digest, and an unchanged root digest. No row or token bytes are parsed or emitted.

Fresh profile chat processes then use, expire/refresh, and reload the healed root lineage through the root fallback. The root generation must advance from `initial` to `rotated`; only the root auth digest may change during that refresh, and the profile store remains at its healed digest. After the root reload, public profile auth-add creates a distinct synthetic manual grant with the fixed independent label. Public list must show exactly that one profile row. Fresh profile chat processes use, expire/refresh, and reload the independent `added` to `added-rotated` generation while the root auth and environment digests stay unchanged.

The ordered mandatory phases are `root-add`, `copied-lineage-heal`, `copied-lineage-use`, `copied-lineage-refresh`, `copied-lineage-reload`, `independent-manual-add`, `independent-profile-readback`, `independent-profile-use`, `independent-profile-refresh`, and `independent-profile-reload`. Each phase is a `HermesAuthProbe.run` case. Register OS control `mixed-root-auth-store-copy` on `copied-lineage-heal`.

## Boundaries

Only public `auth add`, `auth list`, and fresh `chat` processes exercise credentials. The fake returns distinct fixed root and independent generations; each process receives an exact actor, scope, and argv. Receipts contain only fixed labels, generation names, HTTP counts, sanitized markers, process identity, and SHA-256 store digests. Never inspect a real home, invoke private auth functions, or expose credential bytes. Never copy from outside the temporary Hermes home.

The existing V1 receipt records public argv, process identity, provider generation, model-catalog generation, HTTP ledger, denial/socket state, and token hygiene. Existing `CheckViewV1` evidence carries copy and before/after store digests. The owner requires a clean public readback, exact refresh generation, expected owner-only digest change, and no network denial for each relevant phase.

Public chat may update metadata in its active owner's store. For copied-root use/reload, preserve the healed profile store and record any root digest delta without treating it as a lineage failure. For independent profile use/reload, preserve the root store and record any profile digest delta. The copied-lineage refresh still requires the root generation to advance while the healed profile stays stable; independent add and refresh still require the root to stay stable.

UID/GID values describe fixture children only; they do not identify a Hermes service role. This CLI subset does not establish protected-controller, native-service, real-account, production-containment, or whole-acceptance proof. Keep `wholeATComplete` false and preserve the AT-hermes-config-84 through AT-hermes-config-88 behavior and defaults.
