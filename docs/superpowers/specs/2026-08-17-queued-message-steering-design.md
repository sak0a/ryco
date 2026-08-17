# Queued Message Steering Design

## Context

Ryco already treats follow-up submission as queue-first behavior:

- `apps/web` keeps an in-memory queue per scoped thread, captures the complete composer/settings
  snapshot, and sends one queued entry whenever the thread becomes idle.
- `apps/mobile` persists existing-thread follow-ups in its outbox and drains them after reconnect or
  after the active turn settles.

Neither client can promote one of those queued entries into the active turn. Codex app-server exposes
that operation as `turn/steer`: it appends input to the current in-flight turn, requires the exact
`expectedTurnId`, does not create a new turn, and does not accept turn-level overrides. Synara exposes
the same distinction as queue-by-default plus an explicit Steer action on each queued row.

This design adopts that interaction without copying Synara's server-owned durable queue. Ryco keeps
its existing queue owners and adds a provider-neutral steer path through contracts, orchestration,
the provider service, and capable adapters.

## Goals

- Keep Queue as the fixed default for every composer submission made while a turn is running.
- Let a user explicitly promote an already queued entry into the current active turn.
- Support desktop/web and the native mobile app with shared policy and command-building logic.
- Use only verified native provider steering. The first implementation supports Codex.
- Reject stale-turn races with an exact active-turn precondition.
- Keep the queued copy until provider acceptance is projected, so rejection does not lose work.
- Preserve queued text, images, and supported structured composer context.
- Mark accepted steers in the transcript without presenting them as a new turn.

## Non-goals

- A persistent Queue/Steer default setting.
- Automatically steering a live composer submission.
- Emulating steering by interrupting the active turn.
- Moving the web queue or mobile outbox to server persistence.
- Adding native steering to Claude, Copilot, Cursor, Grok, or OpenCode without a separately verified
  provider implementation.
- Persisting the existing web queue across reloads.
- Extending the frozen `apps/web` phone presentation tier. Native mobile receives the phone UX.

## Selected Architecture

### Contracts and orchestration

Add a shared `TurnDispatchMode` with `"queue" | "steer"`; Queue is the behavioral default. An
accepted user message may carry optional `dispatchMode`, with absence decoded as the legacy normal
turn behavior.

Add a dedicated public `thread.turn.steer` command rather than overloading `thread.turn.start`. It
carries:

- `threadId`;
- the exact `expectedTurnId` read by the client;
- a stable `messageId` belonging to the queued entry;
- fully prepared user text and attachments;
- a fresh command ID for that steer attempt; and
- the original enqueue time as the message's `createdAt` plus a separate `requestedAt` timestamp for
  the steer attempt.

It does not carry model selection, runtime mode, interaction mode, token mode, sandbox policy, or
other turn-start settings. Those values cannot be changed by native same-turn steering.

The decider requires an active session whose turn ID exactly matches `expectedTurnId`. A valid
command emits `thread.turn-steer-requested`, but it does not yet emit `thread.message-sent`; request
persistence is not provider acceptance.

`ProviderCommandReactor` processes the request and dispatches one server-owned resolution:

- Accepted: `thread.turn-steer-accepted` records the stable message ID, existing turn ID, content,
  and `dispatchMode: "steer"`. Projection adds the user message to the existing turn.
- Rejected: `thread.turn-steer-rejected` records a bounded user-facing reason and message ID, and
  appends the normal provider-failure activity. It does not add a user message.

Clients correlate both outcomes by `messageId`. This keeps a provider-side rejection distinct from
ordinary command acceptance and prevents a queue entry from disappearing too early.

### Provider boundary

Extend `ProviderAdapterCapabilities` with an explicit native-turn-steering mode and add an optional
adapter `steerTurn` operation. A conformance check keeps the advertised capability and method
presence aligned.

Add `ProviderSteerTurnInput`, `ProviderTurnSteerResult`, and `ProviderService.steerTurn`. The service:

