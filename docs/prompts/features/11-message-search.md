# 11 — Message search in command palette

| Field | Value |
|-------|-------|
| **Batch** | Search & nav |
| **Order in batch** | 1 of 2 |
| **Depends on (same batch)** | — |

## Prompt

Extend the command palette (`Cmd+K`) to search message content within threads, not just thread titles and project names.

### Context

- `CommandPalette.logic.ts`, `CommandPalette.tsx`
- Server orchestration events store message history (`apps/server/src/orchestration/`, persistence)
- Long threads may need server-side search index or SQL query

### Requirements

- New RPC: `searchThreadMessages(query, projectId?, limit)` returning `{ threadId, messageId, snippet, timestamp }`
- Palette group "Messages" with fuzzy match on query
- Selecting result navigates to thread and scrolls to/highlights message
- Debounce search input; cap results (e.g. 20)
- Index or query must perform adequately for threads up to ~500 messages

### Acceptance

- Search "authentication" finds matching assistant/user messages across projects
- Jump-to-message scroll works with virtualized timeline
- Server test for search RPC; palette logic unit test
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
