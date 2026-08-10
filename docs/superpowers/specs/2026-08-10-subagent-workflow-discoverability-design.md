# Subagent Workflow Discoverability and Streaming Reliability Design

## Summary

Bring Ryco's subagent and workflow experience up to the strongest behavior in
the current `pingdotgg/t3code` stable and nightly releases without replacing
Ryco's newer thread-workspace architecture.

Ryco already contains most of the large native subagent-observability port:
provider task linkage, persisted orchestration activities, a shared client
runtime fold, the Agents panel, workflow grouping, and subagent transcript
tabs. The remaining work is a targeted parity-and-polish pass. It will port the
upstream reliability fixes that landed after Ryco's original fork, unify agent
identity across surfaces, make roster rows visually stable, expose live agent
counts, protect background work from lifecycle races, make buffered assistant
output the unmistakable default, and stop live updates from stealing a user's
scroll position.

This design deliberately adapts upstream changes rather than cherry-picking a
large divergent history. Ryco keeps its own workspace launcher, transcript
deep links, retry behavior, minimap, activity folds, hosted lifecycle rules,
and provider-instance architecture.

## Goals

- Make native Claude and Codex subagents and workflows easy to discover while
  they are running and easy to understand afterward.
- Persist and consistently display provider-native role/type metadata such as
  implementer, reviewer, verifier, explorer, or any future provider role.
- Give every agent one stable visual identity across the Agents roster and its
  transcript tab.
- Keep roster rows, workflow groups, usage, status, and expansion state stable
  while events stream or reconnect.
- Prevent lifecycle cleanup, stop races, resume handshakes, or queued turns
  from corrupting subagent or parent-turn state.
- Keep buffered assistant output as the default and move token-by-token output
  behind a clearly labeled legacy control.
- Let users read earlier content during a live response without being snapped
  back to the bottom.
- Validate the finished behavior with deterministic tests and browser-level
  dogfooding using realistic agent-role messages.

## Non-goals

- Wholesale merging or rebasing Ryco onto upstream `t3code`.
- Replacing Ryco's thread-workspace panel, overview model, transcript deep
  links, timeline minimap, activity folds, or provider registry.
- Introducing a closed enum of agent roles. Provider-native roles remain an
  open string because provider vocabularies can evolve independently.
- Adding a new database table or migrating historical orchestration events.
- Restoring upstream's legacy plan-mode setting; this fork does not need it.
- Extending the frozen `apps/web` phone presentation tier.
- Changing native mobile presentation beyond the shared setting rename and
  required routing/schema compatibility.
- Changing desktop startup, packaging, or release workflows.

## Comparison baseline