1. validates non-empty text/attachments and the exact expected turn ID;
2. resolves the already-bound provider instance without performing session recovery or switching;
3. rejects adapters without native steering using the typed unsupported error path;
4. invokes the adapter; and
5. preserves the existing session binding and active turn instead of publishing a new turn.

The provider registry projects the adapter capability into `ServerProvider.supportsTurnSteering`.
The field is backward-compatible: absent means unsupported.

The Codex runtime builds the same text/image input items used by `turn/start`, then calls
`turn/steer` with:

- the provider thread ID;
- the queued message input;
- the exact active provider turn ID as `expectedTurnId`; and
- the stable message ID as `clientUserMessageId` for correlation.

It decodes `V2TurnSteerResponse`, verifies the returned ID matches the active turn, and leaves the
session in `running` state. Review and compact turns that app-server reports as non-steerable follow
the rejection path. No new `turn.started` event is synthesized.

### Shared client policy

Put pure steer eligibility and dispatch preparation in `packages/client-runtime`. Eligibility
returns either allowed or one specific explanation. It requires:

- a connected, mutation-ready environment;
- an active turn and exact turn ID;
- a server provider snapshot advertising native steering;
- a queued provider/model selection equal to the active thread selection; and
- queued runtime, interaction, and token modes compatible with the active turn.

The compatibility checks ensure settings are never silently ignored. A queued entry with staged
next-turn settings remains a normal queued entry.

The shared message-queue state also tracks in-flight steer message IDs. Queue drains stop at a
pending first entry to preserve per-thread ordering and cannot dispatch the same item normally while
its steer request is unresolved.

## Client Experience

### Web and desktop

Each `ComposerQueuedMessages` row gains a labeled Steer action before its existing move/remove
controls. The action is:

- enabled when shared eligibility allows steering;
- disabled with the precise explanation available through tooltip and accessible description;
- rendered as `Steering…` while its request is unresolved; and
- restored to Steer on rejection.

Web queue entries receive a stable message ID at enqueue time. On accepted projection, the matching
entry is removed and its cloned blob previews are revoked. On rejection, it remains in its original
position. Existing reorder and remove behavior stays unchanged. The frozen web phone tier does not
gain this control.

### Native mobile

Add a compact queued-message panel above `ThreadComposer`, backed by the existing persisted outbox
for the selected thread. Each row shows a one-line preview and exposes Steer plus remove. Native
mobile does not need to reproduce desktop's small up/down buttons; persisted creation order remains
the outbox order.

The steer action uses the queued outbox snapshot and the mobile attachment codec. The outbox item is
removed only after its accepted message appears in thread state. Rejection leaves it persisted.

Before ordinary outbox drain, reconcile queued message IDs against projected user messages. This
removes an item accepted as a steer while the app was backgrounded or disconnected and prevents a
later normal turn from delivering the same content again.

### Transcript

Accepted steers are projected with the active turn ID and `dispatchMode: "steer"`. Web and mobile
render a quiet `Steered` marker on that user message. It communicates that the message modified the
ongoing turn without creating a second turn boundary or changing ordinary user-message layout.

## Data Flow

1. The user submits while a turn is running. Existing behavior snapshots and queues the message.
2. The queued row derives steer eligibility from current connection, provider, turn, and settings.
3. The user selects Steer. The client marks the stable message ID pending and dispatches
   `thread.turn.steer` with the current `expectedTurnId`.
4. The server decider rechecks that exact turn and persists the request.
5. `ProviderCommandReactor` calls `ProviderService.steerTurn`.
6. Codex sends `turn/steer` and accepts only a response for the expected active turn.
7. The reactor publishes the accepted or rejected resolution.
8. Accepted projection appends the steered user message to the active turn. Both clients then remove
   the matching queued entry. Rejection clears pending state and keeps the entry queued.
9. Later queue draining continues from the first remaining non-pending entry.

