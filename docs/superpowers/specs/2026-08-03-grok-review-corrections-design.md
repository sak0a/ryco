# Grok Review Corrections Design

## Scope

Address the two unresolved Codex review threads on PR #280 without changing Grok's public
capabilities:

1. Prevent a late ID-less `_x.ai/session/prompt_complete` notification from completing a later
   prompt.
2. Reject a supplied malformed Grok resume cursor instead of silently starting a fresh session.

No GitHub replies or thread-resolution mutations are part of this change.

## Prompt-completion sequencing

The xAI compatibility wrapper will retain prompt completion registrations in per-session order.
Each registration has a generated correlation ID, a completion deferred, and a state indicating
whether the standard ACP response has already settled the prompt.

When the standard ACP response wins the race, its registration becomes a settled tombstone instead
of being removed immediately. An ID-less completion always consumes the oldest registration for its
session. If that registration is still pending, the notification completes it; if it is a settled
tombstone, the notification is discarded. An ID-bearing completion continues to match by prompt ID
and is also discarded when it targets a settled registration or an ID in the bounded completed-ID
history.

Settled tombstones and completed IDs remain bounded. Prompt cancellation and failed or interrupted
prompt effects remove registrations so abandoned work cannot accumulate. The standards-based ACP
response remains authoritative whenever it wins the race.

## Resume validation

`startSession` will distinguish an absent `resumeCursor` from a supplied invalid value. A supplied
cursor must be an object with the supported schema version and a non-empty string session ID.
Otherwise startup fails with `ProviderAdapterValidationError`.

Validation occurs before an existing adapter session is stopped and before a Grok child process is
spawned. This ensures malformed recovery state cannot discard a healthy runtime or masquerade as a
new session.

## Verification

The ACP mock will reproduce a standard response followed by a delayed ID-less completion while a
second prompt is pending. A regression test will verify that the stale notification is consumed and
only the second prompt's own completion can finish it.

Adapter tests will cover unsupported resume versions, missing or blank session IDs, and non-object
cursors. Existing fresh-session and valid-resume behavior must remain unchanged.

After targeted tests pass, run the repository backstop required by `AGENTS.md`:

```sh
bun fmt
bun run fmt:check
bun lint
bun typecheck
bun run typecheck:effect
bun run test
bun run build
```
