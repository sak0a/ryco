# 02 — Message queueing

| Field                       | Value          |
| --------------------------- | -------------- |
| **Batch**                   | Daily UX       |
| **Order in batch**          | 5 of 5         |
| **Depends on (same batch)** | 13 (undo send) |

## Prompt

Add message queueing so users can compose and queue the next prompt while a provider turn is in progress.

### Context

- Orchestration commands go through WebSocket RPC (`apps/web/src/rpc/`, `apps/server/src/ws/`)
- Composer lives in `apps/web/src/components/chat/ChatComposer.tsx`
- Turn lifecycle is brokered server-side via ProviderService / orchestration engine

### Requirements

- When a turn is active, allow the composer to accept input and "queue" one or more messages instead of blocking send
- Show queued messages in the UI (compact list above composer or inline chips) with remove/reorder
- When the current turn completes (quiescence), automatically send the next queued message in order
- Persist queued drafts per thread in `composerDraftStore` or equivalent — survive thread switch within session
- Handle edge cases: interrupt turn, thread switch, provider error — queue should not silently drop without user feedback
- Add contracts only if server needs to own queue state; prefer client-owned queue that dispatches `sendTurn` on completion if that matches existing architecture

### Acceptance

- Queue 2 messages during active stream; both send in order after turn completes
- User can cancel queued messages before they send
- Interrupting active turn does not corrupt queue
- Tests for queue dispatch logic (unit) + happy path browser test if feasible
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
