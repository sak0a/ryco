# 10 — Ask mode

| Field                       | Value       |
| --------------------------- | ----------- |
| **Batch**                   | Agent modes |
| **Order in batch**          | 1 of 2      |
| **Depends on (same batch)** | —           |

## Prompt

Add "ask" as a third `ProviderInteractionMode` alongside `"default"` and `"plan"`.

### Context

- Contract: `packages/contracts/src/orchestration.ts` — `ProviderInteractionMode` is currently `["default", "plan"]`
- Composer footer: `apps/web/src/components/chat/ComposerFooter.tsx`, `ComposerFooterModeControls`
- Provider adapters: `apps/server/src/provider/Layers/*Adapter.ts` (Claude, Cursor, Codex, etc.)

### Requirements

- Extend schema: `ProviderInteractionMode = "default" | "plan" | "ask"`
- Composer toggle UI (reuse interaction mode control pattern)
- Per-provider mapping:
  - Claude: read-only / plan-style permission mode that blocks writes
  - Codex/Cursor/Copilot/OpenCode: map to each driver's read-only or "ask" equivalent; stub with clear "unsupported" UI if a driver lacks it
- Persist `interactionMode` on thread and composer draft like existing modes
- Server validates and passes mode on `sendTurn`

### Acceptance

- Ask mode visible in composer for supported providers
- Send in ask mode does not allow file edits (verify via adapter test)
- Unsupported providers show disabled state with explanation
- Contract + adapter tests updated
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
