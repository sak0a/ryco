# 22 — Server auth middleware (phase 1)

| Field | Value |
|-------|-------|
| **Batch** | Ops / trust |
| **Recommended model** | Opus 4.8 |
| **Subagent?** | No — solo |
| **Dependencies** | Before 23 |
| **PR size** | Large |

## Prompt

Implement server auth middleware phase 1 per `.plans/18-server-auth-model.md` sections 1–3.

### Context

- `apps/server/src/auth/`
- `http.ts` and ws upgrade currently inconsistent — auth must cover all privileged HTTP routes and WebSocket RPC
- Desktop loopback: zero-login trusted local session

### Requirements

- `AuthPolicy.ts` single policy engine
- Unauthenticated non-loopback HTTP returns 401
- Desktop local usage unchanged (automatic trusted local session)
- Negative tests: unauthenticated request fails outside loopback

### Acceptance

- Auth tests in `apps/server`
- No regression for `bun run dev:desktop` local workflow
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
