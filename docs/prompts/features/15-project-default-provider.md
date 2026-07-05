# 15 — Per-project default provider/model

| Field | Value |
|-------|-------|
| **Batch** | Agent modes |
| **Recommended model** | Composer 2.5 (subagent after 10 contracts) |
| **Subagent?** | Yes — after feature 10 schema work |
| **Dependencies** | Can follow 10 in same sprint |
| **PR size** | Medium |

## Prompt

Add per-project defaults for provider instance and model used when starting new threads or opening composer on that project.

### Context

- Project settings dialog: `apps/web/src/components/sidebar/ProjectSettingsDialog.tsx`
- Schema: `packages/contracts` project settings
- Composer resolves provider/model from thread + draft today

### Requirements

- Project settings fields: `defaultProviderInstanceId`, `defaultModel` (optional)
- New thread inherits project defaults
- Existing threads unchanged
- Composer shows defaults when no thread-level override
- Server persists in project record

### Acceptance

- Set default on project A; new thread on A uses it; project B unaffected
- Override on thread still wins
- Schema migration + test
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
