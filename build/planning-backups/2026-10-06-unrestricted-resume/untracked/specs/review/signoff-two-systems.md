The intent is largely faithful, but I would not sign off yet. I verified Hermes at `8d5e3e412138342e8bf30443e72bd4e6a9abd057` and inspected the toy `state.db` schema read-only. The UID, tool-linkage, reasoning and compaction fields exist; an isolated fork is feasible with additional runtime work. Native resume does not itself provide the specified replay semantics.

1. **[P1] Exact replay needs a generation-resume contract.**  
   [Self-Improvement §12.3](/Users/johansardar/Documents/Codex/personal-assistant-harness/specs/self-improvement.md:726) prescribes `--resume` plus a generic resume trigger. Hermes [unconditionally appends a user message](/Users/johansardar/.hermes/hermes-agent/agent/turn_context.py:1091), changing the decision context. It also [restores the stored system prompt and pinned tools](/Users/johansardar/.hermes/hermes-agent/agent/conversation_loop.py:768) when runtime identity matches; otherwise it rebuilds context. Neither behavior explicitly guarantees historical task context under the new harness.

   **Fix:** specify a narrow generation re-entry adapter that adds no synthetic user turn. Seal each relevant model-call boundary, including `api_content`, effective prompt, tools and compaction state. Define which historical context survives and which behavior sections are rebuilt from the candidate. Extend AT-113/114 with tool-result-ending prefixes, mid-turn compaction and a SOUL-only repair whose new instructions demonstrably reach inference. Also verify adoption in an existing production session after publication.

2. **[P1] Fresh reads can leak the complaint back into the replay.**  
   [§12.4](/Users/johansardar/Documents/Codex/personal-assistant-harness/specs/self-improvement.md:732) permits fresh memory/Life Store/account/file reads, while §12.1 forbids the later complaint and conversation tail. Those stores can already contain the complaint, correction summaries or later answers. Prefix exclusion alone cannot enforce the separation.

   **Fix:** give the protected read broker an incident-specific exclusion manifest covering later conversation, complaint records, their derivatives and evaluator artifacts. Apply it to search results, snippets and full reads; block when eligibility cannot be established. Preserve access to the candidate’s intended changed instructions. Add a SIM case where lookup would otherwise retrieve the complaint and expected answer.

3. **[P1] Automatic repair scope includes trusted review-packet preparation.**  
   The [malleability map](/Users/johansardar/Documents/Codex/personal-assistant-harness/specs/self-improvement.md:1124) permits candidate changes to review-packet preparation. A candidate could omit the unfinished request or contrary evidence while leaving the protected judge untouched. This conflicts with P8 and the [Ops rule excluding candidate-controlled dependencies from trusted services](/Users/johansardar/Documents/Codex/personal-assistant-harness/specs/ops.md:268).

   **Fix:** protect authoritative packet assembly, source selection, Authority summaries and deterministic-check collection. Candidate-generated summaries may be advisory inputs only. Extend AT-112 with a candidate that removes contrary evidence or fabricates lookup completion; trusted reconstruction must reject it. Protect the entire Authority/control executable dependency closure, not just policy files.

4. **[P1] Quota rules can withhold an otherwise completed foreground answer.**  
   [System 1 holds delivery when its judge is unavailable](/Users/johansardar/Documents/Codex/personal-assistant-harness/specs/self-improvement.md:470), but [SIM’s shared admission rule](/Users/johansardar/Documents/Codex/personal-assistant-harness/specs/user-sim-evals.md:461) vetoes production judges at the autonomous thresholds. Johan’s foreground call can therefore finish while its mandatory judge cannot run.

   **Fix:** make the required stop judge inherit the originating foreground request’s admission class and reserve its bounded cost with that request. Keep one provider lane, actual provider limits and no paid fallback. Background reviews retain autonomous thresholds. Add SIM coverage at both quota thresholds: foreground completion is reviewed and delivered; autonomous work remains deferred.

5. **[P1] The R2 replay worker contradicts its owning sandbox contract.**  
   [Ops §5.1](/Users/johansardar/Documents/Codex/personal-assistant-harness/specs/ops.md:375) still specifies an R5 worker, model/fake-tool pipe operations and no access to control stores. The new [replay layout](/Users/johansardar/Documents/Codex/personal-assistant-harness/specs/self-improvement.md:702) places the runnable Hermes home under `control/experiments`, while requiring fresh real-data brokering. The documented launcher probe also aborted before proving confinement.

   **Fix:** update Ops’ actual executable/RPC contract for R2. Keep sealed records and archived results under evaluator control; stage the runnable home inside the disposable sandbox container through private pipes. Define typed, policy-checked read operations and simulated effects. Move initial AT-ops-86 acceptance to R2, sharing evidence with AT-96; R5 adds extended campaigns. Preserve fail-closed admission until the actual-UID positive and denial matrix passes.

6. **[P1] R1 acceptance still contains contradictory requirements.**  
   [AT-hermes-config-12](/Users/johansardar/Documents/Codex/personal-assistant-harness/specs/hermes-config.md:3342) explicitly prohibits R1 continuation. [TEST-PLAN’s boundary table](/Users/johansardar/Documents/Codex/personal-assistant-harness/specs/TEST-PLAN.md:116) repeats that prohibition. Meanwhile [AT-self-improvement-35](/Users/johansardar/Documents/Codex/personal-assistant-harness/specs/self-improvement.md:1216) and AT-110 require replaying ambiguous fork points in R1, although the replay implementation is assigned to R2.

   **Fix:** replace the shadow assertions with active R1 behavior. Split ambiguity coverage: R1 durably captures both candidate UIDs and preserves the disposition; R2 replays both before requesting clarification. Regenerate release membership from corrected assertions. A precedence paragraph does not make contradictory executable assertions pass.

7. **[P2] The canonical CLI contract was not migrated.**  
   [Self-Improvement §3.3](/Users/johansardar/Documents/Codex/personal-assistant-harness/specs/self-improvement.md:126) adds `replay fork/run/show/list`, but [cli.md](/Users/johansardar/Documents/Codex/personal-assistant-harness/specs/cli.md:382) still calls `ReplayEnvironment.reproduce`, requires fixture-based inputs and retains R5 candidate gating.

   **Fix:** update the command tree, generated request/result schemas, authorization classes, operation receipts, CLI build cards and feature-map requirements together. Keep synthetic reproduction explicitly supplementary. Add CLI coverage for policy-eligible recorded forks, rejected source access, idempotent retries and prohibited production effects.

The no-spending rule, protected Authority intent, three-continue guard, independent 3/3 gate, permanent regressions and recurrence rollback are present. The blockers concern enforcement and integration. No files were changed, and no runtime acceptance tests were executed.

NO SIGN-OFF: replay semantics and isolation gaps, foreground judge admission, contradictory R1/R2 tests, and unmigrated CLI contracts.