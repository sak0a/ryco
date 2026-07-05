# Batch 05 — Git / Workflow

Copy everything below the line into your agent session in the **batch worktree**.

---

## Setup

| Item | Value |
|------|-------|
| **Branch** | `feat/batch-git-workflow` |
| **Worktree** | One dedicated worktree for this batch |
| **PR** | Single PR containing all four features |
| **Agent** | One Cursor agent session (no subagents) |

Read [AGENTS.md](../../AGENTS.md).

## Your task

Implement features **16 → 17 → 18 → 19** sequentially on this branch.

```bash
bun fmt && bun lint && bun typecheck && bun run test
```

Do not commit unless explicitly asked.

## Implementation order

| Step | ID | Feature | Feature file |
|------|-----|---------|--------------|
| 1 | 16 | Worktree status chips | [features/16-worktree-status-chips.md](../features/16-worktree-status-chips.md) |
| 2 | 17 | Execution env metadata | [features/17-execution-env-metadata.md](../features/17-execution-env-metadata.md) |
| 3 | 18 | Forgejo + Bitbucket parity | [features/18-forgejo-bitbucket-parity.md](../features/18-forgejo-bitbucket-parity.md) |
| 4 | 19 | Jira ↔ worktree flow | [features/19-jira-worktree-flow.md](../features/19-jira-worktree-flow.md) |

## Feature summaries

### 16 — Worktree chips

Status: idle, in_progress, review, done. Sidebar badges, context menu, server persist. Optional auto `in_progress` on active turn. Extend browser tests.

### 17 — Env metadata

Add `nodeVersion`, `shell` to `ExecutionEnvironmentDescriptor`. Server probe + SSH bootstrap. Show in environment picker. Fix TODO in `overviewSections.tsx`.

### 18 — Provider parity

Close Forgejo **and** Bitbucket gaps vs GitHub in this PR: PR/MR creation, `#` picker attachment, publish, CI status where applicable. Reuse `SourceControlProvider.ts` abstractions. Reference: `GitHubSourceControlProvider.ts`.

### 19 — Jira flow

From work item: create branch, worktree, agent thread. Link Jira key in thread. Branch naming `PROJ-123-slug`. Pre-fill composer with issue attachment.

## Batch acceptance

- [ ] Worktree status persists across reload
- [ ] Shell/node visible in env picker
- [ ] Forgejo and Bitbucket parity improvements with tests
- [ ] Jira → worktree → thread happy path (manual or browser test)
- [ ] Full validation green

## PR title suggestion

`feat: worktree chips, env metadata, SC parity, Jira workflow`
