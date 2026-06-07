# Thread Workspace Panel Implementation Plan

> **For agentic workers:** implement task-by-task and keep the first pass scoped
> to floating overview, persistent subagent tabs, Review, and Files. Terminal,
> Browser, and Side chat are future tab kinds.

**Goal:** Replace the task-only right-side experience with a Codex-app-inspired
thread workspace: floating current-thread overview plus route-backed workspace
tabs for subagent chats, Review, and Files.

**Spec:** `docs/superpowers/specs/2026-06-04-thread-workspace-panel-design.md`

**Prototype:** `docs/superpowers/prototypes/thread-workspace-panel-demo.html`

---

## Task 1: Protocol spike for Codex subagent metadata

**Purpose:** Confirm what Codex app-server emits for spawned subagents before
hard-coding the view model.

**Files likely touched:**

- `apps/server/src/provider/Layers/CodexAdapter.test.ts`
- `apps/server/src/provider/Layers/CodexAdapter.ts`
- temporary local capture script or fixture under an existing test fixture area

**Steps:**

- [ ] Create or capture a raw app-server fixture with a parent turn that spawns
      at least two subagents.
- [ ] Record `item/started`, `item/completed`, `item/agentMessage/delta`, and
      thread metadata notifications.
- [ ] Identify whether each spawned subagent has a child thread id, agent
      nickname, agent role/type, status, and child message stream.
- [ ] Add fixture-based tests that document the observed shape.
- [ ] Update `CodexAdapter` only as needed to preserve useful subagent metadata
      in `item.started` / `item.completed` payloads.

**Acceptance:**

- The app-server event shape is documented in tests or a fixture note.
- Ryco preserves enough metadata to list subagents even if full child chat is
  not available yet.

---

## Task 2: Generalize right panel route state

**Purpose:** Move from `diff | preview` to a workspace tab route model while
keeping old links working.

**Files:**

- `apps/web/src/rightPanelRouteSearch.ts`
- `apps/web/src/rightPanelRouteSearch.test.ts`
- `apps/web/src/routes/_chat.$environmentId.$threadId.tsx`
- `apps/web/src/routes/_chat.draft.$draftId.tsx` if draft route has matching
  panel logic
- `apps/web/src/diffRouteSearch.ts`
- `apps/web/src/previewRouteSearch.ts`

**Steps:**

- [ ] Add a `WorkspacePanelMode` or `WorkspaceTabRoute` type with `review`,
      `files`, and `agent`.
- [ ] Add `agentKey` route search support for subagent tabs.
- [ ] Parse legacy `diff=1` as `review`.
- [ ] Parse legacy `preview=1` as `files`.
- [ ] Keep `diffTurnId`, `diffFilePath`, and preview path params usable.
- [ ] Update route search tests for new and legacy paths.
- [ ] Update chat route open/close helpers to write the new route shape.

**Acceptance:**

- Existing Review/Diff deep links still open the review tab.
- Existing Preview deep links still open the files tab.
- New route params can open a specific subagent tab.

---

## Task 3: Add workspace tab state

**Purpose:** Preserve real tabs per thread and keep subagent chats open until
the user closes them.

**Files:**

- `apps/web/src/uiStateStore.ts` or a new focused workspace-tab store
- new `apps/web/src/threadWorkspaceTabs.ts`
- new `apps/web/src/threadWorkspaceTabs.test.ts`

**Steps:**

- [ ] Define `ThreadWorkspaceTab` for `agent`, `review`, and `files`.
- [ ] Store open tabs by scoped thread key.
- [ ] Store selected tab by scoped thread key, with route state taking priority.
- [ ] Add pure reducer helpers: - open singleton tab - open/focus agent tab - close tab - choose next selected tab after close - prune tabs for deleted/archived threads if needed
- [ ] Add tests for open/select/close/reopen behavior.

**Acceptance:**

- Subagent tabs persist while switching between workspace tabs.
- Closing a subagent tab only closes UI state.
- Review and Files behave as singleton tabs.

---

## Task 4: Derive thread workspace view model

**Purpose:** Keep UI components small and test the data mapping separately from
rendering.

**Files:**

- new `apps/web/src/threadWorkspaceViewModel.ts`
- new `apps/web/src/threadWorkspaceViewModel.test.ts`
- `apps/web/src/session-logic.ts` if shared helpers are better located there

**Steps:**

- [ ] Define `ThreadSubagentSummary`.
- [ ] Derive subagents from `OrchestrationThreadActivity` payloads with
      `itemType === "collab_agent_tool_call"`.
- [ ] Prefer explicit child thread id, nickname, role, status, and provider item
      id when present.
- [ ] Add fallback parsing for summary/detail when provider metadata is lossy.
- [ ] Derive progress rows from active plan/proposed plan and keep the existing
      plan semantics.
- [ ] Derive overview rows for branch, worktree, diff stats, PR metadata, checks,
      comments, and sources from currently available state.
- [ ] Add tests for complete metadata, partial metadata, and no-subagent cases.

**Acceptance:**

- Overview and subagent tabs can render from a single stable view model.
- Missing provider fields degrade to muted/unknown UI instead of throwing.

---

## Task 5: Build ThreadWorkspacePanel shell

**Purpose:** Replace the diff/preview-specific right panel shell with a tabbed
workspace shell.

**Files:**

- `apps/web/src/components/ChatRightPanel.tsx`
- new `apps/web/src/components/ThreadWorkspacePanel.tsx`
- new `apps/web/src/components/ThreadWorkspaceTabs.tsx`
- new browser/component tests if existing pattern supports them

**Steps:**