The comparison uses upstream stable
[`v0.0.32`](https://github.com/pingdotgg/t3code/releases/tag/v0.0.32) and the
2026-08-10 nightly/main snapshot at
[`9821bca1`](https://github.com/pingdotgg/t3code/commit/9821bca1ceb97f137a9d93f1080fe1954b6641d3).
Ryco and upstream have both changed substantially since their common ancestor,
so each change is selected on behavior and adapted at the relevant boundary.

| Concern | Upstream reference | Ryco state | Decision |
| --- | --- | --- | --- |
| Native subagent/workflow observability | [PR #5219](https://github.com/pingdotgg/t3code/pull/5219) | Core contracts, provider mapping, runtime fold, and Agents panel are already present | Preserve Ryco's port and build on it |
| Stable rows and independent usage updates | [PR #5569](https://github.com/pingdotgg/t3code/pull/5569) | Rows reorder by latest update; one progress record can overwrite usage or activity | Port the event split, `firstSeenAt`, ordering, and row treatment |
| Live subagent count | [PR #5745](https://github.com/pingdotgg/t3code/pull/5745) | Runtime already derives `liveCount`, but workspace entry points do not show it | Adapt the badge to Ryco's header toggle and workspace launcher |
| Claude stop settlement | [PR #5568](https://github.com/pingdotgg/t3code/pull/5568) | `stopTask` can race the terminal notification and leave a live-looking row | Port acknowledged-stop settlement |
| Background-session reaping | [PR #5677](https://github.com/pingdotgg/t3code/pull/5677) | An idle parent session can be reaped while background agents still run | Port the background-liveness guard |
| Claude resume handshake | [PR #5710](https://github.com/pingdotgg/t3code/pull/5710) | An untargeted zero-turn result can publish a phantom completion | Port adapter suppression and ingestion defense |
| Codex queued follow-up interruption | [PR #5762](https://github.com/pingdotgg/t3code/pull/5762) | Accepting a queued turn overwrites the actually active turn id | Port functional session updates and retain the active id |
| Chat live-follow stability | [PR #5566](https://github.com/pingdotgg/t3code/pull/5566) and [PR #5449](https://github.com/pingdotgg/t3code/pull/5449) | `maintainScrollAtEnd` can keep following after the user scrolls away | Adapt the explicit follow latch and compatible list-position safeguards |
| Token-by-token output | [PR #5664](https://github.com/pingdotgg/t3code/pull/5664) | Buffered mode is already the default, but the old setting remains prominent and ambiguous | Rename it to a fresh legacy key and move it behind a collapsed warning |

## Current Ryco architecture

The implementation should continue using the boundaries that already exist:

- Provider adapters emit normalized `task.started`, `task.progress`, and
  `task.completed` runtime events with task linkage.
- `ProviderRuntimeIngestion` projects those events into persisted,
  thread-scoped orchestration activities.
- `packages/client-runtime/src/state/session/subagentRuntime.ts` folds retained
  activities into provider-neutral agents and workflows.
- `AgentsPanel` renders the fleet view, while
  `threadWorkspaceViewModel.ts` and `AgentThreadPanel` render persistent
  transcript tabs.
- `ChatView`, `ChatHeader`, and `ThreadWorkspacePanel` own the workspace entry
  points and panel visibility.
- The setting schema is authoritative in `packages/contracts`, with the server
  selecting streaming or buffered assistant delivery during ingestion.

The event-sourced path remains authoritative. UI components must not create a
parallel role/status store that can disagree after reload or reconnect.

## User decisions

- Use a targeted **parity-plus** approach: copy upstream where it has the
  stronger invariant, adapt it to Ryco where architecture has diverged, and
  retain Ryco-only capabilities.
- Use the **balanced identity** visual treatment: a stable codename is the
  primary identity; the persisted provider role appears beside it; the task or
  workflow phase appears below it.
- Preserve open-string provider roles rather than normalizing them into a
  small product-owned role set.
- Use compact, fixed-structure rows and stable spawn ordering rather than
  reordering the roster around whichever agent just emitted an event.
- Show live counts on entry points, but suppress redundant count badges while
  the Agents surface itself is visible.
- Make token-by-token output a legacy opt-in with an explicit warning and reset
  all existing installations to buffered output through a fresh setting key.
- Protect a user's reading position with an explicit live-follow latch.

## Event and identity architecture

### Persisted task metadata

No database migration is required. Existing task activities already support
the linkage needed for this design, including task id, task type, role, model,
reasoning effort, workflow membership/phase, and provider references.

Provider adapters should populate linkage as early as possible and repeat the
known identity fields on progress and terminal events. Repetition matters
because the retained activity window can eventually evict the original start
event. A later event must never erase known metadata merely because that
specific payload omitted it.

Role handling follows these rules:

- Claude uses the native `subagent_type` value as its role when present.
- Codex uses native `agent_role`; when that is unavailable, the leaf of the
  native agent path remains a fallback.
- Role and task type remain distinct fields even when their text happens to be
  identical.
- Empty or whitespace-only values are treated as absent.
- Unknown values are retained and displayed safely; no role allowlist is
  introduced.
- The client fold only fills missing metadata. It does not overwrite a known
  value with an absent or lower-quality fallback.

Historical events without role metadata remain valid and render without a role
label. New progress or completion events may enrich those rows on the next
fold.

### Shared stable identity

Move the existing abstract codename/avatar derivation out of the transcript-only
view model into one DOM-free client-runtime helper. The helper accepts stable
provider/task identifiers plus optional role and task metadata, and returns a
display model such as:

```ts
interface SubagentIdentity {
  readonly codename: string;
  readonly avatarKey: string;
  readonly role: string | null;
  readonly taskLabel: string | null;
}
```

The codename and avatar derive only from a stable task/agent key, never from
status, usage, timestamp, or list position. The same task therefore keeps the
same identity across:

- the direct-agent roster;
- a workflow's member list;
- a persistent transcript tab;
- reconnect and activity refolds.

Both the fleet model and transcript model consume this helper. The role is
suppressed only when its normalized text duplicates the displayed codename or
another adjacent label; the underlying role remains retained.

### Independent progress and usage snapshots

Progress and usage are separate latest-state streams. Project
`task.progress` events into at most two stable activities:

- `task-progress:<threadId>:<taskId>` contains meaningful task status,
  description, summary, last tool, error, and identity linkage.
- `task-usage:<threadId>:<taskId>` contains `typedUsage`, identity linkage, and
  `usageSnapshot: true`.

The progress activity is emitted when there is meaningful non-usage state, or
when the provider event is itself more than a pure typed-usage tick. The usage
activity is emitted whenever typed usage is present. The split keeps a new
command/reasoning update from erasing the last token count and keeps a pure
usage tick from blanking the last useful activity summary.

Usage snapshots do not force an existing idle, waiting, or terminal task back
to running. The fold may initialize a previously unseen task from a usage
snapshot as a defensive fallback, but once status is known, status transitions
come only from lifecycle-bearing data.

Usage remains monotonic. When snapshots are cumulative, the fold keeps the
greatest known totals rather than allowing an out-of-order or replayed event to
decrease them.

### Stable order and terminal-state rules

Add `firstSeenAt` to the runtime subagent model. It is the earliest retained
observation for the task and does not change when progress, status, or usage
updates. Workflows and direct agents sort by `firstSeenAt`, with stable id as a
tie-breaker. Workflow members use the same deterministic spawn order.

Retention ranking may still prefer recently relevant agents when the safety
cap is exceeded, but agents that survive the cap are displayed in stable spawn
order. Updates must not reshuffle visible rows.

Terminal states are sticky. A late progress or usage event may enrich
metadata, activity text, or counters, but cannot reopen a completed, failed,
stopped, or otherwise terminal task. Provider semantics remain distinct:

- Codex native child agents may become idle and remain addressable.
- Claude task completion is terminal.
- Session death converts truly active work to interrupted/stopped state, but
  does not rewrite a valid Codex idle state as a failure.

## Provider lifecycle and recovery

### Claude acknowledged stops

When a parent turn is interrupted, stop live Claude tasks concurrently with
the existing bounded per-task and overall timeouts. A successful `stopTask`
acknowledgement becomes authoritative for local durable state:

1. Remove the task from the adapter's live-task set only after acknowledgement.
2. Emit `task.completed` with status `stopped` and all known task linkage.
3. Continue the parent interrupt path without waiting indefinitely for the
   separate provider notification.

Timeouts, thrown calls, duplicate acknowledgements, and already-settled task
ids are ignored safely. A later native terminal notification remains
idempotent and cannot reopen the task.

### Claude resume handshakes

A Claude result received with no locally active turn must still contribute any
usage information, but must not emit an untargeted `turn.completed`. Real turns
receive turn state when sent, and out-of-turn assistant content already has a
synthetic-turn path. A zero-turn resume handshake therefore cannot legitimately
complete the next pending turn.

Log a structured `claude.turn.result-without-active-turn` diagnostic with
non-sensitive status metadata so future SDK behavior remains observable.

Ingestion adds a second defense: when no active turn is tracked, it accepts a
completion only if that event names a turn id. When an active turn is tracked,
the completion must continue to match it. This protects lifecycle state even
if another adapter later emits an ambiguous completion.

### Codex queued follow-ups

Codex may accept a follow-up while the current turn is still running and
return the queued turn's id. Updating a session from that response must retain
the existing active turn id:

```ts
activeTurnId: session.activeTurnId ?? acceptedTurnId
```

Allow the session update helper to compute its patch from the current session
inside the atomic update. This avoids a stale read/update race.

Interruption continues to stop active child agents first, then interrupts the
actual active parent turn. The queued id becomes active only when provider
lifecycle events establish that transition.

### Background-aware session reaping

The provider session reaper must skip an otherwise idle session whenever the
thread has non-null `backgroundLiveness`. Background fleets, workflows, and
monitor loops live inside the provider process and may not update the parent's
ordinary `lastSeenAt` between turns.

Emit a debug-level skip event with thread id, liveness classification, and idle
duration. Existing reaper eligibility applies again after background liveness
clears.

### Partial streams, replay, and reconnect

- Identity linkage is additive and survives partial payloads.
- Stable activity ids make progress and usage replays idempotent.
- Late usage can update totals without changing status.
- Late terminal events settle active rows; late non-terminal events cannot
  reopen them.
- Missing roles render as absent rather than guessed UI copy.
- Reload derives the same codename, role, order, workflow membership, and
  terminal state from persisted activities.

## Agents and workflow UI

### Roster rows

Use one calm, fixed three-line structure for direct agents and workflow
members:

1. Stable avatar/codename, status indicator, and compact timing/usage metadata.
2. Persisted role beside the identity, plus task type or workflow phase when it
   adds information.
3. The latest task summary or current tool, truncated to one stable line.

The layout uses Ryco's existing typography, spacing, radii, and semantic
colors. It should read as a dense operational roster, not a collection of
nested cards. Use subtle separators and reserved metadata space so changing
token counts or status text does not change row height.

Status motion stays small and local to the icon/codename. Running can use the
existing restrained activity motion; waiting uses a slower treatment; settled
states are static. Honor reduced-motion preferences.

Role text uses a quiet badge or inline label. It is visible enough to scan but
does not compete with the codename. Provider names and workflow phase labels
should not repeat the same normalized text in adjacent positions.

### Workflow groups

Workflow groups use the same stable first-seen order as direct agents.
Expansion state is keyed by stable workflow id, not by array index or live
status. A member update, live/settled transition, usage tick, or reconnect must
not collapse the group or move it unexpectedly.

The workflow header summarizes running, waiting, idle, and settled membership
without hiding the member roles. Individual members keep their stable row
identity and remain directly openable in transcript tabs.

### Live-count discoverability

The existing `agentPanelModel.liveCount` remains defined as running/pending plus
waiting agents; idle Codex children do not inflate the urgent live count.

Show this count in two Ryco-specific entry points:

- the chat-header workspace/Agents toggle;
- the Agents card in the empty workspace launcher.

Suppress the header badge while the Agents surface is already visible because
the count and roster are then directly in view. Use tabular numerals, an
accessible label containing the full count, and a compact visual cap if large
numbers would distort the control. The actual accessible value remains exact.

### Transcript tabs

Transcript tabs consume the same shared identity model as the roster. The tab
and panel header show the stable codename as primary, the persisted role beside
it, and task/workflow context below where space allows. Opening, closing, or
reopening a tab does not change identity, and closing a tab never stops the
underlying task.

Ryco's existing transcript deep links, script RPC retries/timeouts, and
summary-only fallback remain intact.

### Accessibility and responsive boundaries

- Agent rows and workflow disclosures remain keyboard accessible with accurate
  `aria-expanded`, status, and count labels.
- Truncated task text remains available through an accessible name or tooltip.
- Status is never communicated by color alone.
- Focus treatment uses existing Ryco primitives and remains visible on the
  dark and light themes.
- Desktop and supported tablet widths must avoid overlap and horizontal
  scrolling.
- Do not add behavior to the frozen web phone tier. Native mobile continues to
  consume the shared runtime safely without receiving this desktop roster
  redesign.

## Legacy token streaming

Rename the server setting from `enableAssistantStreaming` to
`enableLegacyTokenStreaming`, defaulting to `false`.

This is intentionally a fresh schema key. Decoding an existing settings file
does not alias or migrate the old key, so previous opt-ins reset to the
buffered default. Settings patches, optimistic routing, RPC snapshots, test
fixtures, reset summaries, and ingestion reads all use the new name.

Buffered delivery continues to collect assistant deltas and publish complete
chunks at the existing flush boundaries. Tool events, reasoning/activity
state, subagent state, and other live orchestration updates remain live; only
the assistant text painting mode changes.

In General settings:

- Remove the prominent `Assistant output` row.
- Add a collapsed `Legacy features` section near the bottom of the page.
- Add a searchable `Stream token by token (legacy)` row inside it.
- Automatically unfold the section when settings search targets that row.
- Explain that token-by-token painting is slower and harder to read for long
  responses.
- Disabling is immediate.
- Enabling requires the existing cross-platform confirmation dialog; canceling
  leaves the setting off.
- Reset-all uses the new buffered default.

The fork does not add upstream's retired plan-mode row just to mirror the
section. A one-row legacy section is preferable to restoring unrelated
functionality.

## Chat live-follow and list stability

Upgrade the web app's `@legendapp/list` dependency to the upstream-tested
`3.3.3` behavior while leaving the separately patched native-mobile version
untouched.

`ChatView` owns an explicit live-follow latch for the selected thread:

- Entering a thread at its live end starts with follow enabled.
- Sending a new user message deliberately returns to and follows the live end.
- Reaching the end through user scrolling re-enables follow.
- Scrolling away from the end disables follow immediately.
- New deltas, agent activities, usage snapshots, fold timers, and completion
  events never re-enable it by themselves.
- `maintainScrollAtEnd` behavior is active only while the latch is enabled.

`MessagesTimeline` continues reporting whether the viewport is at the end, but
that observation does not conflate content-driven movement with user intent.
Use the current list API's visible-content-position/size restoration behavior
where compatible so expanding an activity fold, workflow detail, or message
row preserves the visible anchor rather than jumping the viewport.

Existing thread-switch restoration, minimap navigation, search targeting,
copy/revert actions, and persisted tool-detail expansion remain unchanged.

## End-to-end data flow

1. A provider starts a child task or workflow member and records native role,
   task type, model/effort, hierarchy, and provider references.
2. The adapter emits normalized task events, repeating known linkage on later
   events and using provider-specific lifecycle semantics.
3. Ingestion persists bounded, idempotent start/progress/usage/terminal
   activities; usage has its own stable record.
4. The client runtime folds those activities with additive metadata,
   monotonic usage, sticky terminals, and a stable `firstSeenAt`.
5. A shared identity resolver derives the same codename/avatar/role model for
   the fleet and transcript surfaces.
6. `ChatView` derives one agent-panel model, passes counts to entry points, and
   renders fixed, stable rows through the workspace panel.
7. Reconnect or replay repeats the same fold deterministically without
   reordering rows, losing roles, reopening tasks, or moving the chat viewport.

## Performance and observability

- Keep one stable latest-state activity for progress and one for usage per task
  rather than appending every tick.
- Continue bounding recent per-agent activity and total retained roster size.
- Memoize shared identity from stable inputs; do not hash or allocate from live
  usage/status on every render.
- Fixed row height and stable keys let virtualization reuse measurements.
- Use tabular numerals and reserved space to reduce layout churn from timers
  and token counts.
- Avoid a global once-per-second roster render; reuse existing localized timer
  behavior.
- Add structured diagnostics only for exceptional lifecycle decisions:
  acknowledged Claude stops, result-without-turn, and background-reaper skips.
- Do not log prompts, assistant text, provider credentials, or private hosted
  infrastructure data.

## Testing and validation

### Contract and client-runtime tests

- Old `enableAssistantStreaming` input is ignored and decodes to the new
  buffered default.
- The new setting decodes, patches, resets, routes optimistically, and survives
  server-state snapshots.
- Role/task metadata survives progress and terminal events that omit fields.
- Pure usage snapshots do not overwrite recent activity or force status to
  running.
- Progress snapshots do not erase typed usage.
- Out-of-order usage cannot decrease cumulative totals.
- Late progress cannot reopen terminal agents.
- `firstSeenAt` and stable-id tie breaking keep direct agents, workflows, and
  members in spawn order.
- The identity helper returns the same codename/avatar/role across fleet and
  transcript callers.

### Server and provider tests

- Ingestion emits independent thread-scoped progress and usage activities and
  preserves identity linkage in both.
- Buffered output remains the default; the legacy key selects streaming mode.
- A successful Claude stop acknowledgement emits a durable stopped task once.
- Claude stop timeout, rejection, duplicate settlement, and late terminal
  notification remain safe.
- A Claude zero-turn resume result contributes usage without completing a
  pending turn.
- Ingestion rejects untargeted completions when no active turn exists and
  still accepts a real named completion whose start event was lost.
- Codex queued follow-up acceptance retains the current active turn id, and
  interruption targets that id after stopping active children.
- The session reaper skips non-null background liveness and becomes eligible
  again after it clears.

### Web component and browser tests

- Agent and workflow-member rows keep fixed structure and order while status,
  summary, usage, and terminal events update.
- Workflow expansion survives child updates and rerenders.
- Role labels are shown, duplicate adjacent labels are suppressed, and missing
  roles do not leave awkward empty chrome.
- The header and launcher show the same live count; the header badge disappears
  while Agents is visible.
- Roster and transcript tabs show the same identity.
- Settings search unfolds the legacy section and focuses the token-streaming
  row.
- Enabling legacy streaming requires confirmation; cancel, confirm, disable,
  and reset-all paths work.
- Scrolling up during a live response keeps the viewport anchored as new text
  and activities arrive.
- Returning to the end re-enables follow, and sending a message intentionally
  returns to live follow.
- Expanding/collapsing activity content preserves the visible anchor.
- Existing minimap, search targeting, transcript deep links, and list
  restoration continue to work.

### Browser dogfooding

Use the `agent-browser` core and dogfood workflows against a locally running
web build. Exercise a real provider session when local credentials and native
subagent support are available; otherwise use the deterministic browser
fixture/harness and report that limitation explicitly.

Controlled test messages should cover:

1. Ask a parent to create three bounded children with explicit implementer,
   reviewer, and verifier roles and distinct tasks.
2. While one child remains active, send a queued follow-up and verify the
   parent and child rows do not flicker, reorder, or lose roles.
3. Open each child transcript from the roster and compare identity and role.
4. Expand a workflow, wait for usage/progress updates, reconnect the client,
   and confirm expansion, order, usage, and terminal states remain coherent.
5. Stop the active fleet and verify every acknowledged Claude child settles
   while a Codex idle child retains its valid idle semantics.
6. Generate a long response, scroll upward during output, and verify the
   viewport stays put until the user returns to the end.
7. Toggle the legacy setting through cancel/confirm/disable flows and compare
   buffered versus token-by-token painting.

Inspect both light and dark themes at representative desktop widths. Check
hierarchy, truncation, focus, reduced motion, count alignment, workflow
indentation, and row-height stability. Do not extend or qualify the frozen web
phone tier as part of this pass.

### Repository validation

Use the pinned Bun version and install dependencies before validation:

```sh
bun install --frozen-lockfile
```

Run focused tests throughout implementation. Because the final change crosses
contracts, provider/session lifecycle, orchestration, shared client state, web
interaction, and mobile settings routing, run the full repository backstop:

```sh
bun fmt
bun run fmt:check
bun lint
bun typecheck
bun run test
bun run build
```

Because this is a high-risk web interaction and virtualization change, also
run:

```sh
bun run build --filter=@ryco/web
bun run --cwd apps/web test:browser
```

Install the pinned Playwright runtime first with
`bun run --cwd apps/web test:browser:install` if it is not already available.
No desktop build or release smoke test is required because those pipelines are
not changed.

## Acceptance criteria

- A Claude or Codex agent keeps one stable codename/avatar across the roster,
  workflow group, transcript tab, updates, and reconnect.
- Provider role/type information is retained when supplied and remains visible
  next to the codename without redundant labels.
- Direct agents, workflows, and members remain in deterministic spawn order.
- Progress and usage can update independently without losing information or
  changing lifecycle incorrectly.
- Terminal tasks never reopen from late progress or usage.
- Acknowledged Claude stops settle durably; resume handshakes do not complete
  phantom turns; Codex queued follow-ups do not replace the active turn id.
- Background work prevents session reaping until its liveness marker clears.
- Live agent counts appear at the chat-header and launcher entry points and are
  suppressed when redundant.
- The Agents panel has polished, fixed-structure rows with stable expansion and
  no distracting layout churn.
- Buffered assistant output is the default for every installation, including
  previous streaming opt-ins; token-by-token output is discoverable only as a
  warned legacy option.
- Scrolling away from the end during live output prevents automatic snapping
  until the user deliberately returns.
- Ryco-specific workspace, transcript, minimap, activity-fold, hosted
  lifecycle, and mobile boundaries remain intact.
- Focused tests, the repository backstop, the web build/browser suite, and the
  documented browser dogfood scenarios pass, with any unavailable real-provider
  coverage reported explicitly.
