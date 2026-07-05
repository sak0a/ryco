# 13 — Undo send (short cancel window)

| Field | Value |
|-------|-------|
| **Batch** | Daily UX |
| **Order in batch** | 3 of 5 |
| **Depends on (same batch)** | — |

## Prompt

Add "Undo send" for a brief window after submitting a message, before the provider picks up the turn.

### Context

- `sendTurn` flow: `useChatSessionActions` or ChatView send pipeline
- Orchestration may support cancel before provider command reactor dispatches — inspect `ProviderCommandReactor` / orchestration cancel paths

### Requirements

- After send, show toast or inline "Undo" for ~3–5 seconds
- Undo cancels outbound turn if not yet dispatched to provider
- If already dispatched, undo is unavailable (no silent failure)
- Do not confuse with `interruptTurn` (mid-stream)

### Acceptance

- Undo within window prevents turn start
- Undo after provider pickup shows clear feedback
- Unit test for cancel window state machine
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
