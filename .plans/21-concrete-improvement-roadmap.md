# Concrete Improvement Roadmap

## Purpose

Turn the high-level improvement ideas from the project audit into a sequenced, PR-sized execution plan. Each phase is designed to land independently, stay green through `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`, and leave behavior unchanged unless the phase explicitly targets UX.

This plan complements — and does not replace — existing documents:

- `04-split-chatview-component.md`
- `effect-atom.md`
- `17-provider-neutral-runtime-determinism.md`
- `18-server-auth-model.md`
- `19-remote-endpoints-hosted-static.md`

## Principles

1. **Performance and reliability first** — no refactor that makes streaming, reconnects, or checkpointing less predictable.
2. **One concern per PR** — refactors and features do not mix unless the feature requires the refactor.
3. **Behavior-preserving by default** — use existing browser tests (`*.browser.tsx`) as regression harnesses.
4. **Measure before optimizing** — extend existing perf tooling before adding new virtualization or caching.

## Non-goals (for this roadmap)

- Multi-user RBAC or enterprise SSO
- Full hosted Ryco Tunnel product
- macOS notarization (track separately; operational, not architectural)
- Rewriting orchestration/event sourcing (see `14-server-authoritative-event-sourcing-cleanup.md`)

## Current Baseline (2026-06)

| Area | Signal | Location |
|------|--------|----------|
| Largest UI file | ~6,343 lines | `apps/web/src/components/Sidebar.tsx` |
| Chat container | ~4,960 lines | `apps/web/src/components/ChatView.tsx` |
| Composer | ~3,070 lines | `apps/web/src/components/chat/ChatComposer.tsx` |
| Draft state | ~3,214 lines | `apps/web/src/composerDraftStore.ts` |
| Client orchestration store | ~2,686 lines | `apps/web/src/store.ts` |
| Server WS/RPC | ~3,579 lines | `apps/server/src/ws.ts` |
| React Query modules | 4 domain files | `apps/web/src/lib/*ReactQuery.ts` |
| Timeline virtualization | LegendList | `apps/web/src/components/chat/MessagesTimeline.tsx` |
| Perf profiling | Opt-in via env | `VITE_RYCO_PERF_PROFILE=1` |
| Route extraction started | Partial | `apps/web/src/components/routeViews/` |

---

## Phase 0 — Instrumentation & Guardrails

**Goal:** Make regressions visible before large refactors. **Duration:** 1 PR, ~2–3 days.

### 0.1 Perf budget harness

**New files**

- `apps/web/src/perf/budgets.ts` — named budgets (ms thresholds) for tab switch, timeline mount, sidebar project expand
- `apps/web/test/perf/tabSwitch.budget.test.ts` — runs under `VITE_RYCO_PERF_PROFILE=1` in browser test harness; asserts measures stay under budget using existing marks from `tabSwitchInstrumentation.ts`

**Changes**

- Add `markSidebarExpand(key)` / `markSidebarExpandPaint(key)` alongside existing tab-switch marks
- Document budgets in `docs/observability.md` under a “Client perf profiling” section

**Acceptance**

- `VITE_RYCO_PERF_PROFILE=1 bun run test -- apps/web/test/perf` passes locally
- No budget failures on CI smoke (budget test tagged `@perf` and run in a dedicated CI job or nightly)

### 0.2 Prop-diff audit checklist

**Changes**

- Add a short `apps/web/src/perf/README.md` describing when to use `useDevPropDiff` during refactors
- Run `useDevPropDiff` on `MessagesTimeline`, `ChatComposer`, `SidebarThreadRowContent` once; file findings as follow-up issues (no behavior change in this PR)

**Acceptance**

- Documented workflow; no production code paths depend on `useDevPropDiff`

---

## Phase 1 — UI Decomposition (Maintainability)

**Goal:** Reduce god-files so features and fixes are localized. **Duration:** 6–8 PRs over ~3–4 weeks.

Dependency: Phase 0 perf harness recommended but not blocking.

### 1.1 ChatView — extract session orchestration hook

**Follows:** `04-split-chatview-component.md`

**New files**

- `apps/web/src/hooks/useChatSessionActions.ts`
  - `ensureSession`, `sendTurn`, `interruptTurn`, `approveRequest`, `rejectRequest`
  - Input: `ScopedThreadRef`, environment RPC client
  - Output: stable callbacks + `{ isSending, isInterrupting, lastError }`
- `apps/web/src/hooks/useChatSessionActions.test.ts`

