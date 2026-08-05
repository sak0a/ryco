# Context handoffs

Ryco can continue one visible thread with a different provider instance or model. On supported
desktop and tablet layouts, choose the target while the thread is idle and send the next message.
The selection is only a local composer draft: it creates no provider session, server activity, or
timeline marker until that message is sent. Options-only changes, such as reasoning effort, remain
ordinary turns.

The send uses the existing `thread.turn.start` command. The server rechecks that the thread has no
running or starting turn, pending approval or question, queued/local dispatch, worktree setup,
checkpoint revert, or other active handoff. A busy-state race rejects the send without changing the
canonical provider selection; the composer keeps the message and staged target for a predictable
retry. The frozen web phone provider flow does not offer handoffs.

## Runtime and context model

Every version 1 target is a fresh provider-native runtime, including a return to a provider used
earlier in the Ryco thread. Ryco never resumes an older native conversation for a handoff. Before
starting the target, the server builds a deterministic context document from canonical Ryco
history before the triggering message. It includes allow-listed messages, plans, useful tool and
terminal results, paths and file/checkpoint summaries, relevant failures or questions, completed
subagent summaries, and prior boundary metadata.

Hidden reasoning, protocol noise, telemetry, arbitrary unknown payloads, target startup events,
the triggering message, and prior context bodies are excluded. Rendering is section-aware,
Unicode-safe, and bounded by the provider input limit. The provider receives one context envelope
followed by the exact current user message. The visible canonical message is never rewritten.

The large structured document lives only in the server-local `provider_context_handoffs` table.
It is not copied into orchestration events, snapshots, RPC responses, activities, logs, or
analytics. Timeline activities contain only small boundary metadata and a digest.

## Durability and failure behavior

The operation records `requested`, `preparing`, and `dispatching` before provider delivery. Target
acceptance is durably recorded before Ryco commits the target model selection and replaces the
pending activity with a persisted timeline divider. A successful thread can repeat handoffs such
as A → B → C → A while retaining every divider and its original provider/model presentation.

If startup or delivery is rejected before acceptance, Ryco stops partial target state, restores an
exact still-live source binding when possible, preserves the source model selection, and shows a
failed divider. If the server restarts after dispatch and acceptance cannot be proved, recovery
marks the operation `delivery-uncertain` and never blindly resends the message. Both outcomes remain
visible after reload and can be retried with a new send.

Every provider event is checked against both its `ProviderInstanceId` and `RuntimeSessionId` before
any lifecycle, message, tool, request, plan, checkpoint, activity, or buffer mutation. Late events
from earlier epochs—including `session.exited` after A1 → B → A2—are dropped. Different-instance
cleanup is bounded and retried asynchronously; same-instance fresh replacement fails explicitly if
the prior thread-keyed runtime cannot stop safely.

Provider-native rollback is limited to the active runtime epoch. Ryco rejects a revert that would
cross the latest successful handoff boundary before changing either provider conversation state or
the filesystem. Cross-epoch provider-native resume, delta context transfer, and cross-process
exactly-once delivery are deliberate version 1 non-goals.
