# Implementation Prompts

Ready-to-use prompts for implementing Ryco features and improvements. Each prompt assumes the repo conventions in [AGENTS.md](../../AGENTS.md).

## Validation (every prompt)

Before considering work done:

```bash
bun fmt
bun lint
bun typecheck
bun run test
```

Additional: run relevant `*.browser.tsx` tests for UI changes.

**Do not commit unless explicitly asked.**

## Structure

| Directory | Contents |
|-----------|----------|
| [features/](./features/) | One file per feature (30 prompts) |
| [batches/](./batches/) | One orchestration prompt per batch (7 batches) |

## Batches

| Batch | File | Features | Lead model |
|-------|------|----------|------------|
| Daily UX | [01-daily-ux.md](./batches/01-daily-ux.md) | 1, 2, 3, 13, 14 | Composer 2.5 |
| Perf / refactor | [02-perf-refactor.md](./batches/02-perf-refactor.md) | 4–9 | Composer 2.5 (+ Opus for hard items) |
| Agent modes | [03-agent-modes.md](./batches/03-agent-modes.md) | 10, 15 | Opus 4.8 |
| Search & nav | [04-search-nav.md](./batches/04-search-nav.md) | 11, 12 | GPT 5.5 + Composer 2.5 |
| Git / workflow | [05-git-workflow.md](./batches/05-git-workflow.md) | 16–19 | Composer 2.5 |
| Ops / trust | [06-ops-trust.md](./batches/06-ops-trust.md) | 20–25 | Opus 4.8 |
| Differentiation | [07-differentiation.md](./batches/07-differentiation.md) | 26–30 | Composer 2.5 |

## Model cheat sheet

| Model | Best for |
|-------|----------|
| **Composer 2.5** | Default driver, multi-file edits, UI, running checks in Cursor |
| **Opus 4.8** | Auth, orchestration, Effect layers, provider mapping, streaming correctness |
| **GPT 5.5** | Mechanical refactors, unit tests, serializers, provider test parity |

## Subagents

Use Cursor Task/subagents only when files don't overlap and there's no ordering dependency. Each batch file specifies exactly when to parallelize vs run sequentially.