**Changes**

- `ChatView.tsx` delegates send/interrupt/approval paths to the hook
- Keep all JSX in `ChatView.tsx` for this PR

**Acceptance**

- `ChatView.tsx` drops by ≥400 lines
- `ChatView.browser.tsx` green (send, stream, interrupt, model switch smoke paths)
- Hook unit tests cover session reuse and error surfacing

### 1.2 ChatView — extract overview / project context panel

**New files**

- `apps/web/src/components/chat/ChatOverviewPanel.tsx` — floating + sidebar overview motion frames currently inline in `ChatView.tsx` (`OverviewSidebarMotionFrame`, `FloatingOverviewMotionFrame`, PR/workflow queries)
- `apps/web/src/components/chat/ChatOverviewPanel.logic.ts` — query key helpers, derived overview state
- `apps/web/src/components/chat/ChatOverviewPanel.test.ts`

**Changes**

- Move `useQuery` blocks for overview PRs/workflow runs from `ChatView.tsx` into the panel
- Pass only serializable props into `ChatOverviewPanel`

**Acceptance**

- `ChatView.tsx` drops by ≥800 lines
- Overview open/close animations unchanged (browser test if covered; else manual checklist in PR)

### 1.3 ChatView — extract terminal drawer shell

**New files**

- `apps/web/src/components/chat/ChatTerminalShell.tsx` — wraps lazy `ThreadTerminalDrawer`, script terminal sizing constants, persistent drawer memo

**Acceptance**

- Terminal toggle, split, and script-run flows unchanged
- `ChatView.tsx` under 3,000 lines after 1.1–1.3

### 1.4 ChatComposer — split provider footer vs attachment menus

**New files**

- `apps/web/src/components/chat/ComposerAttachmentMenus.tsx` — `#` issue/PR/path picker queries and menu rendering
- `apps/web/src/components/chat/ComposerSendPipeline.ts` — pure functions for send eligibility, image bootstrap, effort prefix (testable without React)

**Changes**

- `ChatComposer.tsx` keeps Lexical editor wiring and layout only

**Acceptance**

- `ChatComposer.tsx` under 2,000 lines
- Composer browser tests green (`ContextPickerPopup.browser.tsx`, attachment flows)

### 1.5 Sidebar — extract project settings dialog

**New files**

- `apps/web/src/components/sidebar/ProjectSettingsDialog.tsx`
- `apps/web/src/components/sidebar/ProjectAtlassianSettingsSection.tsx`
- `apps/web/src/components/sidebar/projectSettingsSections.tsx` — General, Location, AI sections

**Acceptance**

- `Sidebar.tsx` drops by ≥1,500 lines
- Project settings browser tests or manual checklist: Atlassian link, location change, AI defaults

### 1.6 Sidebar — extract folder/project list

**New files**

- `apps/web/src/components/sidebar/SidebarProjectList.tsx` — `SidebarProjectsContent`, sort menus, DnD (`SortableProjectItem`, `ProjectRootDropZone`)
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — header + footer chrome

**Acceptance**

- `Sidebar.tsx` under 2,500 lines (container + wiring only)
- Sidebar browser tests green (`SidebarWorktreeList.browser.tsx`, project reorder)

### 1.7 composerDraftStore — split persistence from draft logic

**New files**

- `apps/web/src/composerDraftPersistence.ts` — localStorage read/write, migration from legacy keys (extract from `composerDraftStore.ts`)
- `apps/web/src/composerDraftSelectors.ts` — read-only selectors used by route views

**Acceptance**

- `composerDraftStore.ts` under 2,000 lines
- Draft promotion flow tests in `composerDraftStore.test.ts` (add if missing) still pass

---

## Phase 2 — Client Performance

**Goal:** Faster thread switches and less render churn under load. **Duration:** 4–5 PRs over ~2 weeks.

Dependency: Phase 1.1–1.3 recommended (smaller `ChatView` makes perf work safer).

### 2.1 Stabilize hot-path props

**Changes**

- Fix prop churn identified in Phase 0.2 audit:
  - Wrap callbacks passed to `MessagesTimeline` context in `useCallback` with minimal deps
  - Split `TimelineRowSharedState` so infrequently changing fields use refs instead of context value identity
- Add `useDevPropDiff` coverage removal before merge

**Acceptance**

- Measurable reduction in `ryco:render:MessagesTimeline` duration with `VITE_RYCO_PERF_PROFILE=1` (record before/after in PR)
- Phase 0 perf budgets still pass

