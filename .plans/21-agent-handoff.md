# Agent Handoff — Improvement Roadmap Continuation

**Date:** 2026-06-14  
**Master plan:** `.plans/21-concrete-improvement-roadmap.md`  
**Repo:** Ryco (`/Users/laurinfrank/Dropbox/Code/ryco`)

---

## Copy-paste prompt for the next agent

```
Continue the Ryco improvement roadmap from `.plans/21-concrete-improvement-roadmap.md`.

Read first:
- `.plans/21-concrete-improvement-roadmap.md` (master sequencing)
- `.plans/21-agent-handoff.md` (this file — current state)
- `AGENTS.md` (completion requirements: bun fmt, bun lint, bun typecheck, bun run test)

## Already landed (do not redo)

### Phase 0.1 — Perf budget harness ✅
- `apps/web/src/perf/budgets.ts` + `budgets.test.ts`
- Sidebar expand marks in `tabSwitchInstrumentation.ts` + `Sidebar.tsx`
- Browser tests: `apps/web/src/components/perf/ClientPerfBudget.browser.tsx`
- Docs: `apps/web/src/perf/README.md`, `docs/observability.md`

### Phase 1.1 — Session actions (partial) ✅
- `apps/web/src/hooks/chatSessionActions.ts` — pure orchestration dispatch helpers
- `apps/web/src/hooks/useChatSessionActions.ts` — interrupt, approval, user-input, checkpoint revert
- `apps/web/src/hooks/chatSessionActions.test.ts`
- `ChatView.tsx` wired to hook (~120 lines removed)

### Phase 1.1 — Send logic (partial) ✅
- `resolveChatSendWorktreePlan` + `buildChatSendTitleSeed` in `ChatView.logic.ts` + tests
- `ChatView.tsx` `onSend` uses extracted worktree/title helpers

## Your priorities (in order)

1. **Finish Phase 1.1** — extract remaining send pipeline from `ChatView.tsx`:
   - Target: `apps/web/src/hooks/executeChatSendTurn.ts` (or `components/chat/chatSendTurn.ts`)
   - Move: optimistic message setup, turn dispatch, failure rollback (~250 lines)
   - Keep: composer UI wiring, refs, and `onSubmitPlanFollowUp` in ChatView for now OR extract in same module
   - Run: `ChatView.browser.tsx` send/stream/interrupt smoke paths

2. **Phase 1.5** — extract `ProjectSettingsDialog` from `Sidebar.tsx`:
   - Source: `Sidebar.tsx` ~lines 1455–2350 (`ProjectSettingsDialog`, sections, Atlassian helpers)
   - Target: `apps/web/src/components/sidebar/ProjectSettingsDialog.tsx` (+ optional `projectSettingsSections.tsx`)
   - Goal: `Sidebar.tsx` under 5,500 lines after extraction
   - Preserve all imports/types from `Sidebar.logic.ts` / `Sidebar.types.ts` if present

3. **Phase 0.2** — prop-diff audit (no behavior change):
   - Run `useDevPropDiff` on `MessagesTimeline`, `ChatComposer`, `SidebarThreadRowContent`
   - Document findings in `apps/web/src/perf/README.md` or a short `.plans/21-prop-diff-findings.md`

## Parallel subagent strategy

Launch these **in parallel** when possible (separate files, minimal overlap):

| Subagent | Task | Primary files | Validation |
|----------|------|---------------|------------|
| **A** | ProjectSettingsDialog extraction | `Sidebar.tsx` → `sidebar/ProjectSettingsDialog.tsx` | `SidebarWorktreeList.browser.tsx`, manual project settings |
| **B** | executeChatSendTurn extraction | `ChatView.tsx` → `hooks/executeChatSendTurn.ts` | `ChatView.logic.test.ts`, `ChatView.browser.tsx` |
| **C** | Prop-diff audit | `MessagesTimeline.tsx`, `ChatComposer.tsx`, `Sidebar.tsx` | Dev-only logging, doc only |

**Do NOT parallelize** edits to `ChatView.tsx` and `executeChatSendTurn` with subagent B until A/C avoid ChatView.

After A+B land, run full `bun fmt && bun lint && bun typecheck && bun run test` and `bun --filter @ryco/web run test:browser` for touched browser tests.

## Key file sizes (approx, post-handoff)

| File | Lines | Notes |
|------|-------|-------|
| `Sidebar.tsx` | ~3,896 | Thread rows extracted; target <2,500 |
| `ChatView.tsx` | ~3,984 | Overview controls moved to panel hook |
| `ChatComposer.tsx` | ~2,388 | Footer + send pipeline extracted; target <2,000 |
| `rpc/protocol.ts` | 325 | Phase 3.1 |
| `store.ts` | 2,825 | Shell push coalescing added |
| `composerDraftStore.ts` | 1,949 | Phase 1.7 done |
| `composerDraftPersistence.ts` | 1,253 | Phase 1.7 |

## Commands

```bash
bun fmt && bun lint && bun typecheck && bun run test
cd apps/web && bun run test:browser -- src/components/ChatView.browser.tsx
cd apps/web && bun run test -- src/perf src/hooks/chatSessionActions.test.ts src/components/ChatView.logic.test.ts
```

## Constraints

- Performance and reliability first — no streaming/reconnect regressions
- One concern per PR; behavior-preserving refactors only unless explicitly a feature
- Never run `bun test` — use `bun run test`
- Do not commit unless the user asks
```

