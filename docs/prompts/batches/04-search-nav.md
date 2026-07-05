# Batch 04 — Search & Nav

Copy everything below the line into your agent session in the **batch worktree**.

---

## Setup

| Item | Value |
|------|-------|
| **Branch** | `feat/batch-search-nav` |
| **Worktree** | One dedicated worktree for this batch |
| **PR** | Single PR containing both features |
| **Agent** | One Cursor agent session (no subagents) |

Read [AGENTS.md](../../AGENTS.md).

## Your task

Implement features **11** then **12** on this branch. Complete server RPC for message search before palette UI.

```bash
bun fmt && bun lint && bun typecheck && bun run test
```

Do not commit unless explicitly asked.

## Implementation order

| Step | ID | Feature | Feature file |
|------|-----|---------|--------------|
| 1 | 11 | Message search | [features/11-message-search.md](../features/11-message-search.md) |
| 2 | 12 | Pin threads | [features/12-pin-threads.md](../features/12-pin-threads.md) |

## Feature summaries

### 11 — Message search (server + UI in one pass)

**Server:**

- RPC `searchThreadMessages(query, projectId?, limit)` → `{ threadId, messageId, snippet, timestamp }[]`
- Query orchestration message history (SQL/index as needed)
- Server tests

**UI:**

- Command palette "Messages" group, debounced search
- Navigate to thread + scroll/highlight message in virtualized `MessagesTimeline`
- Palette logic unit test

### 12 — Pin threads

- Pin/unpin via context menu on `SidebarThreadRow`
- Pinned first, then sort by `updatedAt` within groups
- Persist preference (localStorage v1 OK)
- Pin icon + sort comparator unit test

## Batch acceptance

- [ ] Cmd+K search finds message content and jumps to message
- [ ] Pin persists across reload; pinned block stays above unpinned
- [ ] Full validation green
- [ ] Manual smoke: search → jump; pin → reload → still pinned

## PR title suggestion

`feat: message search in command palette and pinned threads`
