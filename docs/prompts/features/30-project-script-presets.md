# 30 — Project script presets

| Field | Value |
|-------|-------|
| **Batch** | Differentiation |
| **Order in batch** | 5 of 5 |
| **Depends on (same batch)** | — |

## Prompt

Add per-project script presets runnable from command palette and worktree chips.

### Context

- Project scripts RPC already exists (grep project scripts in `apps/server`)
- Keybindings for script execution in `KEYBINDINGS.md`
- `GitActionsControl` / project explorer patterns

### Requirements

- Project settings: list of named scripts (command, cwd relative to project, icon)
- Command palette group "Run script"
- Optional: attach to worktree row quick actions

### Acceptance

- Define "test" script; run from palette executes in project root
- Output in terminal drawer
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
