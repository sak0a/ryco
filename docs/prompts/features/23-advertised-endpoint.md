# 23 — AdvertisedEndpoint model

| Field | Value |
|-------|-------|
| **Batch** | Ops / trust |
| **Order in batch** | 4 of 6 |
| **Depends on (same batch)** | 22 |

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
