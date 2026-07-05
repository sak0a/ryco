# Batch 04 — Search & Nav (Orchestration Prompt)

Copy everything below the line into a **Composer 2.5** lead session (spawn GPT 5.5 for server work).

---

## Role

Orchestrate Ryco batch **Search & Nav**: features **11 (message search)** and **12 (pin threads)**.

Read [AGENTS.md](../../AGENTS.md). Validation:

```bash
bun fmt && bun lint && bun typecheck && bun run test
```

Do not commit unless explicitly asked.

## Batch summary

| ID | Feature | Model | Subagent? | Order |
|----|---------|-------|-----------|-------|
| 11a | Message search — server RPC | GPT 5.5 | Yes | PR 1a (first) |
| 11b | Message search — palette UI | Composer 2.5 | Yes | PR 1b (after 11a) |
| 12 | Pin threads | Composer 2.5 | **Yes — parallel with 11** | PR 2 (parallel) |

## Parallel strategy

```text
Track A (sequential)
  11a server RPC → 11b palette UI

Track B (parallel with Track A)
  12 pin threads — independent files
```

Spawn **pin threads subagent** anytime alongside 11a or 11b — no file overlap.

## Track A — Message search

### PR 1a — Server (GPT 5.5 subagent)

Prompt: [features/11-message-search.md](../features/11-message-search.md) — **server half only**

```text
Implement ONLY the server half of message search:
- New RPC searchThreadMessages(query, projectId?, limit)
- SQL/query against orchestration message history
- Server tests
Do NOT touch CommandPalette or web UI yet.
Allowed: apps/server/, packages/contracts/
Before finishing: bun fmt && bun lint && bun typecheck && bun run test
```

| Subagent | Model | Allowed paths |
|----------|-------|---------------|
| S1 | GPT 5.5 | `apps/server/src/orchestration/`, `apps/server/src/ws/`, `packages/contracts/` |

### PR 1b — UI (Composer 2.5)

After 1a merges:

```text
Implement ONLY the client half of message search:
- CommandPalette "Messages" group
- Debounced search calling new RPC
- Navigate to thread + scroll/highlight message in MessagesTimeline
Allowed: apps/web/src/components/CommandPalette*, apps/web/src/rpc/
Before finishing: bun fmt && bun lint && bun typecheck && bun run test
```

| Agent | Model |
|-------|-------|
| Lead or subagent | Composer 2.5 |

## Track B — Pin threads (parallel)

Prompt: [features/12-pin-threads.md](../features/12-pin-threads.md)

| Subagent | Model | Allowed paths |
|----------|-------|---------------|
| P1 | Composer 2.5 | `SidebarThreadRow.tsx`, `Sidebar.logic.ts`, `uiStateStore.ts`, settings schema if needed |

**Subagent preamble:**

```text
Ryco pin-threads subagent. Implement pin/unpin, sort pinned first, persist preference, pin icon.
Do not touch CommandPalette or server search RPC.
Before finishing: bun fmt && bun lint && bun typecheck && bun run test
Do not commit.
```

## Orchestrator tasks

1. Spawn **S1** (11a server) + **P1** (12 pins) in parallel
2. Merge both; run full tests
3. Implement **11b** UI (Composer lead)
4. Manual smoke:
   - Search message text in Cmd+K → jump works
   - Pin thread → stays top after reload
   - Pinned block above unpinned when project resorts

## Inline prompts

### 11 — Message search (full)

- RPC: `{ threadId, messageId, snippet, timestamp }[]`
- Palette group, debounce, limit 20
- Scroll-to-message in virtualized timeline
- Server + palette tests

### 12 — Pin threads

- Context menu pin/unpin
- Sort: pinned first, then updatedAt
- Persist (localStorage v1 OK)
- Unit test sort comparator

## Success criteria

- [ ] Message search end-to-end works
- [ ] Pin threads persists across reload
- [ ] No conflicts between PRs (separate files)
- [ ] Full validation green
