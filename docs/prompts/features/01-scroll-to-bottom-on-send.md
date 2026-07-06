# 01 — Scroll to bottom on send

| Field                       | Value    |
| --------------------------- | -------- |
| **Batch**                   | Daily UX |
| **Order in batch**          | 1 of 5   |
| **Depends on (same batch)** | —        |

## Prompt

Implement auto-scroll to the bottom of the message timeline when the user submits a new message in a thread.

### Context

- Ryco web app: `apps/web`
- ChatView already has a scroll-to-bottom pill when the user has scrolled away (`apps/web/src/components/ChatView.tsx`)
- MessagesTimeline uses LegendList virtualization (`apps/web/src/components/chat/MessagesTimeline.tsx`)

### Requirements

- When the user sends a message (their turn), scroll to the bottom immediately
- Do NOT force scroll on every streaming delta if the user has intentionally scrolled up — only auto-scroll on send and optionally while already pinned to bottom during streaming (match common chat UX)
- Preserve existing scroll-to-bottom pill behavior
- Add or extend browser test coverage if `MessagesTimeline.browser.tsx` or `ChatView.browser.tsx` exists

### Acceptance

- Sending a message while scrolled up jumps to bottom
- Reading history during an active stream is not interrupted unless user clicks scroll-to-bottom or sends again
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
