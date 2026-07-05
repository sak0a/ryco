# Batch 03 — Agent Modes (Orchestration Prompt)

Copy everything below the line into an **Opus 4.8** lead session.

---

## Role

You are the **lead orchestrator** for Ryco batch **Agent Modes**: features **10 (Ask mode)** and **15 (Per-project default provider/model)**.

Read [AGENTS.md](../../AGENTS.md). Validation:

```bash
bun fmt && bun lint && bun typecheck && bun run test
```

Do not commit unless explicitly asked.

## Batch summary

| ID | Feature | Model | Subagent? | Order |
|----|---------|-------|-----------|-------|
| 10 | Ask mode | **Opus 4.8** (lead) | Yes (UI + tests) | PR 1 |
| 15 | Project default provider/model | Composer 2.5 | Yes (after 10) | PR 2 |

**Critical:** Feature 10 must land contracts + server adapters before spawning UI subagent for 15 (if 15 touches same settings schema, coordinate schema in PR 1).

## Phase 1 — Ask mode (Opus lead, solo core)

**Lead agent: Opus 4.8**

Prompt: [features/10-ask-mode.md](../features/10-ask-mode.md)

### Scope (sequential within PR 1)

1. **Contracts:** Extend `ProviderInteractionMode` in `packages/contracts/src/orchestration.ts` → `"default" | "plan" | "ask"`
2. **Server:** Map ask mode in each adapter under `apps/server/src/provider/Layers/*Adapter.ts`
3. **Tests:** Adapter tests proving write-blocking where supported

### Phase 1 subagents (after step 1 merged locally)

Spawn **2 subagents** in parallel:

| Subagent | Model | Task | Allowed paths |
|----------|-------|------|---------------|
| UI | Composer 2.5 | Composer toggle for ask mode | `ComposerFooter*.tsx`, `ChatComposer.tsx`, draft store |
| Tests | GPT 5.5 | Per-driver adapter unit tests | `*Adapter.test.ts` |

**Subagent preamble:**

```text
Ryco ask-mode subagent. ProviderInteractionMode now includes "ask".
Implement ONLY your slice. Do not change contracts unless lead approves.
Before finishing: bun fmt && bun lint && bun typecheck && bun run test
Do not commit.
```

## Phase 2 — Project defaults (Composer subagent)

**After PR 1 merges**

| Agent | Model | Prompt |
|-------|-------|--------|
| Subagent or lead | Composer 2.5 | [features/15-project-default-provider.md](../features/15-project-default-provider.md) |

Add `defaultProviderInstanceId` + optional `defaultModel` to project settings. New threads inherit; composer resolves defaults.

## Inline prompts

### 10 — Ask mode

- Extend `ProviderInteractionMode` with `"ask"`
- Composer UI toggle (reuse plan/default pattern)
- Claude: read-only permission mode
- Codex/Cursor/Copilot/OpenCode: map to driver equivalent or show unsupported
- Persist on thread + composer draft
- Adapter tests for write blocking

### 15 — Project defaults

- Project settings: default provider instance + model
- New thread inherits; existing threads unchanged
- Server persistence + schema migration

## Acceptance (batch)

- [ ] Ask mode toggles in composer for supported providers
- [ ] Send in ask mode blocks edits (adapter test evidence)
- [ ] Unsupported drivers show clear UI state
- [ ] Project default applies to new threads only
- [ ] Full test suite green

## Manual smoke

1. Toggle ask mode → send → verify no file writes in tool events
2. Set project default provider → new thread uses it
3. Existing thread keeps its provider when project default changes
