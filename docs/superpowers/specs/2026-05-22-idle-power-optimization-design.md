# Idle Power Optimization Design

## Goal

Reduce Ryco's Mac power use when the app is open with no active agent turn. In
this state, Ryco should not keep waking the CPU, GPU, network, or provider CLIs
for speculative background work.

The target idle state is "no active turn." A warm thread may still be selected,
the browser client may still be connected, and a project may still be open, but
there is no provider turn currently running or waiting for user input.

## Observed Symptoms

Activity Monitor can understate the problem when only the parent app is watched.
Ryco's power cost can sit in child or helper processes:

- Electron renderer and GPU helper processes can wake for timers, animation, and
  layout work even when the server process looks quiet.
- Provider child processes such as `codex app-server`, Claude, or other agent
  runtimes can remain alive after a turn finishes.
- Git remote fetches and provider health probes can wake the network stack and
  credential helpers without showing as sustained high CPU.

The current live measurement was contaminated by an active Codex turn, so it is
not a valid idle baseline. It still confirmed the process-shape issue: provider
children and Electron helpers must be measured separately from the parent Ryco
process.

## Upstream Review

`upstream/main` from `pingdotgg/t3code` is 57 commits ahead of this branch. The
relevant upstream commits are not a single clean idle-power patch, but several
targeted fixes are directly applicable:

- `8da08596` / `038e209e`: background activity policy and host power monitoring.
- `6d184f06`: fixes explicit background activity override handling and extracts
  settings utilities.
- `34ec8a86`: configurable automatic Git fetch interval.
- `4120e945`: back off VCS remote refresh failures.
- `90eea047`: skip healthy environment reconnects after browser resume.
- `2ba58076`: avoid chat timeline timer rerender commits.
- `a41f4895`: reduce chat timeline activity rerenders.
- `061d289d` / `d6df6c87`: reconnect countdown rerender fixes.
- `4b87dbf7`: stabilize root app shell renders.

The implementation should backport or adapt these pieces selectively. A broad
merge of all 57 commits is out of scope for this performance fix because it
would mix unrelated product and migration risk into an idle-power change.

## Scope

In scope:

- Stop or sharply reduce recurring background work when there is no active turn.
- Add a server-side idle/background policy for provider and VCS work.
- Shorten the lifetime of warm provider runtime processes after their active
  turn completes.
- Make Git remote refresh configurable and back off failures.
- Prevent Git fetches from invoking interactive credential prompts.
- Remove frontend idle timers that wake every second without visible work.
- Backport targeted upstream rerender and reconnect fixes where the local code
  still has the same behavior.
- Add tests around the new scheduling and reaping behavior.
- Add a repeatable local measurement checklist.

Out of scope:

- Merging all 57 upstream commits.
- Replacing the Codex app-server architecture.
- Changing provider protocols.
- Removing local Git status entirely.
- Adding broad telemetry or remote analytics.
- Guaranteeing zero Electron/GPU wakeups; the goal is to remove avoidable Ryco
  work and make remaining activity explainable.

## Design

### 1. Define idle work policy on the server

Add a small background activity policy in `apps/server` that distinguishes:

- `activeTurn`: work required for a currently running provider turn.
- `foregroundDemand`: work requested by a visible/connected client view, such as
  an explicit refresh, settings panel, provider picker, or user Git action.
- `opportunistic`: work that is nice to have but not required while idle, such
  as provider health probes and remote ahead/behind refresh.

When there is no `activeTurn`, opportunistic work should either stop, run on a
much longer interval, or require an explicit foreground demand lease.

This can be implemented as a small local service rather than a full framework:

- Track active provider turns from existing provider/session lifecycle events.
- Track client demand from existing WebSocket subscriptions where possible.
- Keep default behavior conservative: local read-only status may remain fresh,
  but network and process-spawning background work should not run continuously.

### 2. Gate provider refresh loops

`apps/server/src/provider/makeManagedServerProvider.ts` currently starts a
forever refresh loop. Provider drivers pass a five-minute refresh interval. That
is still enough to keep CLIs and environment checks alive over a long idle
session.

Change provider refresh scheduling so it:

- Refreshes immediately when the provider list/settings UI needs fresh data.
- Refreshes during an active turn if the provider requires it.
- Does not keep probing provider executables in the background just because the
  app is open.
- Uses a long, configurable fallback interval only if a future UI requirement
  needs passive freshness.

Provider availability should degrade predictably: stale availability can be
shown as stale and refreshed on demand instead of being maintained by hidden
polling.

### 3. Reap warm provider sessions sooner

`ProviderSessionReaper` currently allows warm provider runtimes to remain alive
for up to 30 minutes and sweeps every five minutes. For "no active turn" idle,
that is too long.

Change the policy to:

- Never reap a provider session with an active turn.
- Reap no-active-turn warm runtimes after a short grace period, initially two to
  five minutes.
- Keep the threshold configurable through server settings or an internal config
  constant so it can be tuned after measurement.
- Preserve restart/resume behavior so sending the next message starts a fresh
  provider runtime predictably.

This trades a small delay on the next turn for much lower idle process and
memory pressure.

### 4. Make VCS remote refresh demand-aware

