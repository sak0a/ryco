# Source-Control Refresh and Active-Status Motion Design

Date: 2026-08-16

## Summary

Ryco will add a user-selectable refresh policy for pull-request and workflow data, backed by one
shared client-side coordinator. The coordinator will deduplicate polling across Overview and
Project Explorer, adapt cadence to post-push discovery and active workflow states, pause outside the
foreground lifecycle, and stop timers when work settles.

Active session presentation will use a persistent semantic signal: a stable colored dot with a
continuous halo plus a continuously moving color wave inside active status text. Waiting and
terminal states remain static. This restores an unmistakable working signal without restoring
continuous motion to every status element or allowing hidden tabs to repaint.

## Goals

- Give users a clear `Automatic`, `Reduced`, or `Manual` policy for PR and workflow refreshes.
- Make `Automatic` the default and preserve fast workflow discovery after a push.
- Guarantee one timer and one in-flight request for each canonical source-control query, regardless
  of how many UI surfaces consume it.
- Stop polling when the owning data is unobserved, hidden, offline, or no longer refreshable.
- Keep cached data readable during failures and lifecycle transitions.
- Make active sessions visibly alive at all times while preserving semantic colors and accessible
  status text.
- Preserve reduced-motion behavior and bound continuous animation to active, visible elements.
- Extend performance validation to an active PR/workflow surface rather than relying only on an
  idle pairing-route observation.

## Non-goals

- Moving source-control monitoring to a server-owned daemon or webhook service.
- Adding GitHub-specific authentication, webhook registration, or persistent monitoring while no
  client observes a surface.
- Combining remote Git status polling with PR/workflow refresh policy.
- Exposing arbitrary millisecond interval inputs.
- Animating user-blocked or terminal statuses.
- Changing source-control result contracts or provider semantics beyond an optional typed retry
  hint when a provider can supply one safely.

## Current behavior

Ryco already has a lifecycle-aware poller that completion-schedules one timer, joins an overlapping
refresh, cancels timers when the app backgrounds, and refreshes once on foreground, resume, or
online events. Overview and Project Explorer use that mechanism, but they keep separate query
controllers and can issue equivalent source-control requests independently.

Current source-control cadences include:

- post-push workflow discovery every 10 seconds for at most 90 seconds;
- active workflow and active job refresh every 30 seconds;
- open pull-request detail refresh every 30 seconds in Overview;
- workflow and pull-request list refresh every 30 seconds while refreshable checks exist;
- Git branch refresh every 60 seconds while the branch surface is observed.

The existing `Git status polling` setting controls the server's remote repository status stream. It
defaults to Off and does not control workflow-run or job-detail polling.

Status pulses and text shimmers currently use a six-second duty cycle to reduce repaint work. That
cadence can look inactive during the long hold even though the session is still working.

## User settings

Add a local client setting:

```ts
type SourceControlRefreshMode = "automatic" | "reduced" | "manual";
```

The schema default is `automatic`. The field is added to `ClientSettingsSchema`,
`ClientSettingsPatch`, default settings, decoding tests, local persistence tests, and the settings
reset path. Existing settings decode to `automatic` without a migration.

General settings will contain two adjacent, clearly separated controls:

1. Rename `Git status polling` to `Remote Git status`. Its stored field and behavior remain
   unchanged.
2. Add `PR & workflow updates` with `Automatic`, `Reduced`, and `Manual` options.

The new control describes behavior, not raw intervals:

- **Automatic:** fast after push, normal cadence while active, and no timer after settlement.
- **Reduced:** slower discovery and active cadence, with the same lifecycle and settlement rules.
- **Manual:** initial load plus explicit and mutation-triggered refreshes; no background timer.

Every consuming PR/workflow surface retains an explicit Refresh action, including Automatic mode.

## Shared refresh coordinator

### Ownership

Add a web source-control refresh coordinator under `apps/web/src/rpc/`. It is the authoritative owner
of refresh scheduling and the latest snapshot for the PR/workflow operations in this design. It
uses the injected app lifecycle and clock/timer dependencies; it does not read `document` directly.

Overview and Project Explorer become adapters over the same coordinator rather than independent
polling owners. Existing atom-facing hooks may preserve their public return shapes during the
transition, but they receive snapshots and refresh state from the coordinator.

### Canonical keys

Each entry is keyed from stable, normalized fields:

```text
environmentId + cwd + operation + pr/branch/commit/run identity + result-shaping arguments
```

Operations in scope are:

- change-request list when it is used to surface refreshable checks;
- change-request detail;
- workflow-run list;
- workflow-run jobs.

Searches, logs, diffs, labels, assignees, and unrelated source-control reads stay request-on-demand.
Remote Git status remains owned by `VcsStatusBroadcaster` and the existing setting.

Canonicalization must ensure Overview and Project Explorer produce the same key for semantically
identical requests. Result-shaping arguments such as limit belong in the key unless the coordinator
can safely satisfy the smaller request from a larger canonical result.

### Entry state

Each coordinator entry owns:

- latest data, error, and fetch timestamp;
- subscriber callbacks and reference count;
- one in-flight promise;
- one completion-scheduled timer;
- request generation;
- current refresh classification;
- consecutive transient failure count and next eligible refresh time;
- optional post-push discovery deadline and commit identity.

The first subscriber creates the entry and performs the initial fetch. Later subscribers receive
the latest snapshot immediately and share the same request. The last unsubscribe cancels the timer
and permits bounded idle eviction. In-flight work may finish, but generation checks prevent a stale
or released entry from publishing into a newer generation.

### Data flow

1. A UI adapter retains a canonical entry and subscribes to its snapshot.
2. The coordinator immediately returns cached state and fetches when data is absent or stale.
3. A successful response replaces the canonical snapshot and notifies all subscribers.
4. The domain classifier inspects the response and chooses the next cadence or `false`.
5. The coordinator completion-schedules the next timer only while observed and foregrounded.
6. Push, rerun, merge, review, and related mutations invalidate the affected canonical keys and
   request one shared refresh.
7. Explicit Refresh joins an existing request or starts one immediately.

## Refresh policy

The policy is a pure function of mode, lifecycle, reason, post-push discovery state, workflow/PR
classification, failure state, and current time.

| State                           |      Automatic |        Reduced |         Manual |
| ------------------------------- | -------------: | -------------: | -------------: |
| Initial observed load           |      immediate |      immediate |      immediate |
| Post-push workflow discovery    |     10 seconds |     30 seconds |       no timer |
| Discovery deadline              |     90 seconds |     90 seconds |            n/a |
| Pending/running workflow or job |     30 seconds |     60 seconds |       no timer |
| Settled workflow/checks         |       no timer |       no timer |       no timer |
| Hidden/background/offline       |       no timer |       no timer |       no timer |
| Explicit or mutation refresh    | immediate/join | immediate/join | immediate/join |

When a post-push commit is discovered, the coordinator leaves discovery cadence and classifies the
actual workflow state. When the 90-second deadline expires without discovery, it stops the timer
and leaves Refresh available instead of polling indefinitely.

Returning to foreground, resuming, or reconnecting performs one refresh in Automatic and Reduced
mode only when the snapshot is stale or was invalidated. Manual mode does not turn lifecycle events
into implicit refreshes.

## Failure and rate-limit behavior

- Requests for the same canonical key never overlap.
- Existing data remains visible while a refresh is pending or fails.
- A late response cannot overwrite a newer generation.
- Transient failures use exponential backoff from the policy's current base interval, capped at
  five minutes, with bounded jitter.
- A typed provider retry hint takes precedence when available. The coordinator does not parse or
  persist credentials, response bodies, or private operational details to infer a retry time.
- Offline transitions cancel timers without counting as failures.
- Terminal provider/configuration errors stop automatic retry and remain manually refreshable.
- A successful request resets the failure counter and returns to state-derived cadence.

## Active-status motion

### Semantic mapping

Motion communicates active progress only:

- Active: working, connecting, generating, monitoring, and active review.
- User-blocked: awaiting input, pending approval, and plan ready.
- Terminal: completed, failed, cancelled, interrupted, and stopped.

Active working states use blue semantic colors. Active review uses amber. User-blocked and terminal
states retain their existing semantic colors but remain static.

### Visual primitives

Replace the generic duty-cycled status treatment with explicit primitives:

1. **Activity signal:** a stable colored core plus a continuous 1.8-second expanding halo. The halo
   uses transform and opacity only.
2. **Active text wave:** readable tinted base text with a narrower brighter semantic-color crest
   moving continuously through the glyphs on a 2.35-second linear loop. A highlight is always
   present somewhere in the text; there is no long hold or fully static phase.
