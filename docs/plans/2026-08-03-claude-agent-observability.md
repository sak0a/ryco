# Claude Agent Observability — Subagents & Dynamic Workflows

Status: proposed
Date: 2026-08-03
Owner: unassigned
Related: `provider-neutral-subagents-for-ryco.md` (predecessor design, largely shipped)

## Goal

Make a Claude turn's full agent tree observable in Ryco: every subagent and every
dynamic-workflow member agent, with live model, reasoning effort, token spend, tool-call
count, latest tool call, duration, status and transcript — rendered in the existing
`ThreadWorkspacePanel` surface rather than a bolted-on card.

## Non-goals

- Provider-neutral workflows. Dynamic workflows are a Claude-only construct; other
  providers keep the existing `subagent.*` summary/transcript surface unchanged.
- Authoring workflows from Ryco. We observe and pause/resume runs the model launches.
- Replacing the existing subagent tabs. Everything here extends them.

---

## Background: what the SDK gives us

Ryco depends on `@anthropic-ai/claude-agent-sdk`, pinned at **0.3.159** (`bun.lock:434`).

`query()` yields `SDKMessage`. The observability-relevant variants:

| Message                               | Fields we want                                                                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `SDKTaskStartedMessage`               | `task_id`, `tool_use_id`, `description`, `task_type` (`local_bash` \| `local_agent` \| `local_workflow` \| `remote_agent`) |
| `SDKTaskProgressMessage`              | `subagent_type`, `usage{total_tokens, tool_uses, duration_ms}`, `last_tool_name`, `summary`                                |
| `SDKTaskUpdatedMessage`               | `patch{status, end_time, error, is_backgrounded}` — merge into a map keyed by `task_id`                                    |
| `SDKBackgroundTasksChangedMessage`    | authoritative full live task set on every membership change                                                                |
| `SDKToolProgressMessage`              | `tool_use_id`, `tool_name`, `parent_tool_use_id`, `elapsed_time_seconds`, `subagent_type`, `subagent_retry`                |
| `parent_tool_use_id` (assistant/user) | subagent attribution — the basis for a per-subagent transcript                                                             |
| `AgentOutput` via `tool_use_result`   | `resolvedModel`, `modelsUsed[]`, `totalTokens`, `totalToolUseCount`, `toolStats{…}`, `worktreePath`                        |
| `SDKResultMessage.modelUsage`         | per-model `{inputTokens, outputTokens, cacheRead…, costUSD, contextWindow}` — whole-tree accounting                        |

Two options gate most of it:

- **`forwardSubagentText: true`** — subagent text/thinking arrive as complete messages
  carrying `parent_tool_use_id`. Without it there is no child transcript.
- **`agentProgressSummaries: true`** — populates `summary` on `task_progress`.

**The structural gap:** the `Workflow` tool returns immediately with
`{taskId, runId, scriptPath, transcriptDir, workflowName}` and the entire run is _one_
background task on the stream. Its member `agent()` calls never appear as SDK messages.
Recovering them requires reading the run's transcript directory off disk (Phase 5).

## Current state of the code

Already shipped and working:

- `packages/contracts/src/providerRuntime.ts:179` — `task.started`, `task.progress`,
  `task.completed`, `subagent.started`, `subagent.updated`, `subagent.completed`,
  `subagent.message.delta`; `SubagentRef` at `:512`.
