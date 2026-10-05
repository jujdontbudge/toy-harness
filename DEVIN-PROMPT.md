# How to run (local Devin CLI on the server Mac)

```bash
cd ~/Documents/Codex/toy-harness
caffeinate -dimsu devin --prompt-file ~/Documents/Codex/personal-assistant-harness/DEVIN-PROMPT.md --permission-mode dangerous
```
- `caffeinate` keeps the Mac awake while Devin works. `dangerous` auto-approves every tool call; the prompt's safety rules are the guardrails. Use `--permission-mode smart` if you want Devin to ask before risky commands.
- If the session ends or the terminal closes: `cd ~/Documents/Codex/toy-harness && devin --continue`. Devin resumes from `build/state.json` and `build/progress.md`.

---

Build and deploy **all Toy, R0→R5**, autonomously on Johan’s MacBook Air M2, 8 GB, macOS 26.7.1. Verify the host before mutations. Planning/specs: `/Users/johansardar/Documents/Codex/personal-assistant-harness` (`JohanSardar/toy-planning`); implementation: `/Users/johansardar/Documents/Codex/toy-harness` (`JohanSardar/toy-harness`). Links resolve from the planning root. You assume the plan’s O/integration-owner role. Preserve checkouts/uncommitted work; never move execution to a cloud VM.

