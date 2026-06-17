# Phase 0.2 — Prop-diff audit findings

**Date:** 2026-06-14  
**Method:** Static analysis of parent→child prop wiring in `ChatView.tsx` and `Sidebar.tsx`, cross-checked against `useDevPropDiff` semantics in `tabSwitchInstrumentation.ts`.  
**Components:** `MessagesTimeline`, `ChatComposer`, `SidebarThreadRowContent`

To verify at runtime, temporarily add `useDevPropDiff(props, "ComponentName")` at the top of each component body and exercise: thread switch, send/stream, sidebar expand, thread rename. Logs appear in DevTools console as `[memo:<label>] <key> changed`.

---

## MessagesTimeline

**Parent:** `ChatView.tsx` (~4368)  
**Memo:** yes (`memo`)  
**Internal context:** `TimelineRowSharedState` via `useMemo` — row callbacks propagate through `TimelineRowCtx`.

### Expected churn (streaming / turn lifecycle)

| Prop | Cause | Phase 2 action |
|------|-------|----------------|
| `timelineEntries` | Re-derived on every message/tool delta | Keep; row virtualization handles data churn |
| `activeTurnInProgress`, `isWorking` | Turn state transitions | Keep |
| `activeTurnStartedAt` | Working timer anchor | Keep |
| `turnDiffSummaryByAssistantMessageId` | Map rebuilt when diff summaries arrive | Consider ref-backed lookup for infrequent fields |
| `revertTurnCountByUserMessageId` | Map rebuilt with timeline | Already read via ref in `onRevertUserMessage` |
| `completionSummary`, `completionDividerBeforeEntryId` | Turn completion | Low frequency |

### Callback stability (good)

- `onIsAtEndChange`, `onRevertUserMessage`, `onImageExpand` — stable (`useCallback`, empty or ref-backed deps)
- `onOpenTurnDiff`, `onCloseDiff` — intentionally change on `threadId` / route (tab switch only)

### Follow-up (Phase 2.1)

1. ~~**Split `TimelineRowSharedState`**~~ ✅ Done — split into `TimelineStreamingCtx` + `TimelineStableCtx`
2. **`skills` prop** — already falls back to `EMPTY_TIMELINE_SKILLS`; ensure parent never passes a fresh `[]` literal.

---

## ChatComposer

**Parent:** `ChatView.tsx` (~4456)  
**Memo:** yes (`memo` + `forwardRef`)

### High-impact unstable props

| Prop | Cause | Priority | Phase 2 action |
|------|-------|----------|----------------|
| **`onSend`** | Plain `async function` in render — **new identity every render** | **P0** | ✅ Fixed via ref-backed stable `useCallback` wrapper in ChatView |
| `activeThread` | Store object reference updates during streaming | P1 | Pass scalar slices where possible; avoid whole thread if composer only needs ids/settings |
| `providerStatuses` | Cast from hook; likely new array reference | P1 | Memoize in parent or select stable snapshot |
| `pendingApprovals`, `pendingUserInputs` | New array refs on orchestration push | P2 | Expected during approval flows |
| `activeThreadActivities` | Updates during turn | P2 | Memoize derived subset if composer only needs token counts |

### Stable / acceptable

- Mode handlers (`handleRuntimeModeChange`, `toggleInteractionMode`, etc.) — `useCallback`
- `environmentUnavailable` — parent `useMemo`
- Refs (`promptRef`, `composerImagesRef`, …) — stable
- `activePendingProgress`, `activePendingResolvedAnswers` — parent `useMemo`; churn only during user-input wizard

### Follow-up (Phase 2.1)

1. ~~**Stabilize `onSend`**~~ ✅ Done — ref-backed stable callback in ChatView
2. Audit whether `ChatComposer` needs full `activeThread` or can take `activeThreadId` + `modelSelection` + `activities` slices.

---

## SidebarThreadRowContent

**Parent:** `Sidebar.tsx` via `SidebarThreadRow` (~1058, ~3583)  
**Memo:** yes (`memo`)

### Per-row churn sources

| Prop | Cause | Notes |
|------|-------|-------|
| `thread` | Thread store updates (title, session status, PR badge) | Expected; row should update |
| `gitStatus` | `useGitStatus` polling when loaded via fallback wrapper | Expected for PR pill; pre-passed `gitStatus` from worktree list is stable between polls |
| `orderedProjectThreadKeys` | Array rebuilt in parent render | **P1** — memoize per project in `SidebarProjectThreadList` |
| `isActive` | Route change | Expected on tab switch |
| `renamingThreadKey`, `renamingTitle`, `confirmingArchiveThreadKey` | Global sidebar rename/archive state | Causes **all visible rows** to re-render when any row enters rename/confirm — acceptable for now; consider lifting rename UI to overlay in Phase 2.2 |

### Callback stability (good)

Sidebar parent defines stable handlers: `handleThreadClick`, `navigateToThread`, `navigateToDraft`, `closeThread`, `commitRename`, `cancelRename`, `attemptArchiveThread`, `openPrLink`, etc. — all `useCallback`.

### Follow-up (Phase 2.2)

1. Memoize `orderedProjectThreadKeys` per expanded project.
2. When virtualizing sidebar thread list (>20 threads), ensure row renderer receives stable handler refs (already true) and stable `orderedProjectThreadKeys`.

---

## Summary priority for Phase 2.1

| Rank | Component | Fix |
|------|-----------|-----|
| 1 | ChatComposer | Stabilize `onSend` callback |
| 2 | MessagesTimeline | Split `TimelineRowSharedState` / ref-back infrequent context fields |
| 3 | ChatComposer | Memoize `providerStatuses` snapshot passed from ChatView |
| 4 | SidebarThreadRowContent | Memoize `orderedProjectThreadKeys` in thread list parent |

No `useDevPropDiff` hooks were left in production component bodies (audit was static + documented workflow in `apps/web/src/perf/README.md`).
