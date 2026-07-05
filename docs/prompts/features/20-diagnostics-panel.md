# 20 — Diagnostics panel expansion

| Field | Value |
|-------|-------|
| **Batch** | Ops / trust |
| **Order in batch** | 2 of 6 |
| **Depends on (same batch)** | 21 (metrics RPC) |

## Prompt

Expand Settings → Diagnostics into a full operator panel per `.plans/21-concrete-improvement-roadmap.md` Phase 5.3.

### Context

- `apps/web/src/components/settings/DiagnosticsPanel.tsx` (may exist partially)
- `DiagnosticsPanel.logic.test.ts` covers redaction
- wsTransport state machine: `apps/web/src/rpc/wsTransport.ts`

### Surfaces

- Per-environment WebSocket connection state
- Provider instance last error + auth status
- Client-side push sequence gap detector
- Buttons: open logs folder, copy debug bundle (secrets redacted — test asserts `REDACTED_PLACEHOLDER`)

### Acceptance

- Reachable from Settings
- Debug bundle JSON contains no raw tokens/API keys (existing redaction tests pass)
- Manual smoke checklist in PR
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
