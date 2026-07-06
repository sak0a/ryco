# Item Action Threads — Design Spec

## Goal

PRs, issues, and Jira tickets that need work grow a **fix/implement
action**: one click opens a draft thread with a preset prompt, the item
attached as chat context, and a resolved workspace plan (which worktree /
branch the agent will work in). The user reviews the prompt and sends;
only then are worktrees/branches created.

v1 actions (all decided in brainstorming):

| Item        | Condition (from already-fetched detail) | Action                  |
| ----------- | --------------------------------------- | ----------------------- |
| PR          | `mergeability === "conflicting"`        | Resolve merge conflicts |
| PR          | latest review state `changes_requested` | Address review feedback |
| PR          | check rollup contains failures          | Fix failing checks      |
| Issue       | `state === "open"`                      | Implement               |
| Jira ticket | open / in-progress state category       | Implement               |

Locked UX decisions:

- **Attention banner** in the detail views (not a toolbar split-button, no
  list-row quick actions in v1): one banner above the tabs, one row per
  applicable action, each with its own fix button.
- **Prefilled draft**, never auto-send: click → draft thread with preset
  prompt + context chip + workspace plan; git mutations happen on first
  send via the bootstrap. Abandoned drafts create nothing.
- Workspace resolution decision tree (PR actions):
  1. Worktree already linked to the PR → **reuse** it.
  2. PR head branch checked out in another Ryco worktree → **reuse** it.
  3. Head branch checked out at the **main repo root** → open a **local
     thread** on the project root with an inline notice ("Working in the
     main repo checkout on `<branch>`").
  4. Otherwise → **create** a worktree checking out the PR head branch.
- Issue/Jira "Implement": reuse the linked worktree if one exists, else
  plan a new branch (AI-generated name; Jira branch names include the key
  per template) + worktree from the base branch.

## Non-goals

- Auto-sending the preset prompt (rejected in favor of drafts).
- List-row hover quick actions and worktree-badge actions (possible v2).
- Deduplicating drafts: clicking the same action twice makes two
  independent drafts (v2 could focus the existing one).
- Auto-transitioning Jira tickets (e.g. → In Progress) when starting work;
  the existing manual transition UI remains the way.
- New polling: banner state derives entirely from the already-fetched
  detail data.
- Merge-queue/auto-merge integration, PR description updates, comment
  replies.

## Current state (verified)

- Detail views with the needed state exist:
  `PullRequestDetail.tsx` (mergeability, reviews, `checkRollup`),
  `IssueDetail.tsx`, `WorkItemDetail.tsx` (all under
  `apps/web/src/components/projectExplorer/`).
- Worktree reuse lookups exist server-side: `findByOrigin` /
  `findByWorkItem` (`worktreeOperations.ts:215-287`) and
  `findLocalHeadBranch` (`GitManager.ts:1509-1533`, also detects the
  main-repo-root case, which today hard-errors in
  `preparePullRequestThread` at `GitManager.ts:1550-1555`).
- Worktree creation from intents exists: `CreateWorktreeIntent`
  (`packages/contracts/src/worktree.ts:69-99`, kinds
  `branch | pr | issue | workItem | newBranch`) executed by
  `createWorktreeForProject` (`worktreeOperations.ts:212-606`), including
  AI branch names and Jira key templates.
- Draft-first threads exist: drafts live in `composerDraftStore`
  (`DraftSessionState`, `composerDraftStore.ts:106-119`) and promote on
  first send via `ThreadTurnStartBootstrap`
  (`orchestration.ts:631-655`) handled by `dispatchBootstrapTurnStart`
  (`apps/server/src/ws/context.ts:275-481`). The bootstrap's
  `prepareWorktree` currently supports only `{ projectCwd, baseBranch,
branch? }` — it cannot express "check out PR head" or "reuse worktree X".
- Preset-prompt precedent: `buildPlanImplementationPrompt`
  (`apps/web/src/proposedPlan.ts:73-90`).

## Architecture

```
Detail view (PR / issue / work item)
  → deriveItemActions(detail)                        [pure, web]
  → <NeedsAttentionBanner actions=… />               [web]
      click "Resolve conflicts"
  → rpc git.resolveActionWorkspace(item)             [read-only, fast]
      → { plan: reuse-worktree | local-checkout | create-worktree | local-main }
  → open draft: preset prompt + attach context + draft.pendingWorkspace = plan
      (user edits, presses send)
  → thread.turn.start bootstrap { createThread, prepareWorkspace: plan }
      → server re-resolves + executes plan (reuse/attach or create), then turn starts
```

The click-time resolution is **advisory** (lets the draft display the
plan); the send-time execution is **authoritative** (server re-resolves,
so a stale plan degrades gracefully instead of failing).

## Contracts

### `ItemActionWorkspacePlan` (new, `packages/contracts/src/worktree.ts`)

```ts
export const ItemActionWorkspacePlan = Schema.Union([
  Schema.Struct({
    // decision-tree outcomes 1 & 2
    kind: Schema.Literal("reuse-worktree"),
    worktreeId: WorktreeId,
    worktreePath: TrimmedNonEmptyString,
    branch: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    // outcome 3: branch at main repo root
    kind: Schema.Literal("local-main-checkout"),
    branch: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    // outcome 4 / issue / workItem create
    kind: Schema.Literal("create-worktree"),
    intent: CreateWorktreeIntent,
    baseBranch: Schema.optional(TrimmedNonEmptyString),
    plannedBranch: Schema.optional(TrimmedNonEmptyString), // display only
  }),
]);
```

### RPC `git.resolveActionWorkspace` (new, read-only)

`packages/contracts/src/rpc.ts` + handler in
`apps/server/src/ws/context/worktreeOperations.ts`:

- Input: `{ projectId, intent: CreateWorktreeIntent }` (the same intent
  union expresses PR #, issue #, or workItem key).
- Output: `{ plan: ItemActionWorkspacePlan }`.
- Implementation composes existing pieces: `findByOrigin` /
  `findByWorkItem` → `findLocalHeadBranch` (PR only; also reports the
  main-repo-root case) → fallback `create-worktree`. **No git mutations.**

### Bootstrap extension

`ThreadTurnStartBootstrap` (`orchestration.ts:631-655`):

- Add `prepareWorkspace: Schema.optional(ItemActionWorkspacePlan)`,
  superseding `prepareWorktree` when present (existing `prepareWorktree`
  stays for the current worktree-mode send flow; no behavior change for
  existing callers).
- Server (`dispatchBootstrapTurnStart`):
  - `reuse-worktree` → verify the worktree still exists (else re-resolve),
    create thread with its `branch`/`worktreePath`, dispatch
    `thread.attach-to-worktree`.
  - `local-main-checkout` → verify the branch is still checked out at root
    (else re-resolve); thread on project root with `branch` set,
    `worktreePath: null`.
  - `create-worktree` → execute via the existing `createWorktreeForProject`
    routine (which handles PR checkout through
    `preparePullRequestThread`-equivalent paths, fork remotes, AI branch
    names, Jira key templates, setup scripts, cleanup-on-failure), then
    attach the bootstrap-created thread. Refactor note: the routine today
    both creates a worktree _and_ a thread; factor its worktree-creation
    core out so the bootstrap can attach the thread it already created.
  - Existing failure cleanup (delete just-created thread) applies.

## Web changes

### Action derivation (pure)

`apps/web/src/components/projectExplorer/itemActions.ts`:

- `derivePullRequestActions(detail: SourceControlChangeRequestDetail):
ItemAction[]` — conflicts / review / checks rows, each with label, icon,
  severity, and the prompt-template id. "Latest review state" means: the
  most recent review per reviewer, ignoring dismissed; any
  `changes_requested` survivor triggers the action.
- `deriveIssueActions`, `deriveWorkItemActions` — single Implement action
  for open items.
- Merged/closed/done items derive `[]` → banner absent.

### `NeedsAttentionBanner.tsx`

`apps/web/src/components/projectExplorer/NeedsAttentionBanner.tsx`:

- Props: `actions: ItemAction[]`, `onRun(action)`, `busyActionId?`.
- Renders between the detail header and the tab strip in
  `PullRequestDetail` / `IssueDetail` / `WorkItemDetail` (approved
  mockup: warning-tinted container, one row per action: state badge +
  one-line summary + right-aligned fix button; the most severe action's
  button uses the primary style).
- While `git.resolveActionWorkspace` is in flight the clicked button shows
  a spinner; other buttons stay enabled.

### Click flow

New hook `apps/web/src/hooks/useStartItemActionThread.ts`:

1. Build the `CreateWorktreeIntent` from the item
   (`{kind:"pr", number}` / `{kind:"issue", …}` / `{kind:"workItem", …}`).
2. `git.resolveActionWorkspace` → plan. On error: toast, stay put.
3. Create a draft session (same path as `useHandleNewThread`) with:
   - `pendingWorkspace: plan` (new `DraftSessionState` field; drafts with
     a `reuse-worktree` plan set `worktreePath`/`branch` for display,
     `local-main-checkout` sets `branch` only),
   - composer prompt = preset from `itemActionPrompts.ts`,
   - context auto-attached via the Spec A machinery
     (`addSourceControlContext` / `addWorkItemContext`, detail already in
     hand from the open detail view — reuse it, no refetch),
   - close the Project Explorer dialog and navigate to the draft.
4. Draft UI: workspace plan renders as a small line under the composer
   header — "↳ reusing worktree `feature/foo`", "↳ will create worktree
   from `main`", or "↳ working in the main repo checkout on
   `feature/foo`" (the approved inline notice).

### Preset prompts

`apps/web/src/itemActionPrompts.ts` (sibling of `proposedPlan.ts`), one
builder per action. Prompts are short, reference the attached context
instead of duplicating it, and end with concrete verification steps.
Sketches (final copy at implementation):

- **Conflicts**: "The attached PR has merge conflicts with `<base>`. Fetch
  and merge `<base>` into `<head>`, resolve every conflict preserving the
  intent of both sides, run the project's checks, and push."
- **Review**: "The attached PR has requested changes. Read the review
  comments in the attached context, address each one (code or reasoned
  reply), run checks, push, and summarize what changed per comment."
- **Checks**: "CI is failing on the attached PR (`<workflow/job names>`).
  Inspect the failing runs (`gh run view …`), reproduce locally where
  possible, fix, and push."
- **Implement issue/ticket**: "Implement the attached
  <issue/ticket>. Follow its acceptance criteria; ask before expanding
  scope. If a worktree was reused, run `git status` first and take any
  uncommitted work into account."

The "reused worktree may be dirty" instruction is appended automatically
whenever the plan kind is `reuse-worktree` or `local-main-checkout`.

## Implementation notes (deviations)

- The bootstrap's `prepareWorkspace` carries `{ projectId, intent }`, not
  the resolved plan: the server re-resolves the intent at send time, which
  makes the send authoritative by construction (a stale click-time plan
  can't be executed) and doubles as the "verify the worktree/branch still
  exists" step the spec called for.
- Draft sessions are keyed one-per-logical-project, so clicking a second
  action (or the same one twice) reuses the project draft and overwrites
  its prompt/context/plan — there are no parallel independent drafts.
- The click-time plan is stored on the draft (`pendingWorkspace`) purely
  for the composer's plan line, which also carries a ✕ that discards the
  plan and reverts the draft to a plain local thread.
- `createWorktreeForProject` gained an `existingThreadId` option instead
  of a standalone worktree-creation core: with it, `thread.create`
  dispatches become `thread.meta.update` on the bootstrap's thread, and
  the missing-default-model-selection failure only applies when a thread
  or AI branch name actually needs it (deterministic fallbacks otherwise).
- Banner placement threads through the detail views' body components as a
  `banner` ReactNode slot (their headers live inside inner components).

## Behavior & edge cases

| Case                                                  | Handling                                                                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Merged/closed PR, done ticket                         | No actions derived → no banner.                                                                                                     |
| Multiple states at once                               | One banner, one row per action (approved mockup).                                                                                   |
| Fork (cross-repository) PR                            | `create-worktree` path uses the existing PR checkout machinery (`gh pr checkout` handles fork remotes).                             |
| Branch at main repo root                              | `local-main-checkout` plan (approved option A) — local thread + inline notice; today's hard error is retired for this flow.         |
| Reused worktree has uncommitted changes               | Reused as-is; prompt appends the `git status` instruction.                                                                          |
| Plan stale at send (worktree deleted, branch moved)   | Server re-resolves at bootstrap time and proceeds with the fresh outcome; the thread's actual workspace is authoritative.           |
| `resolveActionWorkspace` fails (CLI missing, offline) | Toast with normalized provider error; no draft created.                                                                             |
| Draft abandoned                                       | Nothing was created (resolution is read-only; mutations live in the bootstrap).                                                     |
| Same action clicked twice                             | Two independent drafts (dedup is v2).                                                                                               |
| Send fails after worktree creation                    | Existing bootstrap cleanup deletes the created thread; worktree cleanup follows `createWorktreeForProject`'s existing failure path. |
| Jira ticket with existing linked branch (no worktree) | Existing `branchSource: "existing"` handling inside the workItem intent applies.                                                    |

## Testing

| Area                              | Coverage                                                                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `itemActions.ts`                  | Each condition → action; combined states; closed/merged/done → `[]`; latest-review-per-reviewer logic incl. dismissals.                                          |
| `itemActionPrompts.ts`            | Template output per action; dirty-worktree suffix gating by plan kind.                                                                                           |
| `resolveActionWorkspace` (server) | All four tree outcomes for PRs; issue/workItem reuse vs create; read-only guarantee (no git mutation side effects).                                              |
| Bootstrap extension (server)      | Each plan kind end-to-end against a fixture repo: reuse attaches, local-main threads on root, create executes intent; stale-plan re-resolution; failure cleanup. |
| Banner (browser)                  | Renders rows per action, spinner on click, absent when no actions.                                                                                               |
| Click flow (browser)              | Click → draft opens with prompt + chip + plan line; explorer dialog closes; resolution error → toast, no navigation.                                             |

## Dependencies

Builds on the companion spec
`2026-07-05-chat-context-jira-and-timeline-design.md` (context
attach/chips for drafts, work-item contexts). Implement that first.

## Pre-merge gate

Per `AGENTS.md`: `bun fmt`, `bun lint`, `bun typecheck`, `bun run test`
must pass.
