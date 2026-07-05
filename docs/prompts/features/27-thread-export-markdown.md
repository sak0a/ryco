# 27 — Thread export (markdown)

| Field | Value |
|-------|-------|
| **Batch** | Differentiation |
| **Order in batch** | 2 of 5 |
| **Depends on (same batch)** | — |

## Prompt

Add read-only thread export to Markdown.

### Requirements

- New RPC or client-side export from orchestration projection (prefer client if full history already subscribed)
- Command palette action: "Export thread as Markdown"
- Include user/assistant messages, tool summaries (condensed), timestamps, provider/model metadata header
- Save via file download (web) or dialog (desktop)

### Acceptance

- Exported MD readable in GitHub
- No provider API calls
- Unit test for markdown serializer pure function
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