- `apps/server/src/provider/Layers/ClaudeAdapter.ts:2367-2500` — handles `task_started`,
  `task_progress`, `task_notification`, `thinking_tokens`, `tool_progress`,
  `tool_use_summary`, `hook_started`/`hook_response`, `status`, `compact_boundary`.
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:621-686` — projects
  `subagent.*` into thread activities, **including `usage`** (`:654`, `:679`).
- `packages/client-runtime/src/state/session/threadWorkspaceViewModel.ts:14-31` —
  `ThreadSubagentView` with `status`, `tool`, `detail`, `providerThreadIds`, `entries`,
  `messages`.
- `apps/web/src/threadWorkspaceTabs.ts`, `components/ThreadWorkspacePanel.tsx`,
  `components/sidebar/SubagentAvatar.tsx` — per-subagent tabs render today.

Missing:

- `ThreadSubagentView` has **no model, effort, or token fields**. `usage` reaches the
  client on the activity payload and is then discarded.
- `forwardSubagentText` / `agentProgressSummaries` are not set
  (`ClaudeAdapter.ts:3171-3195`).
- No `task_updated`, no `background_tasks_changed`.
- No workflow support of any kind.

---

## Phase 1 — Surface model, effort and tokens on subagents

**Size:** S · **Blocks:** 6 · **Blocked by:** none

The highest value-per-line change in this plan: the token data already arrives at the
client and is thrown away.

### Contract changes — `packages/contracts/src/providerRuntime.ts`

Replace the untyped `usage: Schema.Unknown` on `SubagentUpdatedPayload` /
`SubagentCompletedPayload` with a decoded struct, and extend `SubagentRef`:

```ts
export const RuntimeSubagentUsage = Schema.Struct({
  totalTokens: Schema.optional(Schema.Int),
  toolUses: Schema.optional(Schema.Int),
  durationMs: Schema.optional(Schema.Int),
});

