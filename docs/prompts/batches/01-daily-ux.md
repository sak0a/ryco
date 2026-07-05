# Batch 01 — Daily UX (Orchestration Prompt)

Copy everything below the line into a **Composer 2.5** session (or Cloud Agent) as the master prompt.

---

## Role

You are the **lead orchestrator** for Ryco batch **Daily UX**. Coordinate implementation of features **01, 03, 13, 14** in separate PRs, and feature **02** in its own PR after or separately (do not parallelize 02 with 13).

Read [AGENTS.md](../../AGENTS.md) first. Every PR must pass:

```bash
bun fmt && bun lint && bun typecheck && bun run test
```

Do not commit unless explicitly asked.

## Batch summary

| ID | Feature | Model | Subagent? | PR order |
|----|---------|-------|-----------|----------|
| 01 | Scroll to bottom on send | Composer 2.5 | Optional parallel | 1 |
| 03 | Sidebar sort + thread limit | Composer 2.5 | Optional parallel | 1 (parallel with 01) |
| 13 | Undo send | GPT 5.5 | No | 2 |
| 14 | Desktop turn notification | Composer 2.5 | Optional parallel | 1 (parallel with 01/03) |
| 02 | Message queueing | Composer 2.5 (Opus if server queue) | **No** | 3 (solo) |

## Subagent strategy

### Parallel group A (safe — different files)

Spawn up to **3 subagents** simultaneously:

| Subagent | Model | Prompt file | Allowed paths |
|----------|-------|-------------|---------------|
| A1 | Composer 2.5 | [features/01-scroll-to-bottom-on-send.md](../features/01-scroll-to-bottom-on-send.md) | `apps/web/src/components/ChatView.tsx`, `MessagesTimeline.tsx`, related tests |
| A2 | Composer 2.5 | [features/03-thread-archiving-sidebar-sort.md](../features/03-thread-archiving-sidebar-sort.md) | `Sidebar*.tsx`, `Sidebar.logic.ts`, tests |
| A3 | Composer 2.5 | [features/14-desktop-turn-notification.md](../features/14-desktop-turn-notification.md) | `apps/desktop/`, settings toggle, IPC |

**Subagent preamble** (prepend to each):

```text
You are a focused subagent for Ryco. Implement ONLY the feature in the prompt below.
Do not touch files outside your allowed paths.
Before finishing: bun fmt && bun lint && bun typecheck && bun run test
Do not commit. Match AGENTS.md conventions. Minimize scope.
```

### Sequential PR 2

| Agent | Model | Prompt file |
|-------|-------|-------------|
| Lead | GPT 5.5 | [features/13-undo-send.md](../features/13-undo-send.md) |

Run solo — touches send pipeline; conflicts with queue work.

### Sequential PR 3

| Agent | Model | Prompt file |
|-------|-------|-------------|
| Lead | Composer 2.5 | [features/02-message-queueing.md](../features/02-message-queueing.md) |

Run solo after 13 lands or on a separate branch. Use Opus 4.8 instead if you choose server-owned queue state.

## Your orchestrator tasks

1. Create branch `batch/daily-ux` or one branch per feature (preferred).
2. Spawn parallel subagents A1–A3 with exact prompt file contents + preamble.
3. Merge subagent outputs; resolve conflicts; run full test suite.
4. Run PR 2 (undo send) yourself or spawn GPT 5.5 subagent.
5. Run PR 3 (queue) last.
6. Manual smoke after each PR:
   - Send turn → stream → complete
   - Sidebar project/thread order correct
   - Desktop notification when unfocused (PR 14)
   - Undo send within window (PR 13)
   - Queue 2 messages during stream (PR 02)

## Feature prompts (inline reference)

### 01 — Scroll to bottom on send

Implement auto-scroll to the bottom of the message timeline when the user submits a new message in a thread.

**Context:** `ChatView.tsx` scroll pill; `MessagesTimeline.tsx` LegendList.

**Requirements:** Auto-scroll on send; don't force scroll on every delta if user scrolled up; preserve scroll pill; browser tests if available.

**Acceptance:** Send while scrolled up jumps to bottom; reading history during stream not interrupted.

---

### 03 — Sidebar sort + limits

Per `TODO.md`: last 10 threads per project (+ show all); new projects on top; projects sorted by latest thread activity; archived threads only in Settings.

**Context:** `Sidebar.tsx`, `SidebarProjectThreadList.tsx`, `Sidebar.logic.ts`.

**Acceptance:** 15 threads → show 10 + expand; new project at top; activity sort works.

---

### 13 — Undo send

Brief undo window (~3–5s) after send before provider pickup. Not the same as interruptTurn.

**Context:** sendTurn pipeline, `ProviderCommandReactor` cancel paths.

**Acceptance:** Undo within window prevents turn; after pickup shows clear feedback; unit test state machine.

---

### 14 — Desktop notification

Native notification on turn complete when window unfocused. Click focuses app + thread. Settings toggle default on.

**Context:** `apps/desktop/src/main.ts`, IPC patterns.

---

### 02 — Message queueing

Queue messages during active turn; auto-send on quiescence; UI for queue list; handle interrupt/errors.

**Context:** `ChatComposer.tsx`, orchestration RPC, prefer client-owned queue if possible.

**Acceptance:** Queue 2 messages → both send in order; cancel works; interrupt doesn't corrupt queue.

## Success criteria

- [ ] All 5 features implemented (5 PRs or 1 branch with 5 commits — your choice)
- [ ] Full validation green on final merge
- [ ] No regressions in send/stream/interrupt smoke paths
