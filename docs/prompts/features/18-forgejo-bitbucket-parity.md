# 18 — Forgejo / Bitbucket integration parity

| Field                       | Value          |
| --------------------------- | -------------- |
| **Batch**                   | Git / workflow |
| **Order in batch**          | 3 of 4         |
| **Depends on (same batch)** | —              |

## Prompt

Close feature gaps between GitHub and Forgejo/Bitbucket source-control providers for worktree and PR workflows.

### Context

- `apps/server/src/sourceControl/GitHubSourceControlProvider.ts` (reference implementation)
- Forgejo/Bitbucket providers in same directory
- `docs/source-control-providers.md`

### Audit and implement missing parity

- PR/MR creation from git panel
- Issue/PR attachment in composer `#` picker
- Publish repository flow
- Workflow/check status in project explorer where applicable

### Requirements

- Close gaps for **Forgejo and Bitbucket** in the same batch (same PR as the rest of batch 05)
- Reuse shared abstractions in `SourceControlProvider.ts` — no duplicate logic
- Tests mirroring `GitHubSourceControlProvider.test.ts` patterns

### Acceptance

- Document which flows now work per provider in PR description
- All new provider tests pass
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
