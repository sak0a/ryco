# 14 — Desktop turn-complete notification

| Field | Value |
|-------|-------|
| **Batch** | Daily UX |
| **Order in batch** | 4 of 5 |
| **Depends on (same batch)** | — |

## Prompt

Show a native desktop notification when an agent turn completes and the Ryco window is unfocused.

### Context

- Electron main: `apps/desktop/src/main.ts`
- Turn completion receipts: orchestration runtime / client store turn quiescence events

### Requirements

- Bridge turn-complete event from renderer to main process (existing IPC patterns in `apps/desktop`)
- Only notify when `BrowserWindow` is not focused
- Notification click focuses window and navigates to completing thread
- Respect OS notification permissions; no-op if denied
- Setting toggle in Appearance/General settings (default on)

### Acceptance

- Start turn, switch away, receive notification on completion
- No notification when window focused
- Desktop unit/integration test for IPC handler if pattern exists
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
