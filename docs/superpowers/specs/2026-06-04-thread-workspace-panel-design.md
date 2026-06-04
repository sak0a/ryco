# Thread Workspace Panel Design

## Goal

Replace Ryco's task-only right sidebar with a Codex-app-inspired workspace
model that separates global navigation from current-thread context.

The left sidebar remains the place to move between environments, projects,
worktrees, and threads. The new right-side experience focuses on the selected
thread: subagent chats, review/diff, files, and a floating thread overview with
environment state.

The first implementation should ship a focused subset:

- A floating Thread Overview overlay.
- Persistent workspace tabs for subagent chats.
- Real `Review` and `Files` tabs backed by existing Ryco functionality.
- Subagent status presentation adapted to Ryco's current design language,
  including a working animation similar to the existing active-thread wave.

Terminal, Browser, and Side chat are intentionally out of first scope and can
be added later as new workspace tab kinds.

Prototype: `docs/superpowers/prototypes/thread-workspace-panel-demo.html`

## Current State

Ryco currently has the relevant pieces, but they are split across several
surfaces:

- `apps/web/src/components/AppSidebarLayout.tsx` owns the global left sidebar.
- `apps/web/src/components/ChatRightPanel.tsx` owns the route-backed right panel,
  currently limited to `diff` and `preview`.
- `apps/web/src/rightPanelRouteSearch.ts` models right panel URL state as
  `diff | preview`.
- `apps/web/src/components/PlanSidebar.tsx` shows only active plan/task state.
- `apps/web/src/components/chat/ChatHeader.tsx` exposes separate file-preview
  and diff buttons in the top header.
- `apps/web/src/components/DiffPanel.tsx` and `PreviewPanel.tsx` already provide
  the core Review/Files functionality.
- Thread activity is already persisted as `OrchestrationThreadActivity`, and
  provider runtime events already classify delegated-agent-like tools as
  `collab_agent_tool_call`.

This means the redesign should be an integration and data-model pass, not a
ground-up UI rewrite.

## User Decisions

- Subagent chats should be real workspace tabs that stay open until closed.
- Thread Overview should be a floating overlay over the main chat, not a
  required right-panel tab.
- First implementation should include subagent chats, Review, and Files only.
  Terminal, Browser, and Side chat can be implemented later.
- Visual treatment should be adapted to Ryco's existing design, not copied
  one-to-one from the official Codex app screenshots.

## UX Model

### Global Left Sidebar

The existing left sidebar remains global navigation. It should not absorb the
new thread overview responsibilities. It continues to answer:

- Which project/worktree/thread am I in?
- What other threads can I switch to?
- What broad session status does each thread have?

### Floating Thread Overview

Thread Overview is a floating panel toggled from the chat header or compact
control menu. It appears above the main thread content and can be dismissed
without changing the active workspace tab.

It summarizes current-thread state:

- Environment/workspace status.
- Change count and diff stats.
- execution mode/local vs remote label where available.
- Current branch/worktree.
- Linked PR/issue row when available.
- PR check rollup and comments count when available.
- Progress derived from active plan/proposed plan plus relevant activities.
- Subagent list with status.
- Sources/context used by the current thread.

The overlay should be useful but not modal:

- Clicking outside does not have to close it in the first implementation.
- It must not block composer or right panel usage except where it visibly
  overlaps.
- It should preserve scroll position while open.
- It should use responsive sheet behavior on narrow viewports if the floating
  card would be cramped.

### Workspace Tabs

The right panel becomes a route-backed workspace tab shell. Tabs are persistent
within the active thread until the user closes them.

Initial tab kinds:

- `agent`: a subagent chat tab.
- `review`: the current diff/review view.
- `files`: the current file preview / file explorer view.

Later tab kinds:

- `terminal`
- `browser`
- `sideChat`

The shell should support:

- Selecting an existing tab.
- Opening a tab from overview rows or chat cards.
- Closing closeable tabs.
- Keeping `review` and `files` as stable singleton tabs per thread.
- Keeping subagent tabs as one tab per child agent thread or provider item id.
- Preserving state in URL search params enough for refresh/deep links.

When no workspace tab is open, the right panel is collapsed. Opening a subagent,
Review, or Files expands it.

