# Batch 01 — Daily UX

Copy everything below the line into your agent session in the **batch worktree**.

---

## Setup

| Item         | Value                                   |
| ------------ | --------------------------------------- |
| **Branch**   | `feat/batch-daily-ux`                   |
| **Worktree** | One dedicated worktree for this batch   |
| **PR**       | Single PR containing all features below |
| **Agent**    | One Cursor agent session (no subagents) |

Read [AGENTS.md](../../AGENTS.md) first.

## Your task

Implement **all five features** on this branch in order. Use the linked feature files for full detail; summaries are inline below.

```bash
# Run once before opening the PR
bun fmt && bun lint && bun typecheck && bun run test
```

Do not commit unless explicitly asked.

## Implementation order

| Step | ID  | Feature                     | Feature file                                                                                    | Notes                               |
| ---- | --- | --------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1    | 01  | Scroll to bottom on send    | [features/01-scroll-to-bottom-on-send.md](../features/01-scroll-to-bottom-on-send.md)           |                                     |
| 2    | 03  | Sidebar sort + thread limit | [features/03-thread-archiving-sidebar-sort.md](../features/03-thread-archiving-sidebar-sort.md) |                                     |
| 3    | 13  | Undo send                   | [features/13-undo-send.md](../features/13-undo-send.md)                                         | Before queue (same send pipeline)   |
| 4    | 14  | Desktop turn notification   | [features/14-desktop-turn-notification.md](../features/14-desktop-turn-notification.md)         |                                     |
| 5    | 02  | Message queueing            | [features/02-message-queueing.md](../features/02-message-queueing.md)                           | Last — builds on send/undo behavior |

## Feature summaries

### 01 — Scroll to bottom on send

Auto-scroll timeline on message submit. Don't force scroll on every stream delta if user scrolled up. Keep scroll-to-bottom pill. Files: `ChatView.tsx`, `MessagesTimeline.tsx`.

### 03 — Sidebar sort + limits

Per `TODO.md`: last 10 threads per project (+ show all); new projects on top; sort projects by latest thread activity; archived threads only in Settings. Files: `Sidebar*.tsx`, `Sidebar.logic.ts`.

### 13 — Undo send

~3–5s undo after send before provider pickup. Not the same as `interruptTurn`. Toast or inline undo. Unit test state machine.

### 14 — Desktop notification

Native notification on turn complete when window unfocused. Click focuses app + thread. Settings toggle (default on). Files: `apps/desktop/src/main.ts`, IPC.

### 02 — Message queueing

Queue messages during active turn; auto-send on quiescence; queue UI with remove/reorder; handle interrupt/errors. Prefer client-owned queue if architecture allows.

## Batch acceptance

- [ ] All 5 features implemented on one branch
- [ ] `bun fmt && bun lint && bun typecheck && bun run test` pass
- [ ] Manual smoke:
  - Send turn → stream → complete
  - Send while scrolled up → jumps to bottom
  - Sidebar sort/limit/archived behavior correct
  - Undo send within window works
  - Desktop notification when unfocused
  - Queue 2 messages during stream → both send in order

## PR title suggestion

`feat: daily UX — scroll, sidebar sort, undo send, notifications, message queue`
