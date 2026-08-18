# Agent Control automation and diagnostics boundary

Agent Control automations are server-owned, project-scoped schedule definitions. Approving a
create or update proposal authorizes only that definition. It never creates a thread or starts a
provider turn. When an occurrence is due, the scheduler materializes a new immutable
`automationRun` proposal containing the exact project, provider instance, runtime/worktree
options, title, and bounded prompt. A user must approve that run before the existing thread-action
executor can create the thread and start work.

The schedule language is deliberately finite:

- one future `runAt`, or a fixed interval of at least 15 minutes;
- a required end within 90 days for recurring schedules;
- at most 25 active definitions per project;
- at most one pending or executing run per automation;
- at most 50 retained run outcomes per automation;
- missed intervals coalesce into one occurrence, never a catch-up batch;
- each run proposal expires after 15 minutes.

SQLite uniqueness constraints make occurrence claims and active-run creation idempotent across
concurrent ticks and restart recovery. A revision change or cancellation before proposal
materialization invalidates the claimed occurrence. Cancellation prevents future proposals and
cancels only a pending, unaccepted run; it does not delete project/thread data or interrupt a run
that was already accepted or is executing.

The operational MCP reads clamp each page to 50 items, each requested time range to 24 hours, and
the retention boundary to seven days. Orchestration scans inspect at most 500 newest events.
Provider runtime summaries come from a 500-entry in-memory metadata ring. Responses contain only
typed IDs, event types, timestamps, statuses, and numeric health counts. They omit credentials,
environment values, paths, files, commands, terminals, transcripts, request/MCP bodies, raw
payloads, traces, logs, relay/hosted data, and other project/provider-session state.

Internal MCP reads remain bound to the exact provider session's project and provider instance;
mutation tools additionally require exact active-turn authority. External integrations receive no
new default privilege. Automation, activity, and diagnostics capabilities must be granted
explicitly and continue to enforce integration expiry/revocation, project scope, rate limits, and
the existing shared-checkout/full-access restrictions.

The governed iOS Simulator extension uses Ryco's existing thread-scoped `DeviceService`; it does
not add a transport or a device-specific approval queue. Inventory and lifecycle metadata are
available only to the exact internal provider session. Screenshots and accessibility trees are
ephemeral MCP content for the exact current thread attachment: they are never copied into
structured results, proposals, audit rows, diagnostics, or server logs. External integrations
receive neither device metadata nor device content.

Every device mutation is a separate immutable proposal and only the shared accepted-proposal
executor can invoke `DeviceService`. Audit and diagnostic records retain safe identifiers, action
kind, lifecycle expectations, decisions, outcomes, and typed error codes; they omit screenshots,
frames, UI-tree contents, raw URLs, artifact paths, recording paths, helper payloads, and typed
text. Legacy direct device mutation/content tools are suppressed while an Agent Control provider
lease exists, preventing selection of the older gateway as an approval bypass.
Coordinate taps, swipes, and hardware buttons are proposal-safe. Text typing, label-targeted taps,
and scroll-to-element remain unavailable because their exact inputs can contain accessibility or
user content that the durable proposal model must not persist. Launch arguments are unavailable
for the same reason.

Automation templates still contain no browser, device, shell, command, RPC, URL, webhook, script,
or callback field. Browser/CDP/web-page control remains out of scope.
