# Pinned Hermes profile-auth persistence

R0.03 uses the native Hermes public auth and chat interfaces. The planning spec's Hermes §11.2 patch targets the installed revision `8d5e3e412138342e8bf30443e72bd4e6a9abd057` without changing its root update-only merge or replacing its auth subsystem.

The staged patch makes a fresh single-use-refresh login claim the active profile using only active-store rows. It requires the new credential ID to be read from that store before returning success. On an uncertain save it restores in-memory state and raises; it does not repeat OAuth. The lineage change preserves a new independent `manual:*` PKCE row while retaining the earlier proven-root-counterpart branch.

The written interface is unchanged: `hermes --profile toy auth add <provider> --type oauth`, then a fresh `hermes --profile toy chat -q <fixture-prompt>` process. Acceptance runs through the registered `toy probe run/show` adapter with sealed temporary scopes, external OAuth/model/OS fakes and independent provider/root-digest readbacks. Private credential functions are implementation details and are never test entry points.

`patches/hermes-profile-auth.patch` is source preparation. Python parsing and a read-only patch applicability check do not prove persistence, refresh, concurrency, crash recovery, dashboard behavior or containment. The installed source, profile and services remain unchanged. A separate patches/hermes-auth-dashboard.patch now prepares sanitized credential-pool and OAuth start/poll failure responses at the same pin. AuthError/OSError failures use HTTP 400 and fixed messages; affected exception logs contain only class names. Profile validation and cancellation scopes remain intact. Python parsing and patch applicability checks are preparation only; real public scoped OAuth save-fault/fresh-process cases remain pending. No assigned AT is passed by this preparation.

No new protocol, module, runtime, dependency or Swift artifact is introduced. The patch is kept separate from the SIWC provider patch so the two bounded changes retain independent evidence.