- [ ] Create `ThreadWorkspacePanel` with tab strip and active content slot.
- [ ] Render `Review` tab through existing `DiffPanel`.
- [ ] Render `Files` tab through existing `PreviewPanel` first; file explorer
      can be improved later if current preview semantics are narrower.
- [ ] Render `AgentThreadPanel` for agent tabs.
- [ ] Preserve lazy loading via `Suspense` and `DiffWorkerPoolProvider`.
- [ ] Keep right panel inline/sidebar behavior and sheet behavior on narrow
      screens.
- [ ] Update close/open callbacks to operate on workspace tabs.

**Acceptance:**

- Review and Files work in the new tab shell.
- Subagent tabs render without breaking existing panel sizing.
- Heavy content stays lazy-mounted.

---

## Task 6: Build floating Thread Overview

**Purpose:** Replace the current plan/task-only sidebar behavior with a richer
current-thread overlay.

**Files:**

- new `apps/web/src/components/ThreadOverviewFloatingPanel.tsx`
- new `apps/web/src/components/ThreadOverviewSection.tsx` if useful
- new `apps/web/src/components/SubagentStatusLabel.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/PlanSidebar.tsx` only if removing or deprecating

**Steps:**

- [ ] Add overlay open/close state per active thread.
- [ ] Render environment rows using existing thread/project/worktree data.
- [ ] Render diff stats using existing `TurnDiffSummary` and git/worktree stats
      where available.
- [ ] Render PR check rollup and comments from existing source-control data and
      helpers.
- [ ] Render progress from active plan/proposed plan.
- [ ] Render subagent list with status labels and wave animation for working
      state.
- [ ] Click on a subagent opens/focuses the matching agent workspace tab.
- [ ] Add responsive sheet fallback for narrow viewports.

**Acceptance:**

- Overview can be toggled independently of the right workspace panel.
- It does not replace global left navigation.
- It exposes at least the data available today and handles missing source
  control data gracefully.

---

## Task 7: Add AgentThreadPanel

**Purpose:** Show subagent chat or summary in a persistent tab.

**Files:**

- new `apps/web/src/components/AgentThreadPanel.tsx`
- `apps/web/src/components/chat/MessagesTimeline.tsx` if reusing message rows
- `apps/web/src/store.ts` only if child thread detail needs new selectors

**Steps:**

- [ ] Render header with display name, role, and status.
- [ ] If child thread messages are available, render a compact conversation
      timeline.
- [ ] If only summary/activity data is available, render a summary fallback with
      source activity rows.
- [ ] Add "Open main thread" or "Show in overview" affordance only if useful.
- [ ] Avoid sending provider close commands when the tab closes.

**Acceptance:**

- Subagent tab is useful even with summary-only data.
- Full child-thread rendering can be added later without changing tab behavior.

---

## Task 8: Update header and timeline open actions

**Purpose:** Replace scattered right-panel buttons with workspace-aware actions.

**Files:**

- `apps/web/src/components/chat/ChatHeader.tsx`
- `apps/web/src/components/chat/ChatHeaderBar.tsx` if action layout changes
- `apps/web/src/components/chat/CompactComposerControlsMenu.tsx`
- `apps/web/src/components/chat/MessagesTimeline.tsx`
- `apps/web/src/components/chat/ChangedFilesTree.tsx` if review open links live
  there

**Steps:**

- [ ] Replace separate file-preview/diff toggles with workspace open controls
      that still expose Review and Files directly.
- [ ] Preserve existing keyboard shortcuts for diff/review and file preview.
- [ ] Wire timeline Review buttons to open the Review workspace tab.
- [ ] Wire file/chip actions to open the Files workspace tab.
- [ ] Wire identifiable subagent activity rows to open the subagent tab.

**Acceptance:**

- Existing user workflows still reach Review and Files quickly.
- The header feels like one workspace model, not two unrelated buttons.

---

## Task 9: Styling and responsive polish

**Purpose:** Adapt the prototype to Ryco's current design language.

**Files:**

- all new components from previous tasks
- existing Tailwind class call sites in `ChatView.tsx` / `ChatRightPanel.tsx`

**Steps:**

- [ ] Use existing UI primitives: `Button`, `Toggle`, `Tooltip`, `ScrollArea`,
      `Badge`, and sidebar sheet primitives.
- [ ] Keep repeated rows stable height to avoid layout shifts.
- [ ] Use lucide icons instead of text placeholders.
- [ ] Keep section separators and rows, avoiding nested cards.
- [ ] Confirm text truncation for long branch names, file paths, and agent names.
- [ ] Verify dark/light theme behavior if Ryco supports both.
- [ ] Verify wide desktop, laptop, and mobile widths.

**Acceptance:**

- The implementation feels native to Ryco.
- No visible text overlap in tab strip, overview rows, or subagent labels.

---

## Task 10: Tests and verification

**Purpose:** Finish with confidence and preserve repo requirements.

**Steps:**

- [ ] Run focused route search tests.
- [ ] Run workspace tab reducer tests.
- [ ] Run view-model derivation tests.
- [ ] Run component/browser tests for overview and tabs if local patterns support
      them.
- [ ] Manually verify: - floating overview toggle - Review tab - Files tab - subagent tab open/close/reopen - legacy diff/preview URLs - mobile/sheet behavior
- [ ] Run required repo commands: - `bun fmt` - `bun lint` - `bun typecheck`

Use `bun run test` for any Vitest runs. Do not use `bun test`.

**Acceptance:**

- Required commands pass.
- No new polling or idle animation cost is introduced.
- Existing diff and preview workflows continue to work.
