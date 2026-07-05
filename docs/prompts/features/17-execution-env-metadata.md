# 17 — Execution environment metadata

| Field | Value |
|-------|-------|
| **Batch** | Git / workflow |
| **Recommended model** | Composer 2.5 |
| **Subagent?** | Yes — parallel with 16 |
| **Dependencies** | None |
| **PR size** | Small–medium |

## Prompt

Surface node version and shell type in the branch/environment picker. Fix the TODO in `apps/web/src/components/overview/overviewSections.tsx` noting these fields are missing from `ExecutionEnvironmentDescriptor`.

### Context

- `packages/contracts` execution environment types
- Branch toolbar: `BranchToolbarBranchSelector.tsx`, ChatView environment selector
- Remote/SSH environments: `packages/ssh`, apps/server remote runner

### Requirements

- Extend `ExecutionEnvironmentDescriptor` with optional `nodeVersion`, `shell` (e.g. bash/zsh/fish)
- Server populates on environment probe / SSH bootstrap
- UI shows in environment picker tooltip or subtitle
- Graceful "unknown" when not detected

### Acceptance

- Local environment shows detected shell/node where available
- SSH remote environment shows remote values after connect
- Contract decode test updated
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
