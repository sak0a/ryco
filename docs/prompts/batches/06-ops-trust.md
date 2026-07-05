# Batch 06 — Ops / Trust (Orchestration Prompt)

Copy everything below the line into an **Opus 4.8** lead session.

---

## Role

Orchestrate Ryco batch **Ops / Trust**: features **20–25**. This batch has a **security critical path** — do not parallelize auth work.

Read [AGENTS.md](../../AGENTS.md). Validation:

```bash
bun fmt && bun lint && bun typecheck && bun run test
```

Plans: `.plans/18-server-auth-model.md`, `.plans/19-remote-endpoints-hosted-static.md`, `.plans/21-concrete-improvement-roadmap.md` Phase 5.

Do not commit unless explicitly asked.

## Batch summary

| ID | Feature | Model | Subagent? | Order |
|----|---------|-------|-----------|-------|
| 20 | Diagnostics panel | Composer 2.5 | Yes | Wave 1 (parallel) |
| 21 | In-app metrics | GPT 5.5 | Yes | Wave 1 (parallel) |
| 22 | Server auth middleware | **Opus 4.8** | **No — solo** | Wave 2 |
| 23 | AdvertisedEndpoint | **Opus 4.8** | No | Wave 3 (after 22) |
| 24 | Long-thread pagination | **Opus 4.8** | Optional split | Wave 4 |
| 25 | macOS notarization | Composer 2.5 | Solo | Anytime (ops) |

## Critical path

```text
Wave 1 (parallel): 20 + 21
Wave 2 (solo Opus): 22 auth
Wave 3 (solo Opus): 23 endpoints — REQUIRES 22
Wave 4 (Opus): 24 pagination — can parallel server/client subagents
Wave 5 (anytime): 25 notarization — independent
```

## Wave 1 — Diagnostics + metrics (parallel)

| Subagent | Model | Prompt file | Allowed paths |
|----------|-------|-------------|---------------|
| O1 | Composer 2.5 | [features/20-diagnostics-panel.md](../features/20-diagnostics-panel.md) | `DiagnosticsPanel.tsx`, settings routes, wsTransport read-only hooks |
| O2 | GPT 5.5 | [features/21-in-app-metrics.md](../features/21-in-app-metrics.md) | `apps/server/src/observability/`, metrics RPC, diagnostics UI section |

**Preamble:**

```text
Ryco ops subagent. Implement ONLY assigned feature.
Redact secrets in debug bundle (REDACTED_PLACEHOLDER pattern exists in DiagnosticsPanel.logic.test.ts).
Before finishing: bun fmt && bun lint && bun typecheck && bun run test
Do not commit.
```

Coordinate: O2 metrics section should plug into O1 diagnostics panel — agree on RPC contract first or implement O2 server RPC before O1 UI wires it.

## Wave 2 — Auth (SOLO — Opus only)

**No subagents. Lead: Opus 4.8**

Prompt: [features/22-server-auth-middleware.md](../features/22-server-auth-middleware.md)

- `AuthPolicy.ts` single engine
- All HTTP routes + WS upgrade
- Loopback/desktop trust unchanged
- Negative tests: 401 outside loopback

## Wave 3 — AdvertisedEndpoint (SOLO — after 22)

Prompt: [features/23-advertised-endpoint.md](../features/23-advertised-endpoint.md)

- `packages/contracts/src/advertisedEndpoint.ts`
- `AdvertisedEndpointRegistry.ts`
- Settings → Connections UI
- Pairing uses selected endpoint; mixed-content error state

## Wave 4 — Pagination (Opus; optional split)

Prompt: [features/24-long-thread-pagination.md](../features/24-long-thread-pagination.md)

Optional subagents **after** RPC contract defined:

| Subagent | Model | Scope |
|----------|-------|-------|
| S | Opus 4.8 | Server cursor RPC + SQLite indexes + tests |
| C | Composer 2.5 | Client scroll-up fetch in MessagesTimeline |

## Wave 5 — Notarization (independent)

Prompt: [features/25-macos-notarization.md](../features/25-macos-notarization.md)

| Agent | Model |
|-------|-------|
| Anytime | Composer 2.5 |

CI/docs/scripts only — can run in parallel with Wave 1.

## Inline prompts (summary)

**20:** WS state, provider errors, push gap detector, copy debug bundle, open logs.

**21:** Turn quiescence avg, checkpoint p95, reconnect count via RPC.

**22:** Server-wide auth; desktop loopback exempt; 401 tests.

**23:** LAN/Tailscale/manual endpoint discovery; pairing integration.

**24:** Cursor pagination for 500+ message threads; scroll-up load.

**25:** Sign/notarize or improve unsigned macOS UX + release docs.

## Orchestrator checklist

- [ ] Diagnostics + metrics visible in Settings
- [ ] Debug bundle redaction tests pass
- [ ] Auth middleware merged before endpoints
- [ ] Unauthenticated HTTP fails outside loopback
- [ ] Desktop dev workflow still works
- [ ] Long thread (or test fixture) paginates without OOM
- [ ] Release docs updated (25)

## Manual smoke

1. Settings → Diagnostics → copy bundle → verify no secrets
2. Restart server → metrics reset (documented)
3. `bun run dev:desktop` — no auth friction locally
4. (If 24) Open thread with many messages — scroll up loads history

## Security gate

**Do not merge Wave 3 until Wave 2 auth tests pass.**