### 2.2 Sidebar thread list virtualization

**Changes**

- When `threads.length > 20`, render via `@legendapp/list` (same dependency as timeline)
- Keep `SidebarThreadRow` as row renderer; preserve drag-and-drop for visible window only (document limitation) OR disable reorder when virtualized

**Acceptance**

- Project with 100+ threads: expand project & scroll without jank
- Thread jump keybindings (`mod+1`…`mod+9`) still target visible sorted list

### 2.3 Diff panel cancel + cache

**Changes**

- `apps/web/src/components/DiffWorkerPoolProvider.tsx` — cancel in-flight jobs when `turnId` or `filePath` changes
- `apps/web/src/lib/diffParseCache.ts` — LRU keyed by `(turnId, filePath, blobSha)` with max ~50 entries

**Acceptance**

- Rapid file switching in diff panel does not stack worker queue
- Re-opening same file is instant (cache hit)

### 2.4 Client push coalescing (store layer)

**Changes**

- `apps/web/src/store.ts` — batch high-frequency orchestration shell updates within `requestAnimationFrame` when >10 events/ms (configurable constant)
- Exclude turn content deltas from batching (streaming must stay immediate)

**Acceptance**

- Stress test: active turn with many tool events does not freeze UI
- Final turn state identical to pre-change (unit test with recorded event sequence)

---

## Phase 3 — Data Layer (AtomRpc Migration)

**Goal:** Replace React Query + fragmented RPC facades with Effect-native reactive RPC. **Duration:** 5–6 PRs over ~3 weeks.

**Follows:** `effect-atom.md` (paths updated to current layout)

Dependency: Phase 1 reduces merge conflict surface; can start Phase 3.1 in parallel with Phase 1 if needed.

### 3.1 RPC protocol extraction

**New files**

- `apps/web/src/rpc/protocol.ts` — extract from `apps/web/src/rpc/wsTransport.ts`
- `apps/web/src/rpc/client.ts` — `AtomRpc.Service` for `WsRpcGroup`
- `apps/web/src/rpc/registry.tsx` — `@effect/atom-react` provider

**Acceptance**

- No behavior change; all existing `wsRpcClient` tests pass
- `wsTransport.ts` shrinks; transport state machine unchanged

### 3.2 Server push state atoms

**New files**

- `apps/web/src/rpc/serverState.ts` — welcome, config, providers, settings, keybindings streams

**Remove (incrementally)**

- Responsibilities from `apps/web/src/wsNativeApi.ts` / `wsNativeApiState.ts` if still present; migrate callers to hooks backed by atoms

**Acceptance**

- Hook names preserved: `useServerConfig`, `useServerSettings`, `useServerProviders`, `useServerKeybindings`
- Bootstrap from `routes/__root.tsx` unchanged from user perspective

### 3.3 Git atoms

**Replace:** `apps/web/src/lib/gitReactQuery.ts`

**New files**

- `apps/web/src/rpc/gitAtoms.ts`
- `apps/web/src/rpc/useGit.ts`

**Invalidation:** `git:${cwd}`, `project:${cwd}` on worktree mutations

**Acceptance**

- `gitReactQuery.test.ts` replaced with atom tests
- Checkout/pull/worktree flows refresh status in sidebar and composer `@` picker

### 3.4 Project + provider atoms

**Replace:** `projectReactQuery.ts`, `providerReactQuery.ts`

**Invalidation:** `checkpoint:${threadId}`, `project:${cwd}`

**Acceptance**

- PR resolve dialog keeps previous results while loading
- Diff panel refreshes on checkpoint receipts

### 3.5 Remove React Query

**Changes**

- Delete `@tanstack/react-query` from `apps/web/package.json`
- Remove `QueryClientProvider` from router/root
- Replace `desktopUpdateReactQuery.ts` with writable atom + desktop bridge

**Acceptance**

- No `useQuery` / `useMutation` imports remain in `apps/web`
- Full test suite green

---

## Phase 4 — Server Modularization

**Goal:** Make `ws.ts` maintainable and improve test ergonomics. **Duration:** 3–4 PRs over ~2 weeks.

Can run partially parallel to Phase 3 after 3.1.

### 4.1 Extract WS RPC groups

**New directory:** `apps/server/src/ws/`

