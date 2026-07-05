# Batch 03 — Agent Modes

Copy everything below the line into your agent session in the **batch worktree**.

---

## Setup

| Item | Value |
|------|-------|
| **Branch** | `feat/batch-agent-modes` |
| **Worktree** | One dedicated worktree for this batch |
| **PR** | Single PR containing both features |
| **Agent** | One Cursor agent session (no subagents) |

Read [AGENTS.md](../../AGENTS.md).

## Your task

Implement features **10** then **15** on this branch. Feature 15 depends on feature 10 (schema + provider mapping).

```bash
bun fmt && bun lint && bun typecheck && bun run test
```

Do not commit unless explicitly asked.

## Implementation order

| Step | ID | Feature | Feature file |
|------|-----|---------|--------------|
| 1 | 10 | Ask mode | [features/10-ask-mode.md](../features/10-ask-mode.md) |
| 2 | 15 | Per-project default provider/model | [features/15-project-default-provider.md](../features/15-project-default-provider.md) |

## Feature summaries

### 10 — Ask mode

1. Extend `ProviderInteractionMode` in `packages/contracts` → `"default" | "plan" | "ask"`
2. Map ask mode in each adapter under `apps/server/src/provider/Layers/*Adapter.ts`
3. Composer toggle UI (reuse plan/default pattern)
4. Claude: read-only permission mode; other drivers: map or show unsupported
5. Persist on thread + composer draft
6. Adapter tests proving write-blocking where supported

### 15 — Project defaults

- Project settings: `defaultProviderInstanceId`, optional `defaultModel`
- New threads inherit; existing threads unchanged
- Server persistence + schema migration
- UI in `ProjectSettingsDialog.tsx`

## Batch acceptance

- [ ] Ask mode toggles in composer for supported providers
- [ ] Send in ask mode blocks edits (adapter test evidence)
- [ ] Unsupported drivers show clear UI state
- [ ] Project default applies to new threads only
- [ ] Full test suite green
- [ ] Manual smoke: toggle ask → send; set project default → new thread uses it

## PR title suggestion

`feat: ask mode and per-project default provider/model`