3. **Compact breathe:** icons that cannot render a halo use a subtle continuous scale/opacity
   breathe rather than the old six-second pulse.

The session/status component decides whether a state is active. Callers should not infer activity by
concatenating animation classes independently.

### Performance and accessibility boundaries

- Continuous text flow is restricted to active, visible status text; it is not applied to completed
  rows, generic body text, or hidden panels.
- The animated text is an inline-sized paint boundary so its invalidation area does not span the
  full row.
- The document hidden attribute pauses halo, text-wave, and compact-breathe animations.
- Stored reduced-motion preference and `prefers-reduced-motion` disable animation and render a
  clear static semantic color.
- Status meaning remains present in normal text and accessibility labels; animation is never the
  only signal.
- Performance tests must measure continuous text flow with several simultaneous active rows. If it
  exceeds the agreed frame/task budget, implementation may optimize the rendering technique but
  must preserve the approved always-present moving crest.

## Cache and lifecycle bounds

Coordinator snapshots are bounded by entry count and idle lifetime. Start with the existing
source-control controller constraints as the ceiling: no more than 192 entries, with operation-
specific shorter idle lifetimes for large job payloads. Eviction cancels timers, invalidates the
entry generation, removes listeners, and releases the retained snapshot.

The coordinator does not poll without subscribers. Multiple subscribers to the same key only raise
the reference count; they do not create more timers or requests. Background and offline transitions
clear scheduled timers synchronously. Foreground scheduling remains completion-based so slow
requests cannot cause timer accumulation.

## Validation

### Unit and integration tests

- Settings schema, default, patch, persistence, reset, and backward-compatible decoding.
- Canonical key parity between Overview and Project Explorer.
- Two subscribers produce one initial request, one timer, and one shared result.
- Explicit and mutation refreshes join in-flight work.
- Automatic, Reduced, and Manual cadence with fake clocks.
- Post-push discovery success and 90-second expiry.
- Active-to-settled transition cancels the next timer.
- Hidden/offline cancellation and stale foreground refresh.
- Transient backoff, typed retry hints, terminal failure stop, and reset after success.
- Generation protection and idle eviction.

### Browser and visual tests

- Active working and review states receive the halo and continuous semantic wave.
- A wave crest remains present throughout the animation cycle.
- User-blocked and terminal states receive no animation.
- Compact pulsing call sites use the continuous breathe treatment.
- Hidden documents pause all relevant animations.
- Stored and OS reduced-motion settings render static semantic indicators.
- Multiple active rows stay within the status-animation performance budget.

### External performance scenario

Extend the external harness with an active source-control scenario. CI uses deterministic local
source-control fixtures; optional local runs may target a user-supplied repository without writing
credentials or private identifiers into artifacts.

The scenario records:

- foreground request count and cadence during post-push discovery and active checks;
- zero hidden polling;
- zero timer-driven requests after settlement;
- deduplication when Overview and Project Explorer observe the same key;
- foreground task time, long tasks, heap, and process-tree RSS;
- continuous status-motion task/frame cost with several active sessions.

## Rollout sequence

1. Add settings schema/default/UI and rename the existing label.
2. Implement and test the canonical coordinator and pure refresh policy.
3. Migrate Overview PR/workflow reads.
4. Migrate Project Explorer PR/workflow reads and remove superseded poll ownership.
5. Add explicit Refresh actions where a surface lacks one.
6. Implement semantic activity primitives and migrate active status call sites.
7. Add browser/performance coverage and the active source-control harness scenario.
8. Run focused validation after each boundary, then the web/browser and external backstops because
   the final change crosses settings, source-control lifecycle, and visual-motion behavior.

## Acceptance criteria

- Automatic is the default for existing and new users.
- Overview and Project Explorer never issue duplicate concurrent requests for an identical
  canonical PR/workflow query.
- Automatic uses 10-second discovery and 30-second active cadence; Reduced uses 30/60 seconds;
  Manual schedules no timer.
- No PR/workflow timer runs while hidden, offline, unobserved, or settled.
- Mutation and explicit refresh behavior remains immediate and request-joined.
- Working/review states show a continuous halo and always-present moving semantic text crest.
- User-blocked and terminal states remain static and readable.
- Reduced-motion and hidden-document behavior remain correct.
- The external active-source-control scenario confirms request bounds and introduces no material
  long-task, heap, or RSS regression.