| Module | Owns |
|--------|------|
| `ws/orchestrationRpc.ts` | Thread/turn commands, orchestration subscriptions |
| `ws/gitRpc.ts` | Branches, worktrees, checkout, status |
| `ws/terminalRpc.ts` | Terminal open/write/resize/subscribe |
| `ws/projectRpc.ts` | Project search, scripts, avatars |
| `ws/sourceControlRpc.ts` | Issues, PRs, workflow runs |
| `ws/providerRpc.ts` | Provider status, models, skills |
| `ws/index.ts` | `makeWsRpcLayer` composition |

**Acceptance**

- `ws.ts` under 500 lines (re-exports + route layer wiring)
- Zero RPC behavior changes; `server.test.ts` green

### 4.2 WsTestClient helper

**New files**

- `apps/server/src/test/WsTestClient.ts`
  - `connect()`, `awaitWelcome()`, `awaitPush(channel, predicate)`, `rpc(method, input)`, `trackPushSequence()`
- `apps/server/src/test/WsTestClient.test.ts`

**Acceptance**

- At least two existing integration tests migrated from ad-hoc WS setup to `WsTestClient`
- Document usage in `apps/server/README.md`

### 4.3 Projection query profiling + indexes

**Changes**

- Add SQLite indexes if missing: orchestration events by `(thread_id, sequence)`, threads by `(project_id, updated_at)`
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` — paginate message history for threads with >500 messages (server-side cursor; client already virtualizes)

**Acceptance**

- Benchmark script or test: replay 1k-event thread completes under threshold (record in PR)
- Long-thread load does not OOM client on connect

---

## Phase 5 — Remote, Auth & Diagnostics

**Goal:** Safe remote access foundation and operator-visible health. **Duration:** 4–5 PRs over ~3 weeks.

Dependency: Phase 4.1 recommended before auth middleware touches all routes.

### 5.1 Server auth middleware (phase 1)

**Follows:** `18-server-auth-model.md` sections 1–3

**Changes**

- `apps/server/src/auth/AuthPolicy.ts` — single policy engine
- Apply to HTTP routes in `apps/server/src/http.ts`, not only WebSocket upgrade
- Desktop loopback: automatic trusted local session (zero login)

**Acceptance**

- Unauthenticated HTTP RPC returns 401 outside loopback
- Desktop local usage unchanged

### 5.2 AdvertisedEndpoint model

**Follows:** `19-remote-endpoints-hosted-static.md`

**New contracts**

- `packages/contracts/src/advertisedEndpoint.ts`
- Server service: `apps/server/src/remote/AdvertisedEndpointRegistry.ts`

**UI**

- Settings → Connections: show detected LAN/Tailscale/Manual endpoints per environment

**Acceptance**

- Pairing link uses selected advertised endpoint
- Mixed-content (HTTPS app → HTTP backend) shows explicit error state

### 5.3 Diagnostics page

**New files**

- `apps/web/src/routes/_settings.diagnostics.tsx`
- `apps/web/src/components/settings/DiagnosticsPanel.tsx`

**Surfaces**

- Per-environment WS state (from `wsTransport` state machine)
- Provider instance last error + auth status
- Push sequence gap detector (client-side)
- Buttons: open logs folder, copy debug bundle (config redacted)

**Acceptance**

- Diagnostics reachable from Settings; replaces/extends About section links
- No secrets in exported debug bundle (test asserts redaction)

### 5.4 In-app metrics snapshot (local)

**Changes**

- `apps/server/src/observability/Metrics.ts` — expose rolling window stats via RPC
- Diagnostics panel shows: avg turn quiescence ms, checkpoint duration p95, WS reconnect count

**Acceptance**

- Metrics visible without OTLP configured
- Metrics reset on server restart (documented)

---

## Phase 6 — Small Features (batched)

**Goal:** User-visible wins in small PRs after foundation is stable. **Duration:** ongoing, 1 feature ≈ 1 PR.

Pick order based on existing branches/workstreams:

| Priority | Feature | Primary files | Notes |
|----------|---------|---------------|-------|
| P1 | Ask mode | `ChatComposer.tsx`, contracts for `ProviderInteractionMode` | Branch `feature/add-ask-mode` may exist |
| P1 | Message search in command palette | `CommandPalette.logic.ts`, server RPC for thread message index | Extend beyond title/project search |
| P2 | Thread export (markdown) | New RPC + palette command | Read-only, no provider call |
| P2 | Pin threads | `uiStateStore.ts`, sidebar sort | Persisted preference |
| P2 | Undo send (pre-provider pickup) | `useChatSessionActions`, orchestration cancel window | Short time window only |
| P2 | Desktop turn-complete notification | `apps/desktop/src/main.ts` | Unfocused window only |
| P3 | Per-project default provider/model | project settings schema + composer default resolution | Builds on Phase 1.5 |
| P3 | Keybinding conflict warnings | `apps/server/src/keybindings.ts` validation | Surface in Settings |
| P3 | Forgejo / Bitbucket improvements | source-control providers | Align with open worktrees |

**Feature template (each PR)**

1. Contract/schema change in `packages/contracts` if needed
2. Server RPC + projection (if persisted)
3. UI surface + keybinding/command palette entry
4. Unit test + browser test for happy path

---

## PR Sequencing (recommended)

```text
Phase 0 ─────────────────────────────────────────────►
         0.1 perf budgets   0.2 prop-diff doc

