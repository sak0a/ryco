# 23 — AdvertisedEndpoint model

| Field | Value |
|-------|-------|
| **Batch** | Ops / trust |
| **Recommended model** | Opus 4.8 |
| **Subagent?** | No — after 22 |
| **Dependencies** | After feature 22 |
| **PR size** | Medium–large |

## Prompt

Implement AdvertisedEndpoint discovery per `.plans/19-remote-endpoints-hosted-static.md`.

### Context

- `packages/contracts` — add `advertisedEndpoint.ts`
- `apps/server/src/remote/AdvertisedEndpointRegistry.ts`
- Settings → Connections UI
- Tailscale helpers: `packages/tailscale`

### Requirements

- Detect/publish LAN, Tailscale, manual endpoints per environment
- Pairing links use selected advertised endpoint
- Mixed-content (HTTPS page → HTTP backend) shows explicit error in UI

### Acceptance

- Settings shows detected endpoints
- Pairing flow uses chosen endpoint
- Contract tests for AdvertisedEndpoint schema
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