Johan’s intent: “my one and for all life personal assistant that manages absolutely everything from health, business, personal life, social life, reminders, calendar”; “assume I immediately forget everything you tell me after a few minutes”; “95% of the things done will be things I in no way asked for”. [REQUIREMENTS.md §0/A/B](REQUIREMENTS.md) and [memory/*.md](memory/) define every requirement and decision. Build around Hermes; carry remembering, perform useful work, follow through, and prove outcomes. Never ask planning, preference or routine permission questions.

Read in order: [AGENTS.md](AGENTS.md), [REQUIREMENTS](REQUIREMENTS.md), [MEMORY.md](MEMORY.md), every [memory file](memory/), [plan.json](plan.json), [PRINCIPLES](specs/PRINCIPLES.md), [README](specs/README.md), [CONTRACTS including Amendments](specs/CONTRACTS.md), [FIXES](specs/FIXES.md), [BUILD-PLAN](specs/BUILD-PLAN.md), [TEST-PLAN](specs/TEST-PLAN.md), [RESEARCH-REGISTER](specs/RESEARCH-REGISTER.md), [architecture-v3](design/architecture-v3-hermes.md), [self-improvement design](design/self-improvement-astra.md), then every module below. PRINCIPLES governs engineering; CONTRACTS governs canonical names. Apply its amendments, current gate decisions and nonconflicting FIXES; reconcile stale SQLite/v2, Plus, vendor and channel records explicitly. Research every component; compare proven options; document reliable choices. No hacks.

Implement every linked interface, invariant and behavior:

|Spec|Interface / obligations|
|---|---|
|[obligations](specs/obligations.md)|capture/due/resolve/defer/satisfy; atomic durable wakes/dependencies/recurrence/calendar intent.|
|[attention](specs/attention.md)|surface/ack/quiet/snapshot; escalation/bundling/sleep/DeadlinePlan; model-independent delivery.|
|[authority](specs/authority.md)|request/enqueue/status/receipts/undo; protected human proof, outbox, unknown-effect reconciliation.|
|[sources](specs/sources.md)|status/sync/changes, SourceAdapter/commitSourcePage; every connector’s policy/coverage/cursor/activation.|
|[lifestore](specs/lifestore.md)|search/timeline/get/facts/propose_fact/appendBatch; immutable provenance, corrections, bounded recall/policy.|
|[hermes-config](specs/hermes-config.md)|ModelRoute/plugin/hooks/skills/cron/delegation; independent auth, admission/cadence adapters.|
|[client-apps](specs/client-apps.md)|commands/cards/media/SecretSink/transport; shared web/iPhone state, steer/stop/offline/approvals.|
|[hands](specs/hands.md)|open/observe/act/handoff/resume/status/close; protected real-Chrome/desktop, generations/readbacks.|
|[self-improvement](specs/self-improvement.md)|TurnReview.review/get, Continuation.advance, SelfRepair.report/status; evidence/fencing/independent evaluator/publisher/rollback.|
|[adhd-features](specs/adhd-features.md)|planning/GoalWorkflowPort/dossiers; executable first steps, rescue, rituals, challenge/switch.|
|[activity-focus](specs/activity-focus.md)|activity/focus/mic/device streams; privacy/consent/freshness, drift, reversible overrides.|
|[ops](specs/ops.md)|health/admission/backup/restore/deploy; service isolation, resource limits, recovery.|
|[cli](specs/cli.md)|thin `toy`; generated commands/contracts, guarded probes, feature map/generators.|
|[workflows](specs/workflows.md)|existing-owner compositions; goals/school/business/writing/reading/errands/discovery/95% metric.|
|[user-sim-evals](specs/user-sim-evals.md)|sealed SIM run/suite/show; real Toy/Hermes/Sol, fake world, calibrated independent judges/pass^k.|

Follow **all P1–P10** in [PRINCIPLES](specs/PRINCIPLES.md): verification-based trust; one `toy` CLI; maintained feature map; deep modules/deletion test; largest reachable test interface (SIM→CLI→MOD→justified INT); pristine code/generators/no comments or TODOs; correction ladder; enforced boundaries/strict compilers/generated contracts; nightly gardener; event-driven outer loop. No private-function tests/internal mocks or one-off system-poking scripts. Extend the CLI. [CONTRACTS](specs/CONTRACTS.md) supplies the entire tables/owners/tools/services/ports/identities/configuration/pins/timings registry; generate inventories from it, with one writer per authoritative table and one gateway/scheduler/send lane/publisher.

Recheck [R0-facts](specs/gates/R0-facts.md), [R0-research](specs/gates/R0-research.md) and [LOGINS-READY](specs/gates/LOGINS-READY.md). Recorded ready: ChatGPT Pro; Claude overage OFF; private Toy Discord bot; Macs/iPhone on Tailscale; Apple Developer; Google `toy-assistant-510700` Gmail/Calendar OAuth setup; Homebrew/PostgreSQL 17.11; B2 `toy-backup-js77-q8f3`; iCloud Drive; Healthchecks; secure box **8787**. Reverify integrations. Use supported SIWC plan-usage Responses behind ModelRoute; Codex exec/app-server delegation. Models: `gpt-6.1-sol` max/Fast main; `gpt-6-luna` max/Fast children; Sol medium/Fast research with pinned mattpocock skill/receipts. Publish Google OAuth from Testing before live use. Backups: B2+iCloud restic, independent measured restores/capacity. Canvas ICS first; UIUC forwarding partial; Graph/full Canvas institutional approval deferred. Health Shortcuts→HealthKit; Oura/custom Rust/wake word deferred; WHOOP retention/AI permission required. Grafana/Composio/Bitwarden stay dropped; build locally with libraries.

Preserve running **`ai.hermes.gateway`**, Toy profile, old **`net.johansardar.assistant.core`**, Chrome profile/sessions, Apple ID, accounts/files/configuration/credentials. No destructive operations, logout, reset, formatting or unrequested OS upgrades. Back up before migrations; rehearse with temporary stores/fake providers. Only specified gated reversible cutovers; retain originals/rollback, prevent competing owners, keep 8787 until its replacement passes. Rollback preserves new data; restore fences executors and reconciles unknown effects before replay. Retain permitted data forever, encrypted nightly backups; enforce policy-bound purges. Never pay extra, buy credits or use paid model API keys/fallbacks; enforce zero-credit controls before inference. Nonmodel connector credentials go **8787 secure box→protected broker→Keychain**, never code/logs/chat/model context/screenshots/clipboard capture; escrow follows Ops.

Enforce [Authority](specs/authority.md) across API/browser/GUI: personal contacts require scoped permission, including calendar notifications; purchases/posts require protected approval; school follows course policy; iMessage stays read-only; self-improvement cannot loosen controls. Silence never completes work; sleep alone suppresses nudges. Full Sol/max/Fast AI review every **180s**, even unchanged/asleep, plus 60s reconciliation; reduced modes remain unaccepted experiments. Ops’ 60% five-hour/70% weekly reserves, one send lane, foreground priority and 8 GB admission apply; deferrals stay visible.

Only request the minimal, batched human interactions already listed in [LOGINS-READY](specs/gates/LOGINS-READY.md), [R0 gates](specs/gates/R0-research.md), [BUILD-PLAN’s Johan column](specs/BUILD-PLAN.md), and [JOHAN-STEPS](specs/JOHAN-STEPS.md), filtered by newer decisions: required identity/MFA/CAPTCHA/admin/FileVault/TCC/passkey/device/signing/notification actions; protected B2/Healthchecks/Canvas secret pastes; UIUC forwarding/institutional or source-policy consent; exact action approvals. Earlier approval assigned to Claude is not automatically Devin’s consent authority. Start flows and prepare concrete one-click/paste steps yourself; no expired codes or denial bypass. No new preference/spending questions: defer unsupported branches. Pause only dependent work; continue independent authorized cards.

Execute the [master dependency graph and per-card done criteria](specs/BUILD-PLAN.md), including its CLI integration lanes. Below are short exit labels and exact AT lists; labels never replace the source criteria. Expand inclusive ranges: `H:39–40` means `AT-hermes-config-39, AT-hermes-config-40`. Prefixes: H=hermes-config, O=ops, S=self-improvement, R=RESEARCH-REGISTER, B=hands, W=workflows, A=authority, N=attention, L=lifestore, F=activity-focus, C=client-apps, D=obligations, E=adhd-features, X=sources, T=cli, U=user-sim. `ALL0…k` means exact cumulative [TEST-PLAN indexed sets](specs/TEST-PLAN.md#acceptance-index-generated-from-the-specs), including U; never wildcard matching.

|Card|Done-label|AT IDs|
|---|---|---|
|R0.K1|Strict public boundaries|H:101|
|R0.K2|Lint/generated contracts|H:101|
|R0.K3|Guarded CLI stack|H:100;T:1–6,9–10|
|R0.K4a|Four verified references|Public-CLI receipts; no assigned AT|
|R0.K4|Generators/map/static gates|H:101;T:7–8,25–27|
|R0.01|Supported inference proof|H:1,39–40,76–78;O:46,55;S:57–58|
|R0.02|Inventory/research closure|R:1–4;O:43–45;B:62–63;W:1–2,10–11|
|R0.03|Independent auth probes|H:34–36,84–91;O:14|
|R0.04|Protected identities/manifest|A:34–37,44,69,73;O:30,70;B:60;L:41|
|R0.05|Actual-identity denial matrix|H:19,29,53,79–80,82–83;A:35,37,69,73;N:67;S:78|
|R0.06|No-spend admission enforcement|O:9–13,49–52,55;H:59|
|R0.07|Start 168h trial|O:47;S:59–60;R:6|
|R0.08|Signing/licence inventory|F:61–64;C:45–46,49;O:81|
|R0.09|Backup capacity/recovery|O:62;L:63;X:216|
|R0.10|Pinned schema/ownership probes|D:74–76;H:50,69,75,81;A:60–61;F:86|
|R0.11|Early trial audit|O:47,49–52;S:59;H:37|
|R0.12|Research gate closure|N:66;L:45,47,70;X:188,190,208;E:66–67,106;S:54,56|
|R0.13|Peak/final trial audit|O:47;S:59–60;E:95|
|R0.14|Feasibility verdicts|ALL0|
|R1.K1|Attested skills/gardener|H:102–104;S:100|
|R1.01|Complete canonical inventory|R:12,20,23;H:48–49;O:76;D:77|
|R1.02|Stores/roles/ingestion ports|D:2,52–53;A:49–50,71;L:1–3,29,48|
|R1.03|Protected secrets broker|O:15–18,32,74;A:58,75;C:20–21,48|
|R1.04|Observation-backed durable capture|D:1–7,63;E:1–2;W:61|
|R1.05|Atomic mutation ports|D:10–12,21–23,69–70,72–73;N:69|
|R1.06|Fenced wakes/reconciliation|D:8–9,25,46,48–49,51–53;O:3,6–7|
|R1.07|Dependencies/early replies|D:13–20,61–62;S:6–8|
|R1.08|Recurrence/DST recovery|D:26–37,67|
|R1.09|Policy/fake outbox|A:9–10,25–29,31,33,40–42|
|R1.10|Protected passkey approvals|A:59;C:17–18,48,77;O:73;R:7|
|R1.11|Calendar intent/readback/undo|D:38–45,68;A:15,18–20,50,76;X:199,201|
|R1.12|Escalation/DeadlinePlan policy|N:1–12,74|
|R1.13|Ack/rescue distinctions|N:13–20,22;D:65–66,69,72|
|R1.14|Sleep latch/relay|N:23–32,43,89,92;F:77;O:83,85|
|R1.15|Independent protected delivery|N:33–37,40–42,71,79,91;A:53,62;O:71;F:74|
|R1.16|Durable run admission|S:18–22,61–62,79–80;H:12,15,92–97|
|R1.17|Full 180s reviews|S:47,63–64,66–67;O:48,53–54,75;H:9–11,65–66;F:55–56|
|R1.18|Shadow review/incidents|S:2–5,10–11,13–14,34–35,52,70,85,97–98;H:13,20,47,74|
|R1.19|Transactional Sources/Life ingestion|L:1–3,48;X:141–148,203–204,212;W:61|
|R1.20|Gmail fake lifecycle|X:1–3,149–155,179,200,206;H:2,4,44|
|R1.21|Canvas/calendar fake coverage|X:10–12,16–18,180–181,189,199;E:54–56;H:3,45|
|R1.22|Research/dossier/next wake|W:7–9,12–15,17,19,29,33–34,42,46,49,51,61–62;E:19–20,40,42–45,68–71,73–74,76,109;R:18;H:71,98–99;L:58;C:81–82|
|R1.23|Durable queue/steer/stop|C:1–5,7–12,51–56,62–63;N:80–82|
|R1.24|Cards/Today/protected links|C:13–16,24,30,34,36,47,58–59,69;N:68,70,83|
|R1.25|Media integrity/policy|C:25–28,57,60–61,64;R:13;H:62–64|
|R1.26|Pinned supervised runtime|O:1–2,5,8,39–40,76;N:44–49;E:89–92|
|R1.27|Complete chaos slice|R:5,9,16;E:64,83–84;D:1,13,47,53,69;N:69,71–73;C:43,65,76;W:61–62|
|R1.28|Sealed independent backups|O:19–26,56–61,63–64;E:65|
|R1.29|Publisher/compatible rollback|O:27–28,42,80,84;H:74;R:23|
|R1.30|Isolated restore/reconciliation|O:66–68;A:45,54–57;H:55;S:53,73–75|
|R1.31|SQLite migration rehearsal|D:54–60;O:31;X:187|
|R1.32|Start 72h soak|O:77;N:88,90;S:87–88,90|
|R1.33|Soak/outage checkpoint|O:4,7–8,53–54,71,75,77;C:65|
|R1.34|Complete 72h soak|O:77;N:72,90;R1.ALL(fake/contract/replay)|
|R1.35|Exclusive reversible cutover|D:54–59;O:31,71,84;H:54,65|
|R1.36|Physical availability proof|O:18,35,37–38,40,72;N:71–72|
|R1.37|Live read/mirror canaries|X:165–178,199–200;A:15,18–19,76|
|R1.38|Cumulative R1 signoff|ALL0…1|
|R2.01|One reconciled action|W:24–25,28,39,52;A:1–8,12,30,63;O:65,69,73|
|R2.02|Live fenced Continuation|S:1,9,12,15–17,23–31,76,81–84,92–94;D:24,71,96;C:6,19,37,39,66|
|R2.03|Full policy-safe recall|L:4–11,13–15,17–18,24,26–27,37,39,42,49–52,55–59,62,65–68,72;R:15|
|R2.04|Individual connector activation|X:4–9,13–15,19–30,34–35,191–195,205,207,209–211,214–215,217,219;F:76;R:14|
|R2.05|Protected Chrome/desktop proof|B:1–15,21–31,48–59,64–70,72,80–82;A:48,77|
|R2.06|Protected Pro administration|F:51–54,78;O:36|
|R2.07|Authorized workflow outcomes|W:3–6,16,18,20–23,26–27,30–32,35–38,40–41,43–45,47–48,53,57–60,63;A:21–24,64–68,78–79;B:73–75,83–86;E:76,96–103,105|
|R2.08|Cumulative R2 signoff|L:30,43,46,53–54,60,69;N:84–85;ALL0…2|
|R3.01|Native prerequisite proof|C:22–23;A:74;H:61;R:8;F:83|
|R3.02|Complete web parity|C:22–23,41–42;W:56;L:73;E:72;B:77|
|R3.03|Signed native integration|C:29,31–32,35,42,73–74;A:11,43;X:31–33,213|
|R3.04|Push/DeadlinePlan/offline safety|N:21,38–39,50–63,75–78;C:33,50;O:82;A:72;R:21|
|R3.05|Cross-device soak/signoff|C:44;N:64–65;E:107;ALL0…3|
|R4.01|Signed Recorder/stream ingestion|F:12–18,65–71;L:74;E:108|
|R4.02|Private metadata/text pilot|F:1–11,60,81;B:78|
|R4.03|Consented voice/mic-off|F:19–27,75;R:11|
|R4.04|Drift/reversible Mac blocking|F:28–41,79–80,82,85;A:52;N:86;E:26–33,62,77,87;W:54|
|R4.05|Entitled iPhone shields|F:42–50,72–73;E:34–38|
|R4.06|Broad admitted connectors|X:40–42,49–51,55–140,159,183–184,196–198|
|R4.07|Physical pilot/soak/signoff|F:57–58,60,70–71;O:33;D:103;ALL0…4|
|R5.01|Signed launcher denials|S:49–50,65,68–69,71–72,96;O:34,78–79,86;A:39,70;B:61;F:84|
|R5.02|Independent candidate replay|S:33,36–42,46,51,99,101;H:18;B:47;R:22|
|R5.03|Attested publication/rollback|S:43–45,77,86,95;O:29;A:38;H:38,68;D:99;B:79|
|R5.04|Optional measured memory-pilot|L:31–33,71|
|R5.05|Behavioral promotion/signoff|S:95;N:87;E:63,104;F:59;W:55;ALL0…5|

CLI cards are integrated at the [master delivery points](specs/BUILD-PLAN.md#source-build-step-coverage-and-integration-lanes); full [CLI card criteria](specs/cli.md#11-build-steps-r0r5):

|Card|Done-label|AT IDs|
|---|---|---|
|CLI-01|ESM/schema envelope|T:1–2,9|
|CLI-02|Confined stack/probes|T:4–6,10|
|CLI-03|Truthful status/doctor|T:3,9–10|
|CLI-04|Skill/map inventory|T:7–8,27|
|CLI-05|Durable domain commands|T:11–14,19,22,24|
|CLI-06|Owner evidence adapters|T:15–24|
|CLI-07a|Verified generator templates|H:101;T:25–27(pending-R1)|
|CLI-07b|Integrated generator/gardener acceptance|T:25–27;H:102–103|
|CLI-08|Sealed SIM wrapper|T:28;ALL0…1|
|CLI-09|Expanded R2 adapters|T:29–32|
|CLI-10|Client parity evidence|T:33|
|CLI-11|Activity capability evidence|T:34|
|CLI-12|Publisher/rollback evidence|T:1–38|

K1/K2’s H:101 closes at K4; K4’s T:25–27 closes in R1. R5.02 includes S:99,101 from the master’s final done requirements. K4a uses its four reference receipts, with future SIM tracked pending.

Acceptance complete requires **whole assertions**, prescribed rungs, exact tested digests, independent receipts/readbacks and valid `skills/toy-control/FEATURE-MAP.md` entries. Compiled implementation availability can unblock same-release integration; pending acceptance cannot pass release gates. Run cumulative suites; keep BLOCKED/DEFERRED_CAPABILITY/NOT_IMPLEMENTED visible. Regenerate the index rather than trust historical totals. Real UID/device/account/signing/elapsed evidence cannot be faked or time-compressed: R0 168h; R1 72h; R2 API48h/Hands72h/Life7d; R3 7d; R4 Pro pilot/7d/≥72h; R5 ≥7d AND ≥100 terminal units plus held-out thresholds. Do not start dependent releases during waits.

Inspect state, research missing gates, save bounded dependency-ordered work; implement→`toy`/SIM verification→repair→checkpoint→continue. Probes: `toy --env test --stack <UUID> probe run <AT-ID> --request-id <UUID> --json`. Maintain implementation-root **`build/state.json`**, **`build/progress.md`**, **`build/evidence/`**: requirements/cards/AT verdicts, hashes, commands/results, redacted evidence, blockers/human steps, budgets, trial deadlines, session/workflow IDs and exact next action. Checkpoint per card, hourly and before sleep/compaction/handoff; give concise updates.

Commit tested coherent changes per card; open/update a draft implementation PR per bounded package, attach evidence, mark ready after its complete gate. Never force-push/overwrite work or submit placeholders as completion. Deploy authorized reversible releases only through protected gates. Apply P7 corrections in order: architecture/types/constraints→static checks→guidance→human style; recurring mistakes cannot close on memory alone.

After three unchanged failed attempts, diagnose, re-plan or resume that package in a fresh session using saved state; record an exact blocker and continue independent work. Use existing account/session/package/aggregate limits; never increase spending or consume shared credits. Track actual sends/usage/resources. Run locally in one Devin CLI session, with no cloud sessions, child sessions or outposts. Work sequentially. Before any session might end (context limits, quota, a long trial wait), checkpoint so that `devin --continue` resumes exactly; at the start of every session, reload `build/state.json` and `build/progress.md` first. For multi-day waits (168h/72h trials), schedule the trial's own launchd jobs on the Mac, record the deadline, and continue independent cards. Keep one coordinator lock file in `build/`.

At quota or an unresolvable authority/tool blocker, checkpoint, safely wait/schedule within existing limits and report the precise dependency; never weaken gates. Disable continuation on completion or aggregate-budget exhaustion. Finish only when every required capability is implemented, tested and authorized deployment verified, with runbooks/rollback/recovery evidence. Report built, tested, deployed and blocked/deferred separately; deferred scope remains open. Start now.