`VcsStatusBroadcaster` currently has a 30-second refresh interval, and
`GitVcsDriverCore` has a 15-second upstream refresh threshold for remote status.
Because multiple UI components subscribe to Git status, an idle selected thread
can keep a remote poller alive.

Change VCS behavior so:

- Local status can still refresh for visible UI and after Git mutations.
- Remote fetch/ahead-behind refresh is disabled or slowed when there is no
  active turn and no explicit user demand.
- The automatic fetch interval is configurable, adapting upstream `34ec8a86`.
- Remote refresh failures back off, adapting upstream `4120e945`.
- Git fetch runs non-interactively with `SSH_ASKPASS_REQUIRE=never` and related
  environment hardening so it cannot wake UI credential prompts.
- Explicit user actions such as pressing a refresh button, opening publish
  controls, or completing a provider turn can request a one-shot remote refresh.

Remote branch metadata may be stale while idle. The UI should tolerate that by
showing cached values and refreshing on demand.

### 5. Remove frontend idle wakeups

The web app should not commit React renders every second unless something
visible is actively changing.

Targeted changes:

- `GitActionsControl` should only install its one-second progress toast interval
  while a Git action is actively reporting progress.
- Chat timeline elapsed-time labels should update without forcing whole React
  subtree commits, adapting upstream `2ba58076` where applicable.
- Streaming/activity timeline renders should avoid broad invalidation, adapting
  upstream `a41f4895` where applicable.
- WebSocket reconnect countdowns should avoid unnecessary interval-driven
  rerenders, adapting upstream `061d289d` and `d6df6c87`.
- Browser-resume reconnect logic should skip reconnecting healthy connections,
  adapting upstream `90eea047`.
- Root app shell render stabilization from upstream `4b87dbf7` should be
  reviewed and adapted if the same render churn exists locally.

Timers that are required only for active turn UI should be mounted only while
that active state exists.

### 6. Add diagnostics for verification

Add lightweight development diagnostics rather than permanent telemetry:

- Log or expose current background leases and active provider turns in dev.
- Make VCS remote refresh attempts observable in logs at debug level.
- Make provider runtime reaping decisions log enough context to verify why a
  runtime was stopped or kept.

These diagnostics should not create new idle intervals.

## Implementation Plan

1. Add the server idle/background policy abstraction and unit tests.
2. Gate provider refresh loops behind that policy.
3. Shorten and configure no-active-turn provider runtime reaping.
4. Adapt upstream Git fetch interval, remote backoff, and non-interactive fetch
   environment changes.
5. Gate VCS remote refresh with the idle policy and explicit demand paths.
6. Remove unconditional frontend one-second intervals.
7. Adapt upstream timeline/reconnect/render fixes that apply cleanly.
8. Add diagnostics and measurement documentation.
9. Run formatting, linting, typechecking, focused tests, and manual idle
   measurement.

## Tests

Add focused tests for:

- Provider refresh loops do not run while there is no active turn or foreground
  demand.
- Provider refresh runs when explicit foreground demand is present.
- Provider sessions with active turns are not reaped.
- Warm provider sessions without active turns are reaped after the shorter
  threshold.
- VCS remote refresh does not fetch repeatedly while idle.
- VCS remote refresh backs off after failures.
- Git fetch uses non-interactive environment variables.
- `GitActionsControl` does not install a progress interval when no action is in
  progress.
- Reconnect logic skips healthy connections after browser resume.

Use `bun run test` for test execution. Do not use `bun test`.

## Verification

Before implementation is considered complete:

- `bun fmt`
- `bun lint`
- `bun typecheck`
- Focused `bun run test` suites for the changed modules.

Manual idle measurement:

1. Start Ryco and open a project.
2. Finish or cancel all provider turns.
3. Wait longer than the new provider idle grace period.
4. Confirm no provider runtime child process remains for that idle thread.
5. Sample the Ryco process tree, including Electron renderer, GPU helper,
   server, and provider children.
6. Confirm no recurring Git fetch process appears without explicit demand.
7. Confirm renderer wakeups drop when no active turn or progress toast exists.

Useful commands:

```sh
ps -axo pid,ppid,stat,pcpu,pmem,etime,command | rg -i 'Ryco|ryco|codex|claude|opencode|cursor|bun|node|git'
top -l 1 -o power -stats pid,ppid,command,cpu,power
```

## Risks

- Reaping warm provider sessions sooner can make the next message pay startup
  cost. The grace period should be short but not instant.
- Slowing or disabling idle remote fetch can make ahead/behind counts stale.
  Explicit refresh and post-turn refresh should keep the UX predictable.
- Upstream code may use different package names and structure, so targeted
  adaptation is safer than raw cherry-picks.
- If Electron/GPU remains hot after server and timer fixes, a second pass should
  profile visible animations, canvas/WebGL work, and layout churn.

## Self-review Notes

- The design keeps behavior tied to the user-defined idle state: no active turn.
- Active turns are protected from reaping and throttling.
- Network/process-spawning work is prioritized over purely local cached reads.
- The plan avoids a broad upstream merge while still using the upstream commits
  that directly address power, timers, reconnects, and VCS polling.
- The verification plan separates valid idle measurement from measurements taken
  during an active Codex turn.
