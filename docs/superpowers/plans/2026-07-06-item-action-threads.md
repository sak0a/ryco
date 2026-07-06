# Item Action Threads — Implementation Plan

> **For agentic workers:** Execute task-by-task, in order. Steps use checkbox
> (`- [ ]`) syntax for tracking. Each task ends with a verify step and a
> commit. Default to inline execution.

**Goal:** PR/issue/Jira detail views grow a needs-attention banner whose
actions (resolve conflicts / address review / fix checks / implement) open
a prefilled draft thread with a preset prompt, the item attached as chat
context, and a resolved workspace plan. Git mutations happen only on first
send via the bootstrap.

**Architecture:** A read-only server resolver
(`git.resolveActionWorkspace`) maps a `CreateWorktreeIntent` to an
`ItemActionWorkspacePlan` (reuse-worktree / local-main-checkout /
create-worktree) for display in the draft. On send, the bootstrap carries
`prepareWorkspace: { projectId, intent }`; the server **re-resolves** the
intent (authoritative) and executes the outcome: reuse → attach the
bootstrap-created thread to the existing worktree; local-main → thread on
the project root; create → run the existing `createWorktreeForProject`
machinery extended with an `existingThreadId` option so it attaches the
bootstrap's thread instead of creating its own.

**Reference spec:** `docs/superpowers/specs/2026-07-05-item-action-threads-design.md`
(builds on the shipped Spec A machinery).

**Pre-merge gate:** `bun fmt && bun lint && bun typecheck && bun run test`
(server tests need `GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=commit.gpgsign
GIT_CONFIG_VALUE_0=false GIT_CONFIG_KEY_1=tag.gpgsign
GIT_CONFIG_VALUE_1=false` while the 1Password signing agent is flaky).

---

## Verified anchors

- `CreateWorktreeIntent` union: `packages/contracts/src/worktree.ts:69-99`.
- Reuse lookups: `projectionWorktrees.findByOrigin` / `findByWorkItem`
  (`apps/server/src/ws/context/worktreeOperations.ts:220-243`).
- PR resolution without checkout: `gitWorkflow.resolvePullRequest`
  (returns `GitResolvedPullRequest` with `headBranch`, `git.ts:97-105`)
  plus `gitWorkflow.listRefs` (refs carry `worktreePath`).
- Root-path comparison helper: `isProjectRootPath`
  (`worktreeOperations.ts:106-114`).
- `createWorktreeForProject` (`worktreeOperations.ts:212-606`): reuse
  early-return creates a thread + attaches (256-287); create path
  dispatches `worktree.create` → `thread.create` → attach → setup script
  (534-601) with cleanup-on-failure.
- Bootstrap: `ThreadTurnStartBootstrap` (`orchestration.ts`),
  `dispatchBootstrapTurnStart` (`apps/server/src/ws/context.ts:275-481`),
  built client-side by `buildSendTurnBootstrap`
  (`apps/web/src/hooks/executeChatSendTurn.ts:230-303`).
