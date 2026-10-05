# ADR 0017: bounded R0 kitchen work

Status: binding execution policy applied 2026-10-05, per Johan's direct instruction.

K3, K4a, K4 and remaining R0 kitchen cards implement the simplest behavior needed by their assigned ATs at the assigned rung. Stop a card after that proof. Each kitchen card receives approximately two hours; record deferred work and proceed to the next available card. R0.01, the supported Sign in with ChatGPT provider, is the critical next destination after kitchen dependencies.

Research and infrastructure are added only when an actual assigned check fails without them. Kernel/ABI research, expanded native protocols, extra owner-event machinery and speculative enforcement infrastructure are deferred. Actual identity and launcher prerequisites remain explicit pending acceptance, as BUILD-PLAN's K3 row requires; pending proof is never presented as a pass.

Swift contract generation and compilation resume at R3. The sole generator currently emits TypeScript, Python and JSON schemas. `contracts:check` compiles TypeScript; `python:check` verifies Python. The existing Swift artifact and native sources are preserved as historical preparation, with no Swift generator or compiler in the current kitchen checks. The explicit `native:build` command is retained for R3 and is not run during R0 kitchen work. Native build receipts bound to previous schema digests are historical, not current runtime proof.

Deferred to R3: restore Swift emission from git history into the sole generator; regenerate and typecheck native contracts; rebuild the required native closure; implement additional native ownership/deadline protocol only where its assigned checks require it. Deferred to their assigned cards: actual service identities, signed-launcher execution, confinement and complete descendant cleanup. No running production service, account, profile or data is modified by this policy.