---

## Implementation log

| Item | Status | Notes |
|------|--------|-------|
| Phase 0.1 perf budgets | ✅ Done | Unit + browser tests |
| Phase 0.2 prop-diff audit | ✅ Done | `.plans/21-prop-diff-findings.md` |
| Phase 1.1 useChatSessionActions | ✅ Done | Interrupt/approval/user-input/revert |
| Phase 1.1 send extraction | ✅ Done | `executeChatSendTurn.ts` + tests |
| Phase 1.5 ProjectSettingsDialog | ✅ Done | `sidebar/ProjectSettingsDialog.tsx` (−921 lines) |
| Phase 1.2 ChatOverviewPanel | ✅ Done | `ChatOverviewPanel.tsx` (−473 lines from ChatView) |
| Phase 1.3 ChatTerminalShell | ✅ Done | `ChatTerminalShell.tsx` (−194 lines from ChatView) |
| Phase 1.4 ComposerAttachmentMenus + Footer | ✅ Done | Composer 2837 → 2388; `ComposerFooter.tsx`, `ComposerSendPipeline.ts` |
| Phase 1.6 Sidebar thread rows | ✅ Done | `SidebarThreadRow.tsx`, `SidebarProjectThreadList.tsx`; Sidebar 4652 → 3896 |
| Phase 1.2 overview controls | ✅ Done | `useOverviewPanelControls` in ChatOverviewPanel |
| Phase 2.3 diff cache | ✅ Done | `diffParseCache.ts` + DiffPanel wiring |
| Phase 2.4 store coalescing | ✅ Done | `createShellEventCoalescer` + tests in store.test.ts |
| Phase 3.1 RPC protocol | ✅ Done | `rpc/protocol.ts` extracted from wsTransport |
| Phase 1.7 composerDraftPersistence | ✅ Done | store 3214 → 1949 lines |
| Phase 2.1 hot-path props | ✅ Partial | Timeline context split + stable `onSend` ref |
| Phase 5.3 Diagnostics panel | ✅ Done | Route + panel + redaction tests |

---

## In progress (2026-06-14 batch 2)

11 Opus subagents launched in parallel:
- Phase 4.3 projection indexes + pagination
- Split SidebarProjectItem + ws/context.ts
- ChatView further extraction
- Phase 3.5: desktop/sourceControl/workItems/overview/settings atoms + React Query removal finale
- Phase 5.3 Diagnostics panel
- Phase 5.1 Auth middleware — ✅ Already in repo (`ServerAuthPolicy`); verify-only, no changes

- **`ChatView.tsx` hook ordering:** `useChatSessionActions` must stay **after** `setThreadError` and **before** any use of `respondingUserInputRequestIds` / `isRevertingCheckpoint` (currently placed right after `activeThreadId`).
- **Send rollback path** touches refs (`promptRef`, `composerImagesRef`) — keep rollback in one module with clear `SendTurnRollback` interface.
- **`Sidebar.tsx` extraction** needs many lucide icons, Atlassian queries, and `ProjectFavicon` — copy imports carefully; prefer re-export from Sidebar only if circular imports appear.
- **Browser perf tests** use real `performance.measure` — no `VITE_RYCO_PERF_PROFILE` required in `ClientPerfBudget.browser.tsx`.

---

## Suggested PR cut lines

1. **PR 1 (merged conceptually):** Phase 0.1 + Phase 1.1 partial — current workspace state
2. **PR 2:** `executeChatSendTurn.ts` + tests
3. **PR 3:** `ProjectSettingsDialog` extraction
4. **PR 4:** Phase 1.2 `ChatOverviewPanel` (overview PR/workflow queries out of ChatView)

Each PR must pass fmt/lint/typecheck/test independently.
