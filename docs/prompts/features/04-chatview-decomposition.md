# 04 — ChatView decomposition (finish split)

| Field | Value |
|-------|-------|
| **Batch** | Perf / refactor |
| **Recommended model** | Composer 2.5 |
| **Subagent?** | No — sequential with 08 |
| **Dependencies** | None (do before 08 AtomRpc) |
| **PR size** | Large (behavior-preserving) |

## Prompt

Continue decomposing `ChatView.tsx` (~3000 lines) following `.plans/04-split-chatview-component.md` and `.plans/21-concrete-improvement-roadmap.md` Phase 1.

### Target extractions (one PR scope — pick the largest remaining inline block)

- `useChatSessionActions` hook: `sendTurn`, `interruptTurn`, `approveRequest`, `rejectRequest` (`apps/web/src/hooks/useChatSessionActions.ts`)
- `ChatTerminalShell`: lazy `ThreadTerminalDrawer` wrapper (`apps/web/src/components/chat/ChatTerminalShell.tsx`)
- Move any remaining overview/PR/workflow query blocks into `ChatOverviewPanel` if not already done

### Requirements

- Behavior-preserving refactor only — no UX changes
- Keep `MessagesTimeline` API stable (auto-scroll tests depend on it)
- `ChatView.tsx` target: under 1500 lines after this PR
- Run `ChatView.browser.tsx` and related browser tests

### Acceptance

- Line count reduction with no functional regressions
- New hook/components have unit tests where logic is non-trivial
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
