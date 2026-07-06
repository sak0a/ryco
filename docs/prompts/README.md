# Implementation Prompts

Ready-to-use prompts for implementing Ryco features and improvements. Each prompt assumes the repo conventions in [AGENTS.md](../../AGENTS.md).

## Workflow

**One batch = one git worktree = one branch = one PR.**

1. Create a worktree for the batch (e.g. `ryco-batch-daily-ux` on branch `feat/batch-daily-ux`).
2. Open that worktree in Cursor and paste the **batch orchestration prompt** from [batches/](./batches/).
3. Implement every feature in the batch **sequentially** on that single branch (order listed in each batch file).
4. Run validation once before opening the PR:

```bash
bun fmt
bun lint
bun typecheck
bun run test
```

Additional: run relevant `*.browser.tsx` tests for UI changes.

**Do not commit unless explicitly asked.**

## Structure

| Directory                | Contents                                                                        |
| ------------------------ | ------------------------------------------------------------------------------- |
| [features/](./features/) | One file per feature (30 prompts) — building blocks referenced by batch prompts |
| [batches/](./batches/)   | **Start here** — one copy-paste orchestration prompt per batch (7 batches)      |

## Batches

| Batch           | Branch (suggested)           | File                                                     | Features               |
| --------------- | ---------------------------- | -------------------------------------------------------- | ---------------------- |
| Daily UX        | `feat/batch-daily-ux`        | [01-daily-ux.md](./batches/01-daily-ux.md)               | 01, 03, 13, 14, 02     |
| Perf / refactor | `feat/batch-perf-refactor`   | [02-perf-refactor.md](./batches/02-perf-refactor.md)     | 05, 06, 09, 04, 08, 07 |
| Agent modes     | `feat/batch-agent-modes`     | [03-agent-modes.md](./batches/03-agent-modes.md)         | 10, 15                 |
| Search & nav    | `feat/batch-search-nav`      | [04-search-nav.md](./batches/04-search-nav.md)           | 11, 12                 |
| Git / workflow  | `feat/batch-git-workflow`    | [05-git-workflow.md](./batches/05-git-workflow.md)       | 16, 17, 18, 19         |
| Ops / trust     | `feat/batch-ops-trust`       | [06-ops-trust.md](./batches/06-ops-trust.md)             | 21, 20, 22, 23, 24, 25 |
| Differentiation | `feat/batch-differentiation` | [07-differentiation.md](./batches/07-differentiation.md) | 26, 27, 28, 29, 30     |

Feature details: see numbered files in [features/](./features/).
