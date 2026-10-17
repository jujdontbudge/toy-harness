# Running Devin reliably for weeks

**Research date: October 4, 2026. Scope: read-only.** I inspected the installed CLI, existing hook and runner, kickoff prompt, prior research, and binding Toy instructions. No files, sessions, services, or configuration were changed.

**Recommendation:** retain Devin CLI on the Mac, but make the outer supervisor responsible for completing the project. Run **one bounded card attempt per fresh Devin session**, persist progress in the repository, verify results independently, and dispatch the next eligible card automatically. Use the Stop hook to prevent an incomplete **iteration** from ending prematurely—not to hold one conversation open until R5.

This recommendation follows Cognition’s advice to divide complex work into separately verifiable sessions. Anthropic’s experiments also support incremental work, durable handoffs, and independent evaluation. None of the reviewed sources establishes that an arbitrary multi-week project reliably completes inside one uninterrupted conversation. [Cognition’s instructions guide](https://docs.devin.ai/essential-guidelines/instructing-devin-effectively), [Anthropic’s harness research](https://www.anthropic.com/engineering/harness-design-long-running-apps)

## 1. What your current setup does

The installed executable reports:

```text
devin 3000.11.3 (9c803229faa4)
```

I inspected these files:

- [Stop-hook configuration](/Users/johansardar/Documents/Codex/toy-harness/.devin/hooks.v1.json)
- [Stop-hook script](/Users/johansardar/Documents/Codex/toy-harness/.devin/hooks/keep-going.sh)
- [Outer runner](/Users/johansardar/Documents/Codex/toy-harness/run-forever.sh)
- [Kickoff prompt](/Users/johansardar/Documents/Codex/toy-harness/START-PROMPT.txt)
- [Build instructions](/Users/johansardar/Documents/Codex/toy-harness/DEVIN-PROMPT.md)
- [Prior research](/Users/johansardar/Documents/Codex/personal-assistant-harness/research/v3/devin-prompting.md)

The current design has useful foundations: durable state paths, an outer restart loop, pause deadlines, a three-attempt recovery instruction, and evidence requirements.

Its weaknesses are concrete:

| Finding | Consequence |
|---|---|
| Every subsequent launch uses `--continue`. | Process restarts preserve the same conversation; they do not give the builder fresh context. |
| `--continue` selects the latest conversation in the directory. | Another Devin session can become the unintended continuation target. |
| The hook and runner trust the existence of `build/DONE`. | The builder can satisfy the stop condition by writing the marker, without an independent verifier accepting the project. |
| The hook discards its input. | It ignores `stop_hook_active`, session identity, and turn identity. |
| The hook allows any future numeric `build/PAUSE`. | It does not establish that every remaining card is legitimately blocked. |
| No persisted iteration limit, watchdog, or error classification exists. | Repeated authentication failures, quota errors, and ineffective attempts can be relaunched indefinitely. |
| `caffeinate` wraps each Devin process. | It does not cover the runner’s intervening sleeps and pause waits. |
| No explicit model is selected by the runner. | Fresh launches depend on account/user defaults rather than an auditable build-model selection. |
| `DEVIN-PROMPT.md` explicitly requires one local session. | Fresh-session operation requires an explicit amendment to that instruction. |
| The kickoff says each card must be fully done before moving on. | That oversimplifies the build plan’s separate implementation-available and acceptance-complete states. |

At inspection time, `toy-harness/build/` did not exist. The configured continuation machinery therefore exists, but I found no local build-state evidence establishing that it has completed an iteration.

The binding [BUILD-PLAN](/Users/johansardar/Documents/Codex/personal-assistant-harness/specs/BUILD-PLAN.md) is especially important: some dependencies consume an available implementation while integrated acceptance remains pending. R0 also contains a **168-hour measured trial**. A runner must recognize both conditions without inventing PASS results or spending a week repeatedly asking the model whether time has elapsed.

## 2. Devin’s official persistence mechanisms

### 2.1 Local CLI execution and continuation

These commands are supported by the installed binary’s help:

```sh
devin -p "Implement the assigned card"
devin -p --prompt-file ITERATION-PROMPT.txt
devin --continue -p "Continue the current card"
devin --resume SESSION_ID -p "Recover the interrupted card"
devin --export build/session.json -p --prompt-file ITERATION-PROMPT.txt
devin list --format json
```

`-p` runs noninteractively and exits after processing the prompt. `--continue` resumes the latest session in the current directory; `--resume` targets a specific session. `--export` exports after turns. **A successful process exit means the invocation ended, not that the project passed acceptance.** [CLI command reference](https://docs.devin.ai/cli/reference/commands)

For automation:

- Start fresh by omitting both continuation flags.
- Resume by recorded ID when recovering a particular interrupted attempt.
- Use the prompt-file flag instead of embedding a large prompt through shell substitution.
- Establish workspace trust before unattended execution; print mode cannot display its trust dialog.

There is no verified project-completion guarantee attached to print mode.

### 2.2 `/loop`: implementation followed by repeated review

Interactive syntax:

```text
/loop Implement card R0.K1 and resolve findings against its acceptance contract
```

Cognition documents `/loop` as running a prompt and automatically reviewing the resulting diff. It requires a clean Git state initially. [Essential commands](https://docs.devin.ai/cli/essential-commands)

The installed version includes an important change: since `3000.11.1`, each review runs in a **fresh read-only subagent**, while the working agent retains its conversation and session history. Thus `/loop` supplies fresh review context, not fresh builder context. [Stable changelog](https://docs.devin.ai/cli/changelog/stable)

**Fit:** a bounded implementation/review cycle.

**Limit:** it does not provide the dependency scheduler, trial timers, project ledger, reboot recovery, or independent R0–R5 completion authority you need. I did not verify a documented `/loop` maximum-iteration flag or print-mode invocation contract; do not assume either exists.

### 2.3 Stop and lifecycle hooks

The official lifecycle catalog is:

| Event | Useful role |
|---|---|
| `PreToolUse` | Validate or block an impending tool action. |
| `PostToolUse` | Record observations after execution. |
| `PermissionRequest` | Handle a permission decision. |
| `UserPromptSubmit` | Add relevant context to a new prompt. |
| `Stop` | Reject premature turn completion. |
| `PostCompaction` | Observe successful context compaction. |
| `SessionStart` | Initialize session context and bookkeeping. |
| `SessionEnd` | Record termination or perform cleanup. |

Project hooks belong in `.devin/hooks.v1.json`; user hooks can live in `~/.config/devin/hooks.v1.json`. Command hooks receive JSON on stdin. JSON output can carry a decision and reason; exit code `2` blocks, while other nonzero codes are logged as errors and do not block. [Hook reference](https://docs.devin.ai/cli/extensibility/hooks/overview)

The basic Stop response is:

```json
{
  "decision": "block",
  "reason": "The assigned iteration lacks its required checkpoint. Complete it or record the exact blocker."
}
```

`Stop` receives `stop_hook_active`. Cognition explicitly warns that an unsatisfiable blocking condition can cause a loop. `PostCompaction` receives the compaction summary, which may be null. [Lifecycle reference](https://docs.devin.ai/cli/extensibility/hooks/lifecycle-hooks)

A Stop hook governs a normal decision to finish a turn. It is not a replacement for supervision after a crash, network failure, process termination, or reboot.

### 2.4 Permissions for unattended execution

The installed help names `auto`, `accept-edits`, `smart`, and `dangerous`. Current documentation also uses the corresponding names Normal, Bypass, and sandbox Autonomous.

| Mode | Unattended suitability |
|---|---|
| Normal/`auto` | Reads generally proceed; mutation and execution can prompt. |
| `accept-edits` | Workspace edits proceed; shell actions can still prompt. |
| `smart` | Some routine actions proceed; installations and mutating Git operations still prompt. |
| `dangerous`/Bypass | Tools auto-approve, subject to enforced organization policy. |
| `--sandbox`/Autonomous | Sandboxed shell/fetch actions proceed; direct edit/write tools can still prompt. |

Examples:

```sh
devin --permission-mode dangerous -p --prompt-file ITERATION-PROMPT.txt
devin --sandbox --permission-mode autonomous -p --prompt-file ITERATION-PROMPT.txt
```

Cognition recommends sandboxing for unattended execution with OS-enforced limits. Its documented caveat about direct edit tools means sandbox mode still requires a permissions rehearsal. Permission modes do not override organization deny/ask policy. [Permission documentation](https://docs.devin.ai/cli/reference/permissions)

For Toy, permission configuration must preserve protected graders, Authority, credentials, publisher state, existing services, and personal-contact restrictions. A prompt declaring autonomy cannot establish those boundaries.

### 2.5 Compaction and context continuity

Devin provides:

```text
/compact
/context
```

Automatic compaction also exists. The September 10 release added a user configuration setting for triggering it earlier:

```json
{
  "agent": {
    "compaction_threshold_tokens": 100000
  }
}
```

`100000` is an illustrative threshold, not a Cognition-recommended default. The release note establishes the setting; the full configuration reference currently omits it. Automatic compaction otherwise uses a context-window-based default. [Stable changelog](https://docs.devin.ai/cli/changelog/stable), [Configuration reference](https://docs.devin.ai/cli/reference/configuration/config-file)

Important distinctions:

- **Resume** restores a conversation.
- **Compaction** summarizes history within that conversation.
- **Fresh session** reconstructs the task from durable artifacts.

I found no official losslessness guarantee for compaction, no universal published compaction ratio, and no promise that the original specification remains fully represented after repeated summarization.

### 2.6 Subagents

Devin supports foreground and background subagents with independent conversation chains. Built-in profiles include read-only exploration and general-purpose implementation. Custom profiles belong under `.devin/agents/`; `devin doctor` checks their loading. Background agents cannot request new permissions: unapproved actions are denied. Subagents consume additional usage. [Subagent documentation](https://docs.devin.ai/cli/subagents)

Example instruction:

```text
Use an explore subagent to identify the relevant interfaces.
Return filenames and findings; do not change files.
```

Subagents help isolate focused work and review. They do not automatically make the parent persistent or solve scheduling.

For your build, preserve the existing ownership and concurrency rules. Do not enable unrestricted parallel writers or substitute Devin’s default subagent routing for specifically required Codex child-model contracts.

### 2.7 Goals, todos, rules, skills, and plugins

I found evidence of Devin’s agent todo UI in official release notes, but **no documented Devin CLI `/goal` command or durable todo-based completion scheduler** in the reviewed command/configuration references. A todo display should not become the authoritative project ledger. [CLI commands](https://docs.devin.ai/cli/reference/commands), [Todo-related changelog](https://docs.devin.ai/cli/changelog/stable)

Persistent instructions:

- `AGENTS.md`: automatically read project rules.
- `.devin/rules/`: additional rules.
- `.devin/skills/NAME/SKILL.md`: reusable procedures.
- `.agents/skills/NAME/SKILL.md`: supported portable skills.

Cognition recommends small always-on rules and skills for relevant procedures. [Rules documentation](https://docs.devin.ai/cli/extensibility/rules), [Skills overview](https://docs.devin.ai/cli/extensibility/skills/overview)

Example local skill:

```markdown
---
name: toy-build-card
description: Execute one assigned Toy card and leave a verifiable handoff
triggers:
  - user
  - model
---

Read the assigned iteration and its source specification.
Implement only its authorized scope.
Use the assigned SIM or toy CLI acceptance surface.
Record evidence, pending acceptance, blockers, and the next action.
```

Skill `allowed-tools` entries auto-approve those tools; they do **not** restrict all other tools. Subagent skills obtain access from their agent profile rather than inline skill permissions. [Skill format](https://docs.devin.ai/cli/extensibility/skills/creating-skills)

Plugins package instructions, skills, hooks, and tools. They improve repeatability; their presence does not independently establish persistence or correctness.

### 2.8 Cloud mechanisms

These are alternatives for comparison, not changes recommended for your currently mandated local build.

| Mechanism | Official behavior and limits |
|---|---|
| **Sessions** | Cloud work can be started and resumed from the CLI with `devin --cloud` and `devin --cloud --resume SESSION_ID`. Local CLI and Cloud are distinct execution paths. [Cloud/CLI distinction](https://docs.devin.ai/cli/index) |
| **Managed child Devins** | A coordinator can create, message, monitor, sleep, and terminate child sessions; assign prompts, playbooks, tags, and ACU limits; and schedule follow-up messages to itself. Children auto-start by default unless that preference is disabled. [Advanced capabilities](https://docs.devin.ai/work-with-devin/advanced-capabilities) |
| **Playbooks** | Reusable session prompts, created under Settings → Playbooks; attach through the picker or a macro such as `!toy-build-card`. Cognition recommends Skills for much project guidance. [Creating](https://docs.devin.ai/product-guides/creating-playbooks), [Using](https://docs.devin.ai/product-guides/using-playbooks) |
| **Schedules** | New scheduled work uses Automations → Create automation → Schedule. Legacy Scheduled Sessions remain supported. [Schedule documentation](https://docs.devin.ai/product-guides/scheduled-sessions) |
| **Automations** | Can start a session or message a selected existing session. Support invocation limits, per-started-session ACU budgets, and queue/concurrency controls. Set limits explicitly: new automations have no ACU limit by default. [Automations](https://docs.devin.ai/product-guides/automations) |
| **Dynamic Workflows** | Deterministic Python orchestration records agent results and replays completed calls on resume. Failed agents can retry in new sessions. The default and maximum run budget is **seven days**. [Dynamic Workflows](https://docs.devin.ai/work-with-devin/dynamic-workflows) |
| **Sleep/wake** | Cloud sessions sleep after 30 minutes of inactivity by default; messaging wakes them. Sleeping consumes no usage. Enterprise idle timeout can be adjusted to 5–120 minutes. [Usage documentation](https://docs.devin.ai/admin/billing/usage) |
| **Account limits** | Self-serve quotas and Enterprise ACUs differ. Pro has daily/weekly quotas; Max has a larger weekly quota without a daily cap. Limits apply across applicable product surfaces. [Self-serve plans](https://docs.devin.ai/admin/billing/self-serve) |

An official Dynamic Workflow instruction is expressed in natural language:

```text
Use a workflow to implement each independent work package, verify it,
and repeat failed packages until their gates pass or a round makes no progress.
```

The documented orchestration primitives include `register_workflow`, `agent`, `pipeline`, `parallel`, and `log`. Default workers have separate VMs; shared-machine execution is available. Replay depends on deterministic calls, so external-state inspection belongs inside recorded agent work. [Workflow execution model](https://docs.devin.ai/work-with-devin/dynamic-workflows)

For weeks of work, even this system needs durable cross-run project state. A seven-day workflow is not an unlimited project lease.

### 2.9 What Cognition recommends—and what users report

Cognition’s recurring advice is to provide explicit scope, examples, success criteria, and verification; split complex tasks into smaller sessions; and avoid accumulating unrelated work in one session. [Effective instructions](https://docs.devin.ai/essential-guidelines/instructing-devin-effectively), [Usage guidance](https://docs.devin.ai/admin/billing/usage)

Useful first-hand evidence, with limits:

- **Answer.AI, January 2025:** its team recorded 3 successes, 14 failures, and 3 inconclusive results across 20 tasks. Some attempts pursued unsupported approaches for more than a day. This is evidence about an older Cloud product, **not a measured success rate for CLI 3000.11.3**. The relevant failure pattern is persistence without useful progress. [Original evaluation](https://www.answer.ai/posts/2025-01-08-devin.html)
- **Cognition’s current changelog:** records actual fixes involving compaction, session continuity, permissions, and question handling. It also confirms fresh `/loop` reviewers in your version. This supports monitoring executable behavior rather than assuming the harness is infallible. [Official changelog](https://docs.devin.ai/cli/changelog/stable)
- **Recent CLI feedback:** a first-person Hacker News thread reports mixed experiences, including harness bugs and Cloud/local feature differences. These are anecdotes, not controlled measurements or evidence of week-long completion. [Original discussion](https://news.ycombinator.com/item?id=49650669)

I found no credible primary report establishing unattended, multi-week **local Devin CLI 3000.11.x** completion from one uninterrupted prompt.

## 3. How other agents sustain long work

### 3.1 Huntley’s Ralph: fresh processes and repository memory

Geoffrey Huntley’s original Ralph pattern is a shell loop repeatedly launching an agent with a prompt. His description emphasizes one task per iteration, specifications and a plan loaded each time, feedback from builds/tests, and tuning the environment when repeated mistakes emerge. [Huntley’s original account](https://ghuntley.com/ralph/)

The important mechanism is that the **repository persists while the agent instance is replaceable**.

A bounded modern form looks like:

```text
Select one task
→ start fresh agent
→ implement
→ run gates
→ checkpoint
→ select the next task
```

Huntley’s article describes long projects and strong outcomes, but those are operator reports, not a universal guarantee.

Ryan Carson’s `snarktank/ralph` makes the pattern explicit: fresh contexts, `prd.json`, `progress.txt`, and Git history, with a default maximum of ten iterations. [Variant implementation](https://github.com/snarktank/ralph)

### 3.2 Claude Code’s official Ralph plugin

Anthropic’s bundled `ralph-wiggum` plugin implements a **same-session Stop-hook loop**:

```text
/ralph-loop "Complete the assigned card and verify its acceptance criteria" --max-iterations 20 --completion-promise "CARD_COMPLETE"
/cancel-ralph
```

It repeats the original prompt when Claude tries to finish. The source checks an iteration limit and an exact completion promise extracted from the transcript. It does not independently run your acceptance suite. [Plugin documentation](https://github.com/anthropics/claude-code/blob/main/plugins/ralph-wiggum/README.md), [Hook implementation](https://github.com/anthropics/claude-code/blob/main/plugins/ralph-wiggum/hooks/stop-hook.sh)

This explains Huntley’s distinction between his original fresh-process approach and the Claude plugin.

Claude’s general Stop-hook documentation recommends inspecting `stop_hook_active`. Current documentation also describes an eight-consecutive-continuation safeguard, reset by tool calls. **Do not assume that Claude-specific cap exists in Devin.** [Claude hooks](https://code.claude.com/docs/en/hooks)

### 3.3 Codex `/goal` and exec loops

Official OpenAI documentation establishes Goals beginning with Codex `0.128.0`:

```text
/goal Complete the assigned migration while preserving public behavior and passing its acceptance suite
/goal
/goal pause
/goal resume
/goal clear
```

Goals persist an objective on the thread and enable continuation at idle boundaries. They stop for completion, interruption, blocking conditions, or budgets. They retain the thread rather than guaranteeing fresh context; completion still depends on evidence. [OpenAI Goals documentation](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex)

For scripted execution:

```sh
codex exec "Implement the assigned card"
codex exec resume --last "Resolve the remaining verification failures"
codex exec resume SESSION_ID "Recover this specific attempt"
```

Fresh `codex exec` invocations support a Ralph-style outer loop; resume supports continuity. `--json` provides events for automation. The supervisor must decide what to dispatch, when to retry, and whether acceptance passed. [Official noninteractive documentation](https://learn.chatgpt.com/docs/non-interactive-mode)

Do not infer that documented `/goal` behavior automatically applies to every headless exec invocation or that either mechanism overrides account quotas.

### 3.4 Hermes goals and board workers

Hermes documents:

```text
/goal Complete this card
/goal gate add COMMAND
/goal wait PID
/goal pause
/goal resume
```

The default goal budget is 20 turns. An auxiliary judge decides whether to continue, finish, block, or wait. Deterministic quality gates run before the judge; failed gates prevent completion.

Hermes distinguishes a single-session goal from Kanban: board cards dispatch separate worker processes/sessions, while `--goal` can supply persistence within an individual card. **The board is closer to your multi-week scheduler; a goal is closer to persistence within one card.** [Hermes Goals](https://hermes-agent.nousresearch.com/docs/user-guide/features/goals)

The documentation acknowledges false positives and false negatives from its judge. Gates therefore matter more than an agent’s completion prose.

### 3.5 Other systems

| System | Persistence pattern | Practical lesson |
|---|---|---|
| **Amp** | `amp -x "TASK"` runs locally until a turn ends. `amp -ox "TASK"` starts an asynchronous hosted orb; runner threads can execute on managed local hardware. [Execute mode](https://ampcode.com/docs/cli/execute-mode), [Orbs](https://ampcode.com/docs/cli/spawning-orbs) | Headless execution composes with an outer scheduler; asynchronous execution alone does not certify completion. |
| **Cursor background/Cloud Agents** | Isolated development environments, saved conversations/artifacts, branch handoffs, follow-ups, and schedule/event automations. [Cloud Agents](https://cursor.com/docs/cloud-agent), [Automations](https://cursor.com/docs/cloud-agent/automations) | Prepare a working test environment and enforce spending limits. Hosted agents change where execution occurs. |
| **Factory Droids** | `droid exec --auto low -f prompt.md`; continuation via `--session-id`. Missions add planning, workers, milestones, and validation: `droid exec --mission --auto high -f mission.md`. [Exec reference](https://docs.factory.com/droid-exec/overview), [Missions](https://docs.factory.com/missions/overview) | A structured plan plus user-facing QA is more useful than unrestricted continuation. |
| **OpenHands** | The documented legacy CLI provides `openhands --headless --json -f task.txt` and conversation resume. Its experimental critic can trigger bounded refinement, defaulting to three attempts. [Headless mode](https://docs.openhands.dev/openhands/usage/cli/headless), [Critic](https://docs.openhands.dev/openhands/usage/cli/critic) | Learned success scores supplement verification. These CLI pages are now categorized as deprecated; pin the implementation before adopting syntax. |
| **Jules** | Asynchronous repository tasks and recurring scheduled work. A January 2026 changelog adds schedule editing, pause, and resume. [Schedules](https://jules.google/docs/scheduled-tasks/), [Schedule update](https://jules.google/docs/changelog/2026-01-26-5/) | Maintenance over days comes from successive runs. The schedule guide’s “cannot edit” text is stale relative to the changelog. |
| **Copilot coding/Cloud agent** | Repository task → branch/PR → follow-up. Current documentation imposes a hard **59-minute execution limit per session**. [Official limits](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent) | Large work must be decomposed; keeping one session alive for days is unavailable here. |

### 3.6 Anthropic’s initializer and incremental-worker harness

Anthropic’s November 2025 experiment used:

1. An initializer to prepare the environment, feature inventory, progress file, and initial Git checkpoint.
2. Subsequent agents to implement one feature, verify it, and leave a clean handoff.

A comprehensive feature list began with every feature failing. Agents were constrained from rewriting requirements or weakening tests. End-to-end execution addressed premature completion that code inspection and small checks missed. [Effective harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

The March 2026 follow-up distinguishes fresh-context resets from compaction and identifies overly generous self-evaluation as another failure mode. Its planner/generator/evaluator harness ran multi-hour application builds. These findings are model- and experiment-specific; they support measuring harness choices rather than treating every scaffold as permanently necessary. [Follow-up research](https://www.anthropic.com/engineering/harness-design-long-running-apps)

A larger experiment used 16 agents, nearly 2,000 sessions, and about $20,000 in API costs to build a C compiler. That demonstrates sustained orchestration while also showing that successful long runs can involve substantial spending and specialized verification. [Compiler experiment](https://www.anthropic.com/engineering/building-c-compiler)

### 3.7 What works, and what fails

RepoMirror’s authors report six ports and over 1,000 commits overnight. They also report incomplete demos despite completion claims, extra features after the requested work was finished, repetitive progress-document updates, and an agent terminating its own loop. [First-hand report](https://github.com/repomirrorhq/repomirror/blob/main/repomirror.md)

The recurring engineering lessons are:

| Failure | Control for Toy |
|---|---|
| Premature “done” | Independent acceptance receipts; supervisor-owned completion. |
| Reward hacking | Protect requirements, graders, and verdict storage from the builder. |
| Context rot | Fresh card sessions and short, structured handoffs. |
| Drift | Explicit ownership and scope checks per iteration. |
| Endless repair | Persisted retry limits and unchanged-failure detection. |
| Fake progress | Measure accepted assertions and reproducible handoffs, not commit count. |
| Lost reasoning after reset | Preserve decisions, failed hypotheses, and exact next action. |
| Growing memory files | Load a compact current summary plus indexed details. |
| Multiple writers | Single coordinator lock; disjoint ownership where parallelism is authorized. |
| Runaway cost | Account controls, bounded dispatch, quota waits, and no paid fallback. |

An actual Ralph issue reports that append-only `progress.txt` grows until every iteration reloads thousands of irrelevant lines. Fresh context does not help if you immediately refill it with the entire history. [Original issue](https://github.com/snarktank/ralph/issues/166)

## 4. Recommended design for this Mac build

The following is **proposed engineering**, not built or tested behavior.

### 4.1 One kickoff, many bounded sessions

Keep one local supervisor and one sequential builder lane:

```text
Read durable state
→ select eligible card/stage
→ launch fresh Devin
→ verify its result independently
→ checkpoint accepted progress
→ dispatch next card
```

Amend `DEVIN-PROMPT.md` to permit sequential local sessions. Preserve its prohibitions on Cloud sessions and Outposts.

Use a recorded session ID for crash recovery only when restoring that attempt is useful. After repeated failure or a completed handoff, start fresh.

Do not force an entire multi-day card into one context window. Split it into bounded stages while retaining the original card and acceptance obligations.

### 4.2 Reuse the plan; strengthen its materialized state

Do **not** create a competing handwritten `IMPLEMENTATION_PLAN.md`. `specs/BUILD-PLAN.md` already defines the work.

If a convenient implementation-plan file is useful, generate it from the canonical plan and ledger.

Use:

| Artifact | Authority |
|---|---|
| `specs/BUILD-PLAN.md` | Canonical scope, order, dependencies, and acceptance obligations. |
| `build/state.json` | Validated materialized execution state. |
| `build/progress.md` | Short current orientation and index. |
| `build/iterations/` | Immutable attempt prompts, results, and handoffs. |
| `build/evidence/` | Redacted verification artifacts. |
| `build/HUMAN-STEPS.md` | Exact outstanding identity/consent steps. |
| Supervisor state outside builder write access | Locks, counters, quotas, accepted verdicts, and dispatch decisions. |

A card needs separate fields for:

```json
{
  "implementation": "pending",
  "acceptance": "pending",
  "deployment": "not_started",
  "attempts": 0,
  "pending_assertions": [],
  "blocker": null,
  "next_action": null
}
```

Also record the spec/assertion digest, source revision, tested tree digest, fixture/seed, rung, evidence references, session ID, failure signature, and next eligible time.

**Implementation availability may unblock a same-release dependency. Acceptance completion and release passage require the full assigned evidence.**

### 4.3 Change the Stop hook to govern the current iteration

Replace “block until project DONE” with:

| Condition | Hook action |
|---|---|
| No managed iteration | Allow stopping. |
| Valid iteration handoff submitted | Allow return to supervisor. |
| Exact blocker/wait submitted | Allow return for scheduling. |
| Supervisor requests checkpoint/recovery | Allow return. |
| First premature stop | Block with a specific missing obligation. |
| Repeated stop after hook continuation | Yield to supervisor for bounded recovery. |
| Hook error | Outer supervisor rejects acceptance and handles recovery. |

A concrete configuration shape:

```json
{
  "Stop": [
    {
      "matcher": "",
      "hooks": [
        {
          "type": "command",
          "command": "/ABSOLUTE/PROTECTED/PATH/toy-build-supervisor hook-stop",
          "timeout": 10
        }
      ]
    }
  ],
  "SessionStart": [
    {
      "matcher": "",
      "hooks": [
        {
          "type": "command",
          "command": "/ABSOLUTE/PROTECTED/PATH/toy-build-supervisor hook-start",
          "timeout": 10
        }
      ]
    }
  ]
}
```

`toy-build-supervisor` is a **proposed executable**, not an existing command.

Its Stop handler should parse stdin, associate the session with the supervisor-issued iteration, and use `stop_hook_active` to prevent repeated same-turn blocking. Start with at most **one corrective Stop continuation per turn**; then let the supervisor decide whether another fresh attempt is warranted.

The hook should not run a long acceptance suite inside its timeout. It checks checkpoint protocol; the independent verifier checks correctness.

Add `PostCompaction` bookkeeping if useful, but do not assume undocumented context-injection fields work for that event on this version.

### 4.4 Make `run-forever.sh` a thin supervised entry point

The core launch inside the supervisor should become:

```sh
devin \
  --model opus \
  --permission-mode dangerous \
  --export "$iteration_export" \
  -p \
  --prompt-file "$iteration_prompt"
```

Here `opus` follows the build plan’s builder ownership. Record the resolved model and available account entitlement before dispatch. This is separate from Toy’s specified runtime and Codex child models.

Keep the existing permission mode only after enforcing the required filesystem/account boundaries. If sandbox execution covers a card, use a rehearsed sandbox profile instead.

Recommended launcher:

```zsh
#!/bin/zsh
set -eu
cd "${0:A:h}"
exec caffeinate -i /ABSOLUTE/PROTECTED/PATH/toy-build-supervisor run \
  --workspace "$PWD" \
  --max-iterations 500 \
  --max-active-seconds 1209600
```

This is a proposed integration shape requiring the supervisor implementation. Wrapping the supervisor keeps idle-sleep prevention active across waits.

The supervisor must:

1. Acquire a real exclusive lock.
2. Reconcile interrupted attempts and unfinished external operations.
3. Persist counters before dispatch.
4. Select work using release and dependency rules.
5. Render an immutable prompt for one attempt.
6. Launch and monitor Devin.
7. Run independent acceptance checks.
8. Accept the result or record failure.
9. Continue automatically or wait for a real prerequisite.
10. Stop on verified completion, exhausted safety limits, or an unrecoverable boundary.

Use `launchd` for restart after reboot/process failure; tmux remains useful for observation. LaunchAgents have login-session lifecycle constraints, so GUI-dependent work and headless boot recovery need separate verification. [Apple’s launchd documentation](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)

### 4.5 Stall detection and limits

Suggested initial limits—engineering defaults, not vendor recommendations:

| Control | Initial setting |
|---|---|
| Simultaneous builder processes | 1 |
| Corrective Stop continuations | 1 per turn |
| Same failure without new evidence | 3 attempts |
| Initial attempt checkpoint deadline | 60 minutes |
| No observable tool/process activity | Investigate after 15 minutes |
| Global fresh-session dispatch cap | 500 |
| Global active-work budget | 14 days, excluding legitimate scheduled waits |
| Transient-error backoff | 30 seconds → 2 minutes → 10 minutes, with jitter |

Use supervisor-owned observations. Heartbeats demonstrate liveness, not progress. Useful progress includes:

- newly accepted assertions;
- a verified implementation handoff;
- a new reproducer or evidence that eliminates a hypothesis;
- a reconciled blocker or completed trial checkpoint.

Do not use log growth, file touches, or commits as the sole progress signal.

At a deadline, request a checkpoint first. If termination becomes necessary, terminate only the attempt’s process tree, preserve files, and reconcile uncertain side effects before retrying.

Counters must survive reboot and supervisor restart. `launchd` must not turn a reached limit into a fresh allowance.

### 4.6 Replace free-form pause authority

The builder should submit a wait request with:

- affected card;
- blocker type;
- evidence;
- earliest useful retry;
- prerequisite/event to observe.

The supervisor validates that no eligible independent work remains before waiting.

For quota, wait until a known reset or a bounded status recheck. For human login, retain the exact step and recheck sparingly. For a 168-hour trial, let the trial’s own local jobs run and schedule relevant checkpoints. Do not relaunch inference every 30 seconds.

Do not skip required R0 trial gates merely because downstream implementation is possible.

### 4.7 Completion and cost authority

The builder submits **candidate completion**. The protected verifier accepts it.

`build/DONE` should be generated only after:

- required cards and original assertions are accounted for;
- assigned rungs and required negative cases pass;
- release gates and prior regressions pass;
- evidence matches the tested code/spec digests;
- required deployments have readback and rollback evidence;
- no mandatory blocked obligation remains.

A missing login means incomplete deployment, not permission to declare DONE with a blocked item in the final report.

Preserve the explicit **no extra spending** rule. Disable overage/credit consumption through available account controls; classify quota errors and wait. Do not switch to paid APIs or add premium subagents as an automatic recovery action.

### 4.8 Replacement `START-PROMPT.txt`

```text
Read DEVIN-PROMPT.md and AGENTS.md in full. Follow the canonical
specs/PRINCIPLES.md, specs/BUILD-PLAN.md, and specs/TEST-PLAN.md.

Initialize or reconcile the durable build ledger against the existing
canonical plan. Preserve existing files, services, credentials, and work.
Do not invent a second plan or change acceptance requirements.

This invocation is a bounded initializer. Prepare the exact next eligible
card attempt, its acceptance obligations, prerequisites, and handoff.
If the verifier foundation is the first assigned card, implement that
foundation using the existing build-plan order.

The local supervisor will continue the project through sequential fresh
Devin sessions. Completing this invocation does not complete Toy.

Keep implementation availability, acceptance completion, and deployment
as separate states. Missing SIM prerequisites remain pending and do not
become module-test PASS results.

Use temporary stores and fake external providers before live actions.
Drive and verify Toy through its supported toy CLI and assigned SIM
surface. Preserve protected graders, Authority, and release controls.
Never buy credits, enable overage, or use paid fallbacks.

Record exact human-only steps and continue eligible independent work.
Leave a coherent checkpoint with evidence, pending assertions, blockers,
and the next action. Do not create build/DONE; only the independent
completion verifier may publish project completion.
```

### 4.9 Per-iteration prompt

The supervisor should render the assignment above this reusable body:

```text
Execute only the supervisor-assigned card or bounded stage.

Read AGENTS.md, the canonical principles, build/progress.md, the relevant
validated build state, and the assigned card's source specifications.
Inspect the current code and recent Git history before editing.

Implement the assigned scope. Preserve frozen interfaces, ownership,
authority boundaries, and release order. Use the paved-path generators,
deep modules, feature map, no-comment/no-TODO rules, and correction ladder.

Verify at the first reachable assigned rung:
SIM → toy CLI → public module interface → justified internal pure logic.
Do not substitute a smaller test for pending acceptance.

Record commands, observed results, fixture/seed, tested digest, evidence
paths, pending assertions, and deployment state. Submit a candidate result;
the independent verifier decides acceptance.

After three unchanged failures, stop repeating the approach. Leave the
reproducer, failed hypotheses, evidence, and exact next recovery action.

If blocked by identity, quota, timer, permission, or an essential
prerequisite, submit the exact blocker. Do not evade it or invent success.

Checkpoint coherent work and provide a concise handoff. End this
invocation when the assigned attempt is ready for supervisor review.
The supervisor will dispatch subsequent work automatically.
```

## 5. Verification before entrusting it with weeks of work

Exercise the **largest harness interface**, using fake providers and disposable workspaces:

- Premature final response receives one corrective continuation.
- Forged `DONE`, stale evidence, changed assertions, and weakened graders never produce accepted completion.
- A crash preserves changes and recovers the assigned attempt without duplicate live effects.
- Three unchanged failures trigger a different recovery path.
- Quota exhaustion waits without paid fallback or rapid inference retries.
- Valid implementation availability unblocks permitted same-release work while acceptance remains pending.
- A simulated seven-day trial waits without consuming repeated model turns.
- Two runner launches admit only one coordinator.
- Reboot recovery preserves budgets and counters.
- Full completion publishes a verifier-produced report that distinguishes built, tested, and deployed behavior.

**The highest-value changes are:** fresh sessions per bounded card attempt; independent acceptance authority; protected durable state; persisted retry and spending controls; and legitimate waiting. Together they let one kickoff drive weeks of work while keeping “still running” and “actually progressing” distinguishable.