## Failure and Race Behavior

- No active turn or a mismatched `expectedTurnId`: reject before provider dispatch; keep queued.
- Turn settles between the UI click and server decision: reject as stale; ordinary queue draining may
  proceed afterward.
- Turn changes after request persistence: the provider's own `expectedTurnId` check rejects it.
- Provider lacks native steering: return the typed unsupported result; never interrupt the turn.
- Active provider operation is non-steerable, such as Codex review/compact: reject and keep queued.
- Attachment preparation fails: do not dispatch the command and keep queued.
- Connection drops while pending: retain the queued copy. Reconcile accepted message IDs after
  reconnect before allowing normal drain.
- Duplicate command delivery: orchestration command receipts deduplicate the attempt. Stable message
  IDs make accepted projection and client cleanup idempotent.
- Client disappears after provider acceptance: the accepted message remains authoritative in server
  projection; mobile outbox reconciliation removes its durable copy on return.
- Rejected steers use the existing thread error/activity presentation with a bounded reason. They do
  not set the active turn to interrupted or failed.

## Alternatives Considered

1. **Shared first-class steer path (selected).** Keeps provider details out of clients, fits the
   current adapter/service architecture, and allows verified providers to opt in later.
2. **Codex-specific client RPC.** Smaller initially, but rejected because it bypasses orchestration,
   duplicates policy across clients, and leaks provider protocol details into UI code.
3. **Synara-style server-owned durable queue.** Stronger multi-client and restart semantics, but
   rejected for this feature because it replaces both existing queue owners and materially broadens
   the migration.
4. **Interrupt then send for unsupported providers.** Rejected because it can discard active work and
   is not same-turn steering.

## Verification

Use Bun 1.3.14 from `package.json`; install with `bun install --frozen-lockfile` when dependencies are
not already ready. Never invoke `bun test`.

Focused tests must cover:

- contract decoding for the new command, events, dispatch marker, capability, and legacy defaults;
- decider acceptance only for the exact active turn;
- adapter capability conformance and typed unsupported routing;
- `ProviderService.steerTurn` instance routing without session recovery or selection changes;
- Codex's exact `turn/steer` request, response decoding, attachment shaping, stale-turn rejection,
  and non-steerable active operations;
- reactor accepted/rejected resolution and absence of a new turn-start event;
- shared eligibility reasons and queue-drain exclusion while a steer is pending;
- web row enabled/disabled/pending behavior, rejection retention, accepted cleanup, reorder
  preservation, and frozen phone-tier exclusion;
- mobile outbox promotion, attachment hydration, restart/reconnect reconciliation, rejection
  retention, and queued panel actions; and
- web/mobile transcript rendering of a steered message inside the existing turn.

Because the change crosses contracts, orchestration, a provider runtime boundary, shared client
state, web, and mobile, finish with the repository backstop from `AGENTS.md`:

```sh
bun fmt
bun run fmt:check
bun lint
bun typecheck
bun run test
bun run build
```

During implementation, use focused package/test-file checks before that final backstop. Add focused
browser-component coverage for the web queue interaction; the full hosted/PWA browser suite is not
required unless implementation expands into lifecycle, reconnect, or service-worker behavior.

## References

- [Official Codex app-server documentation](https://developers.openai.com/codex/app-server/)
- [Synara queued composer actions](https://github.com/Emanuele-web04/synara/blob/8f9f60045ea652db7d4a6822e2f723dde073f40a/apps/web/src/components/chat/QueuedComposerActions.tsx)
- [Synara Codex app-server manager](https://github.com/Emanuele-web04/synara/blob/8f9f60045ea652db7d4a6822e2f723dde073f40a/apps/server/src/codexAppServerManager.ts)
- [Synara orchestration contracts](https://github.com/Emanuele-web04/synara/blob/8f9f60045ea652db7d4a6822e2f723dde073f40a/packages/contracts/src/orchestration.ts)
