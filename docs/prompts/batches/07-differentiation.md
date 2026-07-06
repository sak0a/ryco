# Batch 07 — Differentiation

Copy everything below the line into your agent session in the **batch worktree**.

---

## Setup

| Item         | Value                                   |
| ------------ | --------------------------------------- |
| **Branch**   | `feat/batch-differentiation`            |
| **Worktree** | One dedicated worktree for this batch   |
| **PR**       | Single PR containing all five features  |
| **Agent**    | One Cursor agent session (no subagents) |

Read [AGENTS.md](../../AGENTS.md).

## Your task

Implement features **26 → 27 → 28 → 29 → 30** sequentially on this branch.

Features 28–30 all touch project settings — implement in order; extract small subcomponents in `ProjectSettingsDialog.tsx` if needed to avoid one giant conflict.

```bash
bun fmt && bun lint && bun typecheck && bun run test
```

Do not commit unless explicitly asked.

## Implementation order

| Step | ID  | Feature                  | Feature file                                                                      |
| ---- | --- | ------------------------ | --------------------------------------------------------------------------------- |
| 1    | 26  | Project dashboard        | [features/26-project-dashboard.md](../features/26-project-dashboard.md)           |
| 2    | 27  | Thread export (markdown) | [features/27-thread-export-markdown.md](../features/27-thread-export-markdown.md) |
| 3    | 28  | Usage budgets & alerts   | [features/28-usage-budgets.md](../features/28-usage-budgets.md)                   |
| 4    | 29  | Shared project templates | [features/29-project-templates.md](../features/29-project-templates.md)           |
| 5    | 30  | Project script presets   | [features/30-project-script-presets.md](../features/30-project-script-presets.md) |

## Feature summaries

### 26 — Project dashboard

Project home from sidebar: worktrees, open PRs, CI, recent threads, weekly token usage. Read-only from existing RPCs. Lazy load.

### 27 — Thread export

Pure markdown serializer + unit test. Command palette action. Web download / desktop save dialog. No provider calls.

### 28 — Usage budgets

Weekly token/USD budget per provider instance. 80%/100% soft banner. Use existing statistics buckets only.

### 29 — Project templates

Export/import JSON from project settings. Redact secrets. Import confirmation diff.

### 30 — Script presets

Named scripts in project settings. Command palette "Run script". Optional worktree quick action. Output in terminal drawer.

## Batch acceptance

- [ ] Dashboard loads for project with git + threads
- [ ] Export produces valid markdown
- [ ] Budget banner fires at threshold
- [ ] Template round-trip without secrets
- [ ] Script runs from palette
- [ ] Full validation green

## PR title suggestion

`feat: project dashboard, thread export, budgets, templates, script presets`
