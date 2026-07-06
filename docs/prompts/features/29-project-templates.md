# 29 — Shared project templates

| Field                       | Value           |
| --------------------------- | --------------- |
| **Batch**                   | Differentiation |
| **Order in batch**          | 4 of 5          |
| **Depends on (same batch)** | —               |

## Prompt

Export/import project configuration templates (defaults, MCP config subset, keybindings subset, theme reference).

### Context

- Project settings schema, MCP workspace config, themes in `apps/web/src/themes/`

### Requirements

- Export JSON template from project settings dialog
- Import applies allowed fields to target project with confirmation diff
- Never export secrets/tokens — redact on export

### Acceptance

- Export → import to second project applies non-secret fields
- Redaction test
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