// added to SubagentRef
model: Schema.optional(TrimmedNonEmptyStringSchema),
effort: Schema.optional(TrimmedNonEmptyStringSchema),
subagentType: Schema.optional(TrimmedNonEmptyStringSchema),
```

Decode leniently: historical activities carry the raw SDK snake_case
`{total_tokens, tool_uses, duration_ms}`. Accept both shapes so replayed threads don't
fail projection. Persisted activity payloads are **not** re-encoded — this is a read-side
widening only, no migration.

`SubagentRef.metadata` (already `UnknownRecordSchema`) stays as the escape hatch for
provider-specific extras; do not use it for the three fields above.

### Server — `apps/server/src/provider/Layers/ClaudeAdapter.ts`

- `makeClaudeTaskSubagentRef` (`:512`): carry `subagent_type` from `task_started` /
  `task_progress` into `SubagentRef.subagentType`, and derive `effort` from a
  `worker-<tier>` subagent type (see "Effort encoding" below).
- New: on the `Agent` tool's `tool_use_result` (an `AgentOutput`), emit a final
  `subagent.updated` carrying `resolvedModel` → `model`, `totalTokens`, `totalToolUseCount`,
  `totalDurationMs`. This is the only place the SDK reports the model a subagent actually
  ran on. `modelsUsed[]` (present only on a mid-run swap) goes into `metadata`.
- Normalize usage to the contract's camelCase at the adapter boundary.

### Client — `packages/client-runtime/src/state/session/threadWorkspaceViewModel.ts`

Extend `ThreadSubagentView` and `MutableThreadSubagentView`:

```ts
model: string | null;
effort: string | null;
subagentType: string | null;
totalTokens: number | null;
toolUses: number | null;
durationMs: number | null;
```

Merge semantics, in precedence order — this matters, get it right:

1. A final `subagent.completed` value wins over anything earlier.
2. Otherwise last-write-wins per field, but **never overwrite a present value with
   `null`/`undefined`**. `task_progress` frames omit fields they have nothing new for.
3. `totalTokens` is monotonic per subagent; ignore a decrease (a late-arriving stale frame).

### UI — `apps/web/src/components/ThreadWorkspacePanel.tsx`

`AgentStatusName` (`:114`) grows a metadata row under the name: model chip, effort chip
(omitted when absent), `{totalTokens} tok`, `{toolUses} tools`, duration. Reuse existing
chip components (`ContextWindowChip`, `AgentChip`) and design tokens — no new visual
language. Omit a chip entirely rather than rendering a placeholder.

### Effort encoding (design note)

The `Agent` tool input has `model` but **no `effort`**. `AgentDefinition` does have
`effort`. So the only way to let the model choose per-subagent effort is to register
synthetic agent definitions that exist purely to carry it:

```ts
agents: {
  "worker-low":    { description: "…", prompt: "…", effort: "low" },
  "worker-medium": { …, effort: "medium" },
  "worker-high":   { …, effort: "high" },
  "worker-xhigh":  { …, effort: "xhigh" },
}
```

…plus a system-prompt line telling the model to pick one as `subagent_type`. These are an
implementation detail and **must not surface as a subagent role in the UI** — add an
`isWorkerTierSubagentRole()` guard in `packages/shared` and suppress them in
`threadWorkspaceViewModel` and in any label derivation. This is optional for Phase 1; ship
it only if we want model-selected effort. If we skip it, `effort` stays null for subagents.

### Acceptance criteria

- A Claude turn that spawns 2+ subagents shows, per subagent tab, a non-null model and a
  token count that increases while it runs.
- A completed subagent shows `resolvedModel`, final token total and tool count.
- A thread with pre-Phase-1 persisted activities still projects without error (lenient decode).
- `bun typecheck` green; new unit tests for the merge precedence rules above.

---

## Phase 2 — Subagent transcripts via `forwardSubagentText`

**Size:** XS (one option) + S (routing correctness) · **Blocked by:** 1

### Change — `ClaudeAdapter.ts:3171-3195`

```ts
forwardSubagentText: true,
agentProgressSummaries: true,
```

### The actual work: attribution

With the option on, assistant and user messages for subagent turns arrive on the main
stream with a non-null `parent_tool_use_id`. Every handler that currently assumes
"assistant message ⇒ main thread" must branch:

- `ClaudeAdapter.ts:828` (assistant), `:947` (user), `:1064-1076` — check
  `parent_tool_use_id` first.
- Maintain `subagentByToolUseId: Map<string, SubagentRef>`. `task_started.tool_use_id`
  is the join key between a tool call and its task; the existing map is keyed by `task_id`
  only (`:186`), which is not enough.
- Route matched messages to `subagent.message.delta` (contract already exists,
  `providerRuntime.ts:548`) instead of `thread.message.*`.

**Primary risk:** subagent text double-rendering into the main timeline. This is the whole
of the review burden for this phase. Add a regression test that asserts a subagent
assistant message produces zero main-thread message activities.

`SDKPartialAssistantMessage` always has `parent_tool_use_id: null` — stream events are
main-session only. Subagent text is therefore non-streaming (whole messages, not deltas).
Do not try to synthesize streaming for it.

### Acceptance criteria

- A subagent tab shows the subagent's own assistant messages.
- The main timeline contains no subagent text.
- Existing single-agent turns are byte-identical in output to before the change.

---

## Phase 3 — SDK bump 0.3.159 → 0.3.22x

**Size:** S–M · **Blocks:** 4, 5 · **Blocked by:** 2 (sequence, not logic)

Ordered _after_ 1–2 deliberately: those two phases work on the pinned version, so we prove
the pipeline before taking on version risk.

Version thresholds we need:

| Feature                                                | Requires          |
| ------------------------------------------------------ | ----------------- |
| `Workflow` tool                                        | 0.3.149 (have it) |
| `resolvedModel` on `AgentOutput`                       | CC 2.1.174        |
| `background_tasks_changed`                             | CC 2.1.203        |
| `SDKConversationResetMessage` typings                  | CC 2.1.203        |
| `modelsUsed`, `subagent_retry`, `heartbeat`, `aborted` | CC 2.1.212–214    |

SDK patch number tracks the CLI's: SDK v0.3.191 bundles Claude Code v2.1.191.

### Risks

- The bundled native CLI binary changes with the SDK. `pathToClaudeCodeExecutable` is set
  from `claudeBinaryPath` (`:3174`) — confirm resolution still works for both the bundled
  and the user-installed binary paths.
- New `system` subtypes will reach the switch at `ClaudeAdapter.ts:2279`. Verify the
  default arm ignores unknown subtypes rather than throwing. Add a test that feeds a
  synthetic unknown subtype.
- `settings` / `extraArgs` passthrough semantics.

### Verification (mandatory, in order)

```
bun typecheck
bun --filter @ryco/server run test
bun --filter ryco-cli run build:bundle && node apps/server/dist/bin.mjs --help
```

The bundle step is required — `dev:desktop` does not rebuild `apps/server/dist/bin.mjs`.

---

## Phase 4 — `task_updated` and `background_tasks_changed`

**Size:** S · **Blocked by:** 3

Fixes a real bug class: subagents that stay "running" forever because their terminal
transition never arrived.

### `ClaudeAdapter.ts` — new cases in the `system` subtype switch

- **`task_updated`** → merge `patch` into task state keyed by `task_id`. On
  `patch.status ∈ {completed, failed, killed}` emit `task.completed` and
  `subagent.completed` with the mapped status (`killed` → `stopped`). Carry
  `patch.error` into the completion summary.
- **`background_tasks_changed`** → the payload is the **full live set**; treat it as
  authoritative. Any task we believe is running that is absent from the set gets settled.

Docs are explicit that ordering between `background_tasks_changed` and the per-task events
is unspecified, and that nothing is emitted at startup. So:

- Reset the live set to empty whenever the CLI process starts or restarts.
- Never pair `task_started`/`task_notification` to derive membership — replace wholesale.

### Contract addition

```ts
"task.set.changed"; // payload: { tasks: ReadonlyArray<{ taskId, taskType, description }> }
```

Ingestion reconciles: for each known-running subagent whose `providerTaskId` is not in the
set, emit a synthetic `subagent.completed` with status `stopped`.

### Acceptance criteria

- Killing a background subagent mid-run settles its tab within one event.
- A subagent whose `task_notification` is dropped still settles via the next
  `background_tasks_changed`.
- Restarting the provider process clears stale live-task state.

---

## Phase 5 — Dynamic workflow runtime

**Size:** M · **Blocked by:** 3

Two new server modules plus adapter wiring. The design mirrors Synara's, because the
constraint is external: the member agents genuinely are not on the SDK stream.

### 5a. `apps/server/src/provider/claudeWorkflowScript.ts`

Pure functions, no I/O, fully unit-testable:

- `parseWorkflowScriptMeta(source)` → `{ name, description, phases: [{title, detail}] }`
  from the leading `export const meta = {…}` literal. The literal is spec-guaranteed pure
  (no variables, calls, spreads or interpolation), so a bounded parse is safe. Return
  `null` on anything unparseable — never throw.
- `parseWorkflowAgentPlans(source)` → per-`agent()` `{label, phase, model, effort}`. This
  is the _planned_ configuration and is the lowest-precedence source for those fields.
- Cap input size; refuse to parse beyond a fixed byte limit.

### 5b. `apps/server/src/provider/claudeWorkflowRuntime.ts`

Incremental, best-effort poller over the run's `transcriptDir`:

- `journal.jsonl` — lines `{type: "started" | "result", key, agentId}` give agent
  lifecycle and **insertion order**, which is what labels zip against.
- `agent-<id>.jsonl` — assistant lines carry `message.model`, a top-level `effort`, and
  `message.usage` (latest line = current context footprint), plus `tool_use` blocks for
  tool count and recent tool names.

Hard requirements:

- Byte-offset incremental reads, advancing only to the last complete line boundary.
- `MAX_FILE_BYTES = 5 MiB`, `MAX_CHUNK_BYTES = 512 KiB` per tick; overflow is caught up on
  later ticks, never dropped silently — set a `skipped` flag and surface it.
- Dedupe tool uses by `tool_use_id`.
- **Every** parse failure and fs error degrades to "no update". This module must not be
  able to fail a turn.
- Poll interval configurable (tests shrink it).

> **This is a filesystem side-channel around an undocumented on-disk format.** It will
> break without deprecation warning on Claude Code internals changes. Gate Phase 5+6
> behind a setting (`claude.workflowObservability`, default on) so it can be switched off
> without a release, and make the UI degrade to "workflow running, N agents" when the
> poller reports nothing.

### 5c. Adapter wiring — `ClaudeAdapter.ts`

- On the `Workflow` tool's result, parse
  `{status, taskId, runId, scriptPath, transcriptDir, workflowName, summary, error}`.
  **Check `error` first** — a script that fails its syntax check returns
  `status: "async_launched"` with `error` set and never runs.
- Read the script from the tool _input_ (`script`) or from `scriptPath`; feed 5a.
- Register the workflow in `liveWorkflowTaskIds`; spawn a poller fiber scoped to the turn;
  interrupt it on settle after one final catch-up read.
- **Member linkage:** the SDK carries no parent-task linkage. Tag an agent task that
  starts while exactly one workflow is live with that workflow. With concurrent workflows,
  membership is ambiguous — leave untagged and let the UI show them as loose background
  agents. Document this in the module header; do not guess.

### 5d. Contracts + persistence

New events, `packages/contracts/src/providerRuntime.ts`:

```
workflow.started    { workflowTaskId, name, description?, phases?, runId?, scriptPath? }
workflow.progress   { workflowTaskId, agents: ReadonlyArray<WorkflowAgentRuntimeSnapshot> }
workflow.completed  { workflowTaskId, status, agents?, summary? }
```

```ts
WorkflowAgentRuntimeSnapshot = {
  agentId, label?, phase?, model?, effort?,
  state: "running" | "completed",
  totalTokens?, toolCalls?, recentToolNames?, promptPreview?,
  startedAt?, lastActivityAt?,
}
```

Persistence: one migration adding a workflow JSON column to the thread projection, mirroring
`ProjectionThreads`' existing subagent column. Follow the numbering convention in
`apps/server/src/persistence/Migrations/`.

### Acceptance criteria

- Launching a 5-agent workflow produces a `workflow.started` with parsed phases, then
  `workflow.progress` frames whose agent rows gain model/effort/tokens as they run.
- A workflow whose script fails syntax check reports the error and starts no poller.
- Deleting `transcriptDir` mid-run degrades to no further updates; the turn still settles.
- Poller fiber is interrupted on turn settle (assert no leaked fibers in tests).

---

## Phase 6 — Workflow UI

**Size:** M–L · **Blocked by:** 5 (component), not blocked (view model — see delegation)

### Design decision: a tab, not a card

Synara renders a standalone `WorkflowRunCard` in the message timeline. **We should not
copy that.** A workflow run is a long-lived, multi-agent, inspectable thing — exactly what
`ThreadWorkspacePanel` already is for. Putting it in the timeline means it scrolls away
from the thing it describes.

Instead:

- Add a `workflow` tab kind to `WorkspaceTab` in `apps/web/src/threadWorkspaceTabs.ts`,
  alongside the existing `files | review | terminal` and per-agent `agent` tabs. Workflow
  member agents become `agent` tabs nested under it — reusing the machinery that already
  works.
- In the timeline, a single compact `TimelineWorkEntryRow`-style line: workflow name,
  phase progress (`2/4`), running agent count, click-through to the tab. One line, no card.

Visual language: existing chips and design tokens only. No new accent palette, no phase
"rail" with gradients, no terminal aesthetic. The phase indicator should read like the
existing status chrome — restrained, text-led, legible at a glance.

### `packages/client-runtime/src/state/session/workflowRunViewModel.ts`

Pure derivation from thread activities → `WorkflowRunState`. Port the field-precedence
chain, which is the genuinely valuable part of Synara's logic:

> **live transcript > final snapshot > planned script opts**

for `model` and `effort`, per agent. Plus:

- `status: "running" | "paused" | "completed" | "failed" | "stopped"`, with `pausedByUser`
  distinguishing a user pause from a plain stop.
- Phase summaries `{title, detail, doneCount, totalCount, isCurrent}`; `phases: null` when
  nothing parsed → render a flat agent list.
- `taskIds` = workflow task + members, so the generic background-agent count can dedupe
  against rows this panel already renders.
- Elapsed time from last reported `usage.duration_ms`, falling back to wall clock since
  `startedAt` for live rows.

### Pause / resume

A workflow run is resumable: re-invoke `Workflow` with `{scriptPath, resumeFromRunId}` and
completed `agent()` calls replay from cache, so stop-then-resume behaves as pause. Persist
`runId` + `scriptPath` from the launch result; both present ⇒ the settled card offers
Resume. Implement as a composer prompt injection, not a direct tool call.

### Acceptance criteria

- A running workflow shows a phase indicator and one row per agent with model, effort,
  tokens, tool count, last tool and elapsed time, updating live.
- Clicking an agent row opens its transcript tab.
- Resume on a settled run continues from cache rather than re-running completed agents.
- Panel renders correctly with `phases: null` and with zero live agents.
- WCAG AA contrast on all new chips in both themes.

---

## Sequencing and delegation

### Dependency graph

```
1 ──> 2 ──> 3 ──> 4
                 └──> 5 ──> 6b (component)