### Subagent Tabs

Subagent tabs show a child agent conversation, or the best available projection
if full child-thread data is not yet available.

Each tab should show:

- Agent display name or nickname.
- Agent role/type when known.
- Status: working, waiting, idle, completed, failed, closed.
- Chat messages/events for that agent when available.
- Summary output when the provider only surfaces a summary.
- Links to related files/diffs where available.

Subagent tabs are persistent:

- Clicking a subagent in Thread Overview opens or focuses its tab.
- Closing the tab removes it from the open tab strip but does not delete or
  close the underlying provider agent thread.
- If the same subagent emits new activity after its tab was closed, it should
  remain listed in Thread Overview and can be reopened.

### Status Animation

Subagent status should borrow the visual language used for active main threads.
The exact implementation can share a utility with existing thread status rows
or introduce a small local component that uses the same timing and color tone.

Recommended states:

- `working`: animated wave/pulse on the agent name or icon.
- `waiting`: amber slow pulse or spinner.
- `idle`: muted static label.
- `completed`: quiet check/status mark.
- `failed`: error tone and icon.
- `closed`: muted static label.

Avoid large animated areas. Animation should be constrained to the subagent
label/icon so a long list remains calm and performant.

## Data Model

### Workspace Tabs

Add a frontend-only workspace tab model first:

```ts
type ThreadWorkspaceTab =
  | {
      kind: "agent";
      key: string;
      title: string;
      agentRef: ThreadSubagentRef;
      closeable: true;
    }
  | {
      kind: "review";
      key: "review";
      title: "Review";
      closeable: false;
    }
  | {
      kind: "files";
      key: "files";
      title: "Files";
      closeable: false;
    };
```

Open tabs should be stored per scoped thread ref in UI state. The selected tab
should also be reflected in URL search params.

### Subagent View Model

Derive a web view model from thread activities and provider data:

```ts
interface ThreadSubagentSummary {
  readonly key: string;
  readonly displayName: string;
  readonly role: string | null;
  readonly status: "working" | "waiting" | "idle" | "completed" | "failed" | "closed";
  readonly providerThreadId?: string | undefined;
  readonly providerItemId?: string | undefined;
  readonly lastActivityAt: string;
  readonly summary?: string | undefined;
}
```

Derivation sources, in priority order:

1. Codex app-server child thread metadata if available.
2. Codex app-server `spawnAgent` / collaboration tool item payloads.
3. Existing `collab_agent_tool_call` activity payloads.
4. Heuristic fallback from activity title/detail if provider payload is lossy.

The first implementation should tolerate missing full chat data. It can show
summary-only content while the protocol spike confirms how child agent threads
are exposed by Codex app-server.

### Route Search

Replace the current narrow `RightPanelMode = "diff" | "preview"` model with a
workspace panel route model:

```ts
type WorkspacePanelSearch = {
  panel?: "1";
  workspaceTab?: "review" | "files" | "agent";
  agentKey?: string;
  diffTurnId?: string;
  diffFilePath?: string;
  previewPath?: string;
};
```

Keep backward compatibility for existing links:

- `?diff=1` maps to `workspaceTab=review`.
- `?preview=1` maps to `workspaceTab=files`.

The parser can continue accepting old params during the migration and strip
them when writing new URLs.

## Component Architecture

### New Components

- `ThreadWorkspacePanel`
  - Owns right-panel tab chrome and delegates content rendering.
  - Replaces the mode-specific top-level switch in `ChatRightPanel.tsx`.

- `ThreadWorkspaceTabs`
  - Renders tab strip, close buttons, add/open menu, and active state.
  - Uses Ryco's existing button/toggle/tooltip primitives.

- `ThreadOverviewFloatingPanel`
  - Replaces first-scope usage of `PlanSidebar`.
  - Renders environment, progress, subagents, checks, and sources.

- `ThreadSubagentsSection`
  - Shared by the floating overview and possibly future settings/debug views.

- `SubagentStatusLabel`
  - Small status label/icon with the active-thread-style wave animation.

- `AgentThreadPanel`
  - Renders full subagent chat when available, summary-only fallback otherwise.

- `deriveThreadWorkspaceViewModel`
  - Pure derivation function for overview state, subagents, open tabs, and
    tab labels. This should live near other web derivation logic and be tested.

