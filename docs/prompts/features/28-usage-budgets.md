# 28 — Usage budgets & alerts

| Field | Value |
|-------|-------|
| **Batch** | Differentiation |
| **Recommended model** | Composer 2.5 |
| **Subagent?** | Yes — parallel with 26–30 |
| **Dependencies** | Statistics system exists |
| **PR size** | Medium |

## Prompt

Add optional per-provider-instance usage budgets using the statistics system.

### Context

- `packages/contracts/src/statistics.ts`
- `apps/server/src/statistics/StatisticsQuery.ts`
- `StatisticsPanel`, `modelPricing.ts`

### Requirements

- Setting: weekly token or USD budget per provider instance
- Soft alert in sidebar/composer when threshold crossed (80%, 100%)
- Uses existing statistics buckets — no duplicate accounting

### Acceptance

- Set $10 budget; crossing shows non-blocking banner
- Statistics panel reflects same numbers
- Settings schema + test
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