- Draft sessions: `DraftSessionState` (`composerDraftStore.ts`),
  `useNewThreadState` (`apps/web/src/hooks/useHandleNewThread.ts:24-146`)
  — note: **one draft session per logical project**; a second action click
  reuses the project draft (documented deviation from the spec's "two
  independent drafts").
- Detail views: `PullRequestDetail.tsx` (tabs at ~298), `IssueDetail.tsx`,
  `WorkItemsTab.tsx`/`WorkItemDetail.tsx` under
  `apps/web/src/components/projectExplorer/`.

## File structure (preview)

| Path                                                                | Status | Responsibility                                                                                  |
| ------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| `packages/contracts/src/worktree.ts`                                | modify | `ItemActionWorkspacePlan` union.                                                                |
| `packages/contracts/src/rpc.ts`                                     | modify | `git.resolveActionWorkspace` method + input/output schemas.                                     |
| `packages/contracts/src/orchestration.ts`                           | modify | Bootstrap `prepareWorkspace: { projectId, intent }`.                                            |
| `apps/server/src/ws/context/worktreeOperations.ts`                  | modify | `resolveActionWorkspace` (read-only) + `existingThreadId` option on `createWorktreeForProject`. |
| `apps/server/src/ws/gitRpc.ts`                                      | modify | Register the RPC handler.                                                                       |
| `apps/server/src/ws/context.ts`                                     | modify | Execute `prepareWorkspace` in `dispatchBootstrapTurnStart`.                                     |
| `apps/web/src/components/projectExplorer/itemActions.ts`            | create | Pure action derivation.                                                                         |
| `apps/web/src/components/projectExplorer/itemActions.test.ts`       | create | Derivation tests.                                                                               |
| `apps/web/src/itemActionPrompts.ts`                                 | create | Preset prompt builders.                                                                         |
| `apps/web/src/itemActionPrompts.test.ts`                            | create | Prompt tests.                                                                                   |
| `apps/web/src/components/projectExplorer/NeedsAttentionBanner.tsx`  | create | Banner UI.                                                                                      |
| `apps/web/src/components/projectExplorer/PullRequestDetail.tsx`     | modify | Render banner + start-action wiring.                                                            |
| `apps/web/src/components/projectExplorer/IssueDetail.tsx`           | modify | Render banner.                                                                                  |
| `apps/web/src/components/projectExplorer/WorkItemDetail.tsx`        | modify | Render banner.                                                                                  |
| `apps/web/src/components/projectExplorer/ProjectExplorerDialog.tsx` | modify | Pass start-action deps; close on start.                                                         |
| `apps/web/src/hooks/useStartItemActionThread.ts`                    | create | resolve → draft → prompt/context/plan → navigate.                                               |
| `apps/web/src/composerDraftStore.ts`                                | modify | `pendingWorkspace` on `DraftSessionState`.                                                      |
| `apps/web/src/components/chat/ChatComposer.tsx` (or shell)          | modify | Draft workspace plan line.                                                                      |
| `apps/web/src/components/ChatView.tsx` + `executeChatSendTurn.ts`   | modify | Bootstrap carries `prepareWorkspace`.                                                           |
| `apps/web/src/rpc/useGit.ts` / `gitAtoms.ts`                        | modify | Client RPC wrapper.                                                                             |

---

## Task 1: Contracts

- [x] `worktree.ts`: add `ItemActionWorkspacePlan` union
      (`reuse-worktree { worktreeId, worktreePath, branch }` /
      `local-main-checkout { branch }` /
      `create-worktree { plannedBranch?: string }`) — the intent itself is not
      embedded in the plan; it travels alongside.
- [x] `rpc.ts`: `GitResolveActionWorkspaceInput = { projectId, intent:
CreateWorktreeIntent }`, `GitResolveActionWorkspaceResult = { plan }`;
      add `git.resolveActionWorkspace` to `WS_METHODS` + the Rpc group.
- [x] `orchestration.ts`: `ThreadTurnStartBootstrap` gains
      `prepareWorkspace: Schema.optional(Schema.Struct({ projectId, intent:
CreateWorktreeIntent }))`. Mutually exclusive with `prepareWorktree`
      (assert in the server handler, not the schema).
- [x] Contract decode tests; typecheck; commit.

## Task 2: Server read-only resolver

- [x] `worktreeOperations.ts`: `resolveActionWorkspace(input)`:
  1. pr/issue/workItem → `findByOrigin`/`findByWorkItem`; registered
     worktree with non-null `worktreePath` → `reuse-worktree`.
  2. PR only: `gitWorkflow.resolvePullRequest({ cwd, reference })` →
     `headBranch`; `gitWorkflow.listRefs` → local ref named `headBranch`:
     checked out at project root (`isProjectRootPath`) →
     `local-main-checkout`; checked out elsewhere → still
     `create-worktree` (send-time `preparePullRequestThread` reuses that
     checkout without mutating).
  3. Fallback → `create-worktree` (`plannedBranch` = PR `headBranch`;
     omitted for issue/workItem where the name is AI-generated at send).
     No git mutations anywhere.
- [x] Register in `gitRpc.ts` following `git.resolvePullRequest`.
- [x] Tests: each tree outcome with fake projectionWorktrees/gitWorkflow.
- [x] Typecheck + server tests; commit.

## Task 3: Server bootstrap execution

- [x] `createWorktreeForProject` gains `options?: { existingThreadId?:
ThreadId }`:
  - reuse early-return: with `existingThreadId`, dispatch
    `thread.meta.update` (branch/worktreePath) + `thread.attach-to-worktree`
    instead of `thread.create`; return `sessionId: existingThreadId`.
  - create path: with `existingThreadId`, replace the `thread.create`
    dispatch with `thread.meta.update`, attach + setup script use the
    existing thread id.
- [x] `dispatchBootstrapTurnStart`: when `bootstrap.prepareWorkspace` is
      set, after `createThread`, re-resolve via `resolveActionWorkspace`:
  - `reuse-worktree` → `thread.meta.update` + attach (worktree verified by
    the resolver); set `targetWorktreePath`.
  - `local-main-checkout` → `thread.meta.update` (branch, worktreePath
    null).
  - `create-worktree` → `createWorktreeForProject({ projectId, intent,
  worktreeLocation: undefined }, { existingThreadId: command.threadId })`
    (it owns its setup script; the bootstrap's `runSetupScript` is not set
    for this path).
    Existing failure cleanup (thread delete) still applies.
- [x] Tests: bootstrap turn.start with each plan kind against fixture
      repos (mirror existing bootstrap tests if present; else cover
      `createWorktreeForProject` with `existingThreadId` + resolver
      integration).
- [x] Typecheck + server tests (with signing disabled); commit.

## Task 4: Web derivation + prompts

- [x] `itemActions.ts`: `ItemAction = { id, kind:
"pr-conflicts" | "pr-review" | "pr-checks" | "implement-issue" |
"implement-work-item", label, summary, severity: "warning" | "error" }`;
      `derivePullRequestActions(detail)` (conflicting mergeability; latest
      review per reviewer ignoring dismissed → any `changes_requested`;
      check rollup failures), `deriveIssueActions`, `deriveWorkItemActions`
      (open/in_progress only). Closed/merged/done → `[]`.
- [x] `itemActionPrompts.ts`: one builder per action kind, referencing the
      attached context; append the `git status` first-step instruction when
      the plan reuses an existing checkout (`reuse-worktree` /
      `local-main-checkout`).
- [x] Unit tests for both; typecheck; commit.

## Task 5: Banner UI + detail views

- [x] `NeedsAttentionBanner.tsx`: warning-tinted container above the tab
      strip, one row per action (badge + summary + right-aligned button; most
      severe action gets the primary style); `busyActionId` shows a spinner on
      the in-flight button only.
- [x] Render in `PullRequestDetail` (between header and tabs),
      `IssueDetail`, `WorkItemDetail`; actions derived from the already-loaded
      detail. Wire an `onRunItemAction(action)` prop (or hook use inside the
      view) plus dialog-close on successful start.
- [x] Browser test: banner renders per state, absent when no actions.
- [x] Typecheck + tests; commit.

## Task 6: Click flow + draft + send wiring

- [x] `composerDraftStore.ts`: `DraftSessionState.pendingWorkspace?:
{ intent: CreateWorktreeIntent; plan: ItemActionWorkspacePlan } | null`
      (+ `setDraftThreadContext` passthrough; cleared with the draft/session
      or via the plan line's remove affordance).
- [x] `useStartItemActionThread.ts`: build intent from the item →
      `git.resolveActionWorkspace` (toast + stay on failure) → reuse
      `useNewThreadState` semantics to open/reuse the project draft with
      `branch`/`worktreePath`/`envMode` from the plan → `setPrompt` (preset) →
      attach context via Spec A machinery (detail already in hand) → set
      `pendingWorkspace` → navigate; caller closes the explorer dialog.
- [x] Draft plan line: in the composer area for drafts with
      `pendingWorkspace`, render "↳ reusing worktree `branch`" / "↳ will
      create worktree for this PR/issue/ticket" / "↳ working in the main repo
      checkout on `branch`", with ✕ to discard the plan (clears
      branch/worktreePath/pendingWorkspace).
- [x] Send: ChatView passes the draft's `pendingWorkspace` into
      `executeChatSendTurn`; `buildSendTurnBootstrap` emits
      `prepareWorkspace: { projectId, intent }` (and suppresses
      `prepareWorktree`/`runSetupScript` for this path).
- [x] Tests: draft-store passthrough; bootstrap-builder unit test; browser
      test click → draft opens with prompt + chip + plan line.
- [x] Typecheck + tests; commit.

## Task 7: Gate

- [x] `bun fmt && bun lint && bun typecheck && bun run test` (server with
      signing-disabled env). Update spec with deviations; commit.
