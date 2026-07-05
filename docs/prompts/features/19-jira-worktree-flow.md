# 19 — Jira ↔ worktree linkage UX

| Field | Value |
|-------|-------|
| **Batch** | Git / workflow |
| **Order in batch** | 4 of 4 |
| **Depends on (same batch)** | — |

## Prompt

Improve the Jira work-item → branch → worktree → agent thread flow.

### Context

- Atlassian/Jira: `apps/web/src/rpc/atlassianAtoms.ts`, `WorkItemsTab`, `WorkItemDetail`
- Worktree creation: `worktreeOperations.ts`
- Chat attachment: composer `#` picker for issues

### Requirements

- From Jira work item detail: actions "Create branch", "Create worktree", "Start agent thread" with linked context
- Thread shows linked Jira key in overview/header
- Branch naming convention from ticket key (e.g. `PROJ-123-slug`)
- Pre-fill composer with issue attachment on new thread from ticket

### Acceptance

- End-to-end: open Jira ticket → create worktree → thread has issue context attached
- Browser or integration test for happy path
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