1 ─────────────────────────> 6a (view model, against fixtures)
```

### File-ownership conflicts — serialize these

`ClaudeAdapter.ts` is touched by phases 1, 2, 4 and 5. `providerRuntime.ts` by 1, 4 and 5.
`threadWorkspaceViewModel.ts` by 1 and 6.

**These phases must not run in parallel against the same working tree.** Either serialize
them, or give each agent an isolated git worktree and rebase. Do not let two agents edit
`ClaudeAdapter.ts` concurrently — it is 3576 lines of dense Effect code and the merge will
cost more than the parallelism saved.

### What genuinely parallelizes

| Track                   | Phases                | Owns                                                            |
| ----------------------- | --------------------- | --------------------------------------------------------------- |
| A (serial)              | 1 → 2 → 3 → 4 → 5c/5d | `ClaudeAdapter.ts`, `providerRuntime.ts`, ingestion, migrations |
| B (parallel from start) | 5a, 5b                | two brand-new files, pure logic + fs, zero overlap              |
| C (parallel after 1)    | 6a                    | `workflowRunViewModel.ts` — new file, built against fixtures    |
| D (after A reaches 1)   | 1's UI slice          | `ThreadWorkspacePanel.tsx`                                      |
| E (after 5 + 6a)        | 6b                    | new components                                                  |

Tracks B and C are the real wins: `claudeWorkflowScript.ts`, `claudeWorkflowRuntime.ts` and
`workflowRunViewModel.ts` are ~1000 lines of pure, heavily-testable logic that depend only
on the contract shape agreed in Phase 5d. Agree that shape first, then fan out.

### Suggested agent assignment

- **Track A** — one implementor per phase, sequential, each followed by a verifier.
  Phase 3 (SDK bump) needs a verifier run that includes the bundle smoke test.
- **Track B** — two implementors in parallel, each with a fixture corpus. Capture a real
  `transcriptDir` from a live workflow run first and commit it as a test fixture; without
  it 5b is being written blind.
- **Track C** — one implementor working from the Phase 5d contract + hand-written fixtures.
- **Track E** — `ui-designer` agent, per the design constraints above.

### Definition of done for the whole plan

- `bun typecheck` and `bun test` green.
- `bun --filter ryco-cli run build:bundle && node apps/server/dist/bin.mjs` smoke passes.
- A live Claude turn spawning a 5-agent workflow renders every agent's model, effort,
  tokens, last tool and transcript, and resumes correctly after a pause.
- Setting `claude.workflowObservability = false` cleanly degrades to Phase-4 behaviour.

## Open questions

1. Do we want model-selected reasoning effort for subagents (the `worker-<tier>` trick), or
   is inheriting the parent's effort acceptable? Affects Phase 1 scope only.
2. Should workflow member agents get real child threads (persisted, resumable) or stay
   ephemeral view-model rows? Child threads are more consistent with subagent tabs but cost
   a migration and thread-lifecycle work.
3. `modelUsage` gives whole-tree cost including subagents. Do we surface a per-turn cost
   figure, and if so where — thread header or workspace panel?
