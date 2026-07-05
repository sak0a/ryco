# Batch 06 — Ops / Trust

Copy everything below the line into your agent session in the **batch worktree**.

---

## Setup

| Item | Value |
|------|-------|
| **Branch** | `feat/batch-ops-trust` |
| **Worktree** | One dedicated worktree for this batch |
| **PR** | Single PR containing all six features |
| **Agent** | One Cursor agent session (no subagents) |

Read [AGENTS.md](../../AGENTS.md), `.plans/18-server-auth-model.md`, `.plans/19-remote-endpoints-hosted-static.md`.

## Your task

Implement features in the order below on **one branch**. Auth (22) must be complete before AdvertisedEndpoint (23).

```bash
bun fmt && bun lint && bun typecheck && bun run test
```

Do not commit unless explicitly asked.

## Implementation order

| Step | ID | Feature | Feature file | Notes |
|------|-----|---------|--------------|-------|
| 1 | 21 | In-app metrics RPC | [features/21-in-app-metrics.md](../features/21-in-app-metrics.md) | Server first |
| 2 | 20 | Diagnostics panel | [features/20-diagnostics-panel.md](../features/20-diagnostics-panel.md) | Wires metrics + WS state |
| 3 | 22 | Server auth middleware | [features/22-server-auth-middleware.md](../features/22-server-auth-middleware.md) | **Before 23** |
| 4 | 23 | AdvertisedEndpoint | [features/23-advertised-endpoint.md](../features/23-advertised-endpoint.md) | Requires 22 |
| 5 | 24 | Long-thread pagination | [features/24-long-thread-pagination.md](../features/24-long-thread-pagination.md) | |
| 6 | 25 | macOS notarization | [features/25-macos-notarization.md](../features/25-macos-notarization.md) | Docs/CI |

## Feature summaries

### 21 — Metrics

Rolling-window stats via RPC: turn quiescence avg, checkpoint p95, reconnect count. Resets on server restart (document).

### 20 — Diagnostics

WS state, provider errors, push gap detector, copy debug bundle (redacted), open logs. Use `REDACTED_PLACEHOLDER` pattern from existing tests.

### 22 — Auth

`AuthPolicy.ts` for all HTTP + WS. Loopback/desktop trust unchanged. Negative tests: 401 outside loopback.

### 23 — Endpoints

`AdvertisedEndpoint` contract + registry. Settings → Connections. Pairing uses selected endpoint. Mixed-content error UI.

### 24 — Pagination

Cursor-based message history for large threads. Client scroll-up fetch. SQLite indexes if missing.

### 25 — Notarization

Sign/notarize in CI if cert available; else improve unsigned macOS UX + `docs/release.md`.

## Batch acceptance

- [ ] Diagnostics shows metrics + WS state; debug bundle has no secrets
- [ ] Auth tests pass; desktop local dev unchanged
- [ ] Advertised endpoints visible; pairing uses selection
- [ ] Long thread paginates without client OOM
- [ ] Release docs updated for macOS
- [ ] Full validation green

## Security gate

Do not consider batch done until **22** auth negative tests pass and **23** builds on that auth layer.

## PR title suggestion

`feat: diagnostics, metrics, auth, remote endpoints, pagination, macOS release`
