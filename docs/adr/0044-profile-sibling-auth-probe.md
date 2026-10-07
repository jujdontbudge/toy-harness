# ADR 0044: native profile-sibling auth probe

Status: interface written before implementation, 2026-10-06; bounded native CLI unit verified and stopped. Evidence: `build/evidence/R0.03/siblings86-final-verification.json`. Protected identity and whole acceptance remain pending.

## Decision

The existing `HermesAuthProbe.run` owner will reach AT-hermes-config-86 through the unfiltered `toy probe run` route once the parent integrates its CLI manifest and registry entries. The owner will use the pinned Hermes public CLI in the existing disposable root/profile fixture and keep the canonical `HermesAuthFixtureResultV1` result shape. No new module, runtime, external service, command protocol, schema, or DTO is introduced.

The fixture creates two distinct root grants through public `hermes auth add` commands, then creates profile `toy` and creates two distinct profile sibling grants plus one new independent grant through public auth-add. Each grant gets a fixed distinct label and a distinct synthetic provider identity. The test never seeds or edits credential rows directly. The root seed and profile grants are all synthetic and confined to the test stack's temporary homes.

Public profile configuration selects `model.provider=openai-codex` before grant creation. The pinned public chat startup checks configured providers before resolving pooled rows, so this explicit public setting allows the later fresh processes to reach their synthetic profile grants.

A fresh public `hermes auth list` process confirms the root row count and each root label, then confirms the profile row count and each of its three labels after the new grant is added. A fresh public `hermes auth priority openai-codex <label> 0` command selects each profile grant in turn. A separate fresh, tools-disabled `hermes --profile toy chat` process for each selection must reach the external fake model with that label's unique provider generation. Provider request ledgers and sanitized command receipts are independent per child. The root auth and environment digests captured after root seeding must remain identical throughout all profile add, list, priority, and chat operations.

## Boundaries

Only public `auth add`, `auth list`, `auth priority`, and fresh `chat` commands exercise credentials. External fakes are limited to OAuth, model, clock, and OS seams. Results expose fixed labels, row counts, nonsecret generation names, sanitized markers, exits, process identity, and digests; they never export token bytes or raw credential rows. UID/GID identifies the fixture child under the current runner, not a native service identity.

The current `HermesAuthFixtureResultV1` fields are sufficient: `public_argv`, `observations.credential_count`, `observations.target_label_present`, `observations.access_generation`, the HTTP ledger, and existing sanitized result markers provide the required independent public/provider observations. The probe hashes only the exact synthetic root/profile stores for preservation; it does not inspect host or installed credential stores.

AT-hermes-config-86 remains CLI-rung work. Passing the owner checks will not prove the protected controller, native service containment, or the whole AT. AT-hermes-config-84, AT-hermes-config-85, AT-hermes-config-87, and AT-hermes-config-88 behavior and defaults remain unchanged.