Phase 1 ─────────────────────────────────────────────►
         1.1 ──► 1.2 ──► 1.3 ──► 1.4 ──► 1.5 ──► 1.6 ──► 1.7
              (ChatView)          (Composer)    (Sidebar)  (Draft)

Phase 2 (starts after 1.3) ────────────────────────►
         2.1 ──► 2.2 ──► 2.3 ──► 2.4

Phase 3 (3.1 can start early) ─────────────────────►
         3.1 ──► 3.2 ──► 3.3 ──► 3.4 ──► 3.5

Phase 4 (4.1 parallel to late Phase 3) ────────────►
         4.1 ──► 4.2 ──► 4.3

Phase 5 (after 4.1) ───────────────────────────────►
         5.1 ──► 5.2 ──► 5.3 ──► 5.4

Phase 6 ─ ongoing after Phase 1.4 ─────────────────►
         pick from priority table
```

---

## Success Metrics

| Metric | Target | When |
|--------|--------|------|
| `ChatView.tsx` line count | < 1,500 | After Phase 1.3 |
| `Sidebar.tsx` line count | < 2,000 | After Phase 1.6 |
| `ws.ts` line count | < 500 | After Phase 4.1 |
| Tab switch p95 (perf profile) | No regression vs Phase 0 baseline | After Phase 2 |
| React Query imports in web | 0 | After Phase 3.5 |
| WS integration test setup duplication | ≥2 tests use `WsTestClient` | After Phase 4.2 |
| Unauthenticated HTTP to server | 401 except loopback/desktop trust | After Phase 5.1 |

---

## Validation (every PR)

```bash
bun fmt
bun lint
bun typecheck
bun run test
```

Additional checks by phase:

- **Phase 1–2:** relevant `*.browser.tsx` tests
- **Phase 3:** atom hook unit tests + RPC client tests
- **Phase 4:** `apps/server` integration tests
- **Phase 5:** auth negative tests (unauthenticated requests fail)
- **Phase 6:** feature-specific acceptance test

Manual smoke (any UI phase):

1. Send turn → stream → complete
2. Interrupt in-flight turn
3. Switch threads via sidebar and `mod+]` / `mod+[`
4. Open diff panel, click line → editor
5. Toggle terminal drawer
6. Reconnect server (restart CLI) — client recovers

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| ChatView refactor breaks auto-scroll | Keep `MessagesTimeline` API stable; run `MessagesTimeline.browser.tsx` |
| AtomRpc migration causes stale UI | Scoped invalidation keys; parity tests per domain |
| `ws.ts` split breaks RPC registration | Single composition point in `ws/index.ts`; contract tests for method list |
| Virtualized sidebar breaks DnD | Feature-flag virtualization; fall back to full list ≤20 threads |
| Auth middleware breaks desktop | Explicit loopback/desktop trust path with tests |
| Phase scope creep | Feature freeze during 1.x refactor PRs; Phase 6 only for product additions |

---

## First three PRs to open (actionable start)

### PR A: Phase 0.1 — Perf budget harness

- Add sidebar expand marks + budget test
- CI: optional nightly job or `@perf` tag

### PR B: Phase 1.1 — `useChatSessionActions`

- Extract send/interrupt/approval from `ChatView.tsx`
- Highest leverage, lowest UI movement

### PR C: Phase 1.5 — `ProjectSettingsDialog` extraction

- Can parallelize with PR B (different files)
- Immediately shrinks the largest file (`Sidebar.tsx`)

After PR B + C land, reassess perf baseline and begin Phase 2.1 or Phase 3.1 depending on team priority (UX perf vs data-layer cleanup).