### Modified Components

- `ChatView.tsx`
  - Replace `PlanSidebar` rendering with `ThreadOverviewFloatingPanel`.
  - Wire overview toggle state.
  - Open workspace tabs from timeline cards, header controls, and overview
    subagent rows.

- `ChatRightPanel.tsx`
  - Generalize `LazyRightPanel` and `RightPanelInlineSidebar` from diff/preview
    to workspace tabs.
  - Preserve lazy loading for heavy Review/Files content.

- `rightPanelRouteSearch.ts`
  - Introduce workspace tab parsing/writing and legacy param compatibility.

- `ChatHeader.tsx`
  - Replace separate preview/diff buttons with a compact workspace toggle and
    tab/open controls, while preserving keyboard shortcuts.

- `MessagesTimeline.tsx`
  - Keep existing Review buttons, but route them to the `review` workspace tab.
  - Subagent activity rows can open/focus their subagent tab when identifiable.

- `PlanSidebar.tsx`
  - Either delete after migration or keep temporarily if needed for fallback
    while the overview panel is being assembled.

## Visual Direction

Adapt to Ryco's current design system:

- Use existing `bg-card`, `border-border`, muted text, button variants, tooltip,
  and scroll area primitives.
- Avoid copying the official Codex dark card radius/spacing exactly.
- Keep cards at 8px radius or less unless reusing an existing Ryco primitive.
- Preserve dense operational layout. This is not a marketing surface.
- Avoid nested cards. Overview sections should be divided by separators and
  rows, not card-inside-card structures.
- Use lucide icons where a standard symbol exists.
- Keep status colors consistent with existing sidebar/status pill conventions.

## Performance Requirements

This change touches persistent layout and possibly activity projection, so it
must avoid adding idle cost.

- Heavy tab content must lazy mount only after a tab has been opened.
- Closed tabs should unmount unless they need state preservation.
- Subagent wave animation must be CSS-only and limited to visible rows.
- Derivation should be memoized and fed by existing thread slices.
- Do not add polling for subagent state. Consume provider/runtime events that
  already flow through the store.
- PR checks/comments should use existing source-control query caches and should
  not refresh continuously because the overview is open.

## Reliability Requirements

- Missing provider metadata must degrade to summary-only rows, not break the
  panel.
- Unknown subagent status should render as idle/muted.
- Legacy `diff` and `preview` URLs must continue to work.
- If Codex app-server exposes child thread ids inconsistently across versions,
  the UI should key subagents by stable provider item id when available.
- Closing a subagent tab must not send a provider `closeAgent` command.
- Provider-side close/finish events should update status but should not remove
  tabs without user action.

## Open Protocol Spike

Before implementing full subagent chat history, run a focused Codex app-server
capture:

1. Start a thread that explicitly spawns two subagents.
2. Capture raw `item/started`, `item/completed`, and any thread notifications.
3. Confirm where these fields appear:
   - child thread id
   - agent nickname
   - agent role/type
   - status transitions
   - streamed child chat events
4. Decide whether Ryco can subscribe/read child threads automatically or must
   show summary-only content until a child thread is explicitly opened.

The rest of the workspace panel does not need to block on this. It can ship
subagent list and summary tabs first.

## Testing

Add focused tests for:

- Route search parsing and legacy `diff` / `preview` compatibility.
- Workspace tab open/select/close reducer behavior.
- Subagent derivation from `collab_agent_tool_call` activities.
- Overview view-model derivation from active plan, proposed plan, diff stats,
  PR metadata, and subagent summaries.
- `SubagentStatusLabel` states, including working animation class assignment.
- `ThreadWorkspaceTabs` close/focus behavior.
- Chat header controls opening Review and Files tabs.

Use `bun run test` for tests. Do not use `bun test`.

## Verification

Before implementation is considered complete:

- `bun fmt`
- `bun lint`
- `bun typecheck`
- Focused `bun run test` suites for changed modules.
- Browser verification for:
  - desktop wide layout
  - narrow/mobile sheet behavior
  - floating overview open/close
  - Review tab deep link
  - Files tab deep link
  - subagent tab open/close/reopen
  - no text overlap in tab strip or overview rows
