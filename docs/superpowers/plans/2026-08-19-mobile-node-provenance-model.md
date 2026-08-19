# Mobile Node-Provenance Model Implementation Plan

Stacked PR series. Four waves, each an independently reviewable pull request stacked on its
predecessor. Land in order; do not squash the stack into one PR.

## Objective

Change what a "node" means in the native mobile app. Today a node is a mode the user is in: you
select one, you are connected to it, and you see its work. After this series a node is an attribute
of a row — "this project lives on the work Mac" — and connecting is something the app does silently
when the user touches something that needs it.

The test for whether a change belongs in this series: **if the user has to know which machine
something is on before they can see it, it is wrong.**

Three things stay explicit and must not be automated away:

1. **E2EE first contact.** Verifying a new machine is a human decision by construction;
   auto-accepting is precisely the attack safety numbers exist to prevent. One deliberate gate per
   node, ever, presented as "verify this machine once" when the node first appears — never as a
   connection step.
2. **Role.** viewer / operator / owner. A read-only node's threads must not look actionable.
3. **The machine is asleep.** Physics. It belongs on the row ("offline · last seen 2h"), never as a
   global mode or a blocking banner.

## Verified baseline (2026-08-19, `main` at `408899d22`)

- The inbox is **already cross-environment**. `apps/mobile/src/state/homeData.ts:20` flattens
  `select{Projects,SidebarWorktrees,SidebarThreads}AcrossEnvironments`; every row carries
  `environmentId` and `nodeLabel`; `nodeScope` is an optional filter
  (`apps/mobile/src/features/inbox/inboxModel.ts:54`).
- **Two connection planes**, stated in the source at
  `apps/mobile/src/features/hostedHub/HubNodeSection.tsx:26` — "single hosted selection vs. direct
  multi-connect". Direct/saved nodes multi-connect through
  `Map<EnvironmentId, EnvironmentConnection>`
  (`packages/client-runtime/src/connection/supervision.ts:184`) with a concurrency queue
  (`savedEnvironmentConnectionScheduler.ts`). Hub nodes do not:
  `apps/mobile/src/features/home/useHomeEnvironments.ts:28` takes a singular
  `hosted.selectedNode`, which becomes the one connection of `kind: "primary"` that
  `disconnectPrimary` locates by scanning for that kind (`supervision.ts:510`).
- **Nothing caches threads or projects.** Mobile persists only the environment catalog,
  preferences, thread outbox, composer drafts, Hub profile and E2EE markers (see
  `apps/mobile/src/platform/kv.ts` call sites). Every node switch is a blank-then-refill.
- **The needed mechanism already exists one level down.** `supervision.ts` refcounts and
  LRU-evicts `threadDetailSubscriptions` keyed by `(environmentId, threadId)`, bounded by both a
  count cap and a byte budget (`supervision.ts:381-401`); `activeService` carries its own
  `refCount`. Connection lifetime is the same pattern one level up. Do not invent a second one.
- **`wsConnectionStatusAtom` is a single process-global atom**
  (`packages/client-runtime/src/rpc/wsConnectionState.ts:53`) with singular `socketUrl` and
  `connectionLabel`. Every socket writes it via `protocol.ts:120-140`, so with more than one
  environment connected they race and the last writer wins.

### Architectural constraint

Relay E2EE makes the Hub forward opaque bytes; it cannot see thread titles, project names or
approval state. **Aggregation is client-side by necessity.** No design in this series may assume
the Hub composes the inbox, and the same constraint governs push notifications later (contentless
push plus client fetch, or a notification service extension that decrypts locally).

### Reference implementation

`github.com/pingdotgg/t3code` is the upstream sibling and has a mature version of this model. Read
it through the GitHub contents API (`gh api repos/pingdotgg/t3code/contents/<path> --jq '.content'
| base64 -d`), not code search. Relevant files:
`apps/mobile/src/connection/environment-cache-store.ts` (versioned per-environment SQLite
snapshots), `apps/mobile/src/connection/background-activity-scopes.ts` (refcounted scope leases,
25s report against a 45s TTL), `apps/mobile/src/features/connection/environmentSections.ts` (cloud
nodes are ordinary environments carrying `isRelayManaged`). Borrow the shape; the contracts differ,
so do not copy code.

## Stack shape

| Wave | Branch | Base | Size | Mergeable alone |
| --- | --- | --- | --- | --- |
| 1 | `mobile/provenance-1-outbox-per-environment` | `main` | small | yes |
| 2 | `mobile/provenance-2-snapshot-cache` | wave 1 | large | yes |
| 3 | `mobile/provenance-3-demand-driven-connections` | wave 2 | large | no — needs 1 and 2 |
| 4 | `mobile/provenance-4-node-as-provenance` | wave 3 | medium | no — needs 2 |

Wave 1 is the stack base even though wave 2 carries more product value. It is roughly fifty lines,
it repairs a defect that is **already reachable on `main`** (direct multi-connect ships today), it
reviews in minutes, and putting it at the bottom means the rest of the stack keeps landing even if
review on wave 2 runs long. It also exercises the whole loop — branch, stack, simulator QA,
evidence — on a change small enough to debug the tooling against.

Manage the stack with the `gh stack` extension (`github/gh-stack` v0.1.0, installed) or the
`gh-stack` skill. The repository also renders stack metadata and stacked merges in its own source
control views as of `2970cef3e`.

## Wave 1: Per-environment outbox drain

Branch `mobile/provenance-1-outbox-per-environment`, based on `main`.

Repairs a live defect and establishes the invariant the rest of the series depends on: a queued
message belongs to one environment and its delivery gate must consult that environment.

Files:

- `packages/client-runtime/src/rpc/wsConnectionState.ts`
- `packages/client-runtime/src/rpc/protocol.ts`
- `apps/mobile/src/state/use-thread-outbox-drain.ts`
- `apps/mobile/src/state/threadOutbox.ts`
- colocated tests, plus any web/desktop call site the signature change touches

Steps:

1. Key WS connection status by `EnvironmentId`. Either replace the single atom with a keyed
   family or add an environment-scoped accessor beside it; keep a derived "primary/active" view so
   existing single-connection consumers in web and desktop keep working unchanged.
2. Thread the owning `EnvironmentId` through the `protocol.ts` record sites
   (`recordWsConnectionAttempt` / `Opened` / `Errored` / `Closed`) so each socket writes its own
   slot instead of racing on one.
3. Change the drain gate at `use-thread-outbox-drain.ts:67` to consult the status of
   `message.environmentId` rather than the global.
4. Audit every other consumer of `getWsConnectionStatus()` across mobile, web and desktop and
   classify each as "wants this environment" or "wants the active one". Fix the former; leave the
   latter on the derived view.

Acceptance:

- A message queued for an offline node stays queued while a different node is connected, and
  delivers when its own node reconnects.
- Two environments connected concurrently report independent status; neither clobbers the other.
- Existing single-connection behaviour in web and desktop is unchanged.

Evidence: unit tests over the drain decision with a two-environment fixture, plus a simulator run
with two enrolled Hub nodes where one is stopped mid-composition.

## Wave 2: Per-environment snapshot cache

Branch `mobile/provenance-2-snapshot-cache`, based on wave 1.

This is the wave that makes the model's central claim true. "Nodes are just where things live"
cannot be true while a sleeping machine's projects vanish from the interface — until this lands,
the remaining waves are cosmetic.

Files:

- new `apps/mobile/src/persistence/` module (expo-sqlite backed; `expo-sqlite` ~57.0.1 is already a
  dependency)
- `apps/mobile/src/state/threadsRuntime.ts`
- `apps/mobile/src/state/homeData.ts`
- `apps/mobile/src/connection/environmentStateSink.ts`
- `packages/client-runtime/src/connection/environmentStateSink.ts` if the sink needs a persistence
  seam
- colocated tests

Steps:

1. Define a versioned stored-snapshot schema per environment covering projects, worktrees and
   sidebar threads. Follow t3code's convention: an explicit `schemaVersion` literal per record type
   so a downgraded client discards rather than mis-decodes, and document what each bump means.
2. Write snapshots from the environment state sink on projection settle, debounced. Never write
   partial projections as complete.
3. Hydrate on cold start before any connection is attempted; render the union across all known
   environments from the catalog.
4. Reconcile live projections over cached rows without flicker; cached-only rows must be visibly
   stale rather than absent.
5. Invalidate on node revocation and on environment removal. A revoked node's cached content must
   disappear, not linger.
6. Bound the cache — cap per environment and total, evict by recency. Reuse the byte-budget
   approach already in `supervision.ts:381-401` rather than inventing a second policy.

Acceptance:

- Cold start renders every known node's projects, worktrees and threads with zero sockets open.
- Switching the visible node never blanks the list.
- Cached-only rows are marked stale and are not presented as live.
- Revoking a node removes its cached content on the next launch.

Evidence: simulator screenshots of a cold start showing two nodes' work with **both** node servers
stopped; a test proving a version bump discards an older record.

## Wave 3: Connection follows navigation

Branch `mobile/provenance-3-demand-driven-connections`, based on wave 2.

Files:

- `packages/client-runtime/src/connection/supervision.ts`
- `apps/mobile/src/hostedHub/state.ts`, `runtime.ts`, `primaryConnection.ts`, `nodeLifecycle.ts`
- `apps/mobile/src/features/home/useHomeEnvironments.ts`
- new scope-lease module under `apps/mobile/src/connection/`
- colocated tests

Steps:

1. Introduce scope leases **before** raising any concurrency bound. Refcount what mounted UI
   actually needs — thread detail, VCS status, provider status — and release on unmount. Without
   this the wave ships as a battery regression and will be judged as one.
2. Lift `selectedNode` to `selectedNodes` in the hosted store. Remove the `kind: "primary"`
   singleton assumption; it is a lookup convention in `disconnectPrimary`, not an architectural
   limit. `useHomeEnvironments` must accept a list where it currently accepts one or null.
3. Make connection lifetime the union of retained scopes plus LRU recency, bounded — start at two
   or three concurrent and make the bound a named constant, not a literal.
4. Acquire an environment's connection when a thread on it is opened. Nothing else acquires.
5. Release non-retained connections on background; do not reconnect them all on foreground.
   Stagger wake-up reconnects.
6. Surface `delivery-unknown` per row, per environment. A global banner would be a lie once
   several environments have independent state.

Acceptance:

- Opening a thread on a node with no live connection connects it without any user action.
- The concurrency bound holds under a five-node fixture.
- Backgrounding releases non-retained connections; foregrounding produces no reconnect storm.
- No path remains where the user must pick a node before seeing or opening work.

Evidence: simulator recording of open-thread-on-cold-node; a connection-count assertion under the
five-node fixture; before/after notes on foreground reconnect behaviour.

**Gate:** this wave raises relay load on a Hub that is one container in one region and has not run
its rollout drill (`sak0a/ryco-hub` issue #12). Waves 1, 2 and 4 all land safely against today's
single-connection Hub. Do not merge wave 3 to `main` until the Hub is deployed and observed, even
if the code is ready — keep it in the stack.

## Wave 4: Demote node in the interface

Branch `mobile/provenance-4-node-as-provenance`, based on wave 3.

Files:

- `apps/mobile/src/features/home/homeMode.ts`, `HomeScreen.tsx`, `homeChromeModel.ts`
- `apps/mobile/src/features/projects/projectsModel.ts`
- `apps/mobile/src/features/inbox/inboxModel.ts`, `InboxThreadRow.tsx`
- `apps/mobile/src/components/NodeScopeControl.tsx`
- `apps/mobile/src/lib/logicalProject.ts`
- `apps/mobile/src/features/nodes/NodesScreen.tsx` (unchanged component; only its mounting changes)
- `docs/mobile-native-status.md`

Steps:

1. Remove `"nodes"` from `HomeMode` (`homeMode.ts:3`). Node management — enroll, rename, revoke,
   verify — already has a home at `ConnectionsRouteScreen.tsx`, which renders the same
   `<NodesScreen/>`. This deletes a mounting, it does not build a screen.
2. Keep `nodeScope` as a filter and demote it out of the primary chrome.
3. Flip grouping from node-first to urgency-first. `buildProjectNodeGroups` currently buckets into
   `rowsByEnvironment`; projects should group by project with node as row provenance.
4. Merge the same repository across machines using the existing
   `derivePhysicalProjectKey` in `apps/mobile/src/lib/logicalProject.ts`, which is presently never
   applied across environments. Behind a preference if the merge is ambiguous.
5. Retire "connect" vocabulary from the product surface — the `connect-node` empty state becomes
   "Add a machine"; Settings → Connections becomes Machines.
6. Add per-row trust, role and delivery provenance. A merged list mixing verified and unverified
   nodes without per-row trust quietly undermines the safety-number work.
7. Rewrite `docs/mobile-native-status.md`. It is dated 2026-08-13 and is already stale — it
   describes native identity v2 as living on the blocker branch, but `6ff51502c` merged it to
   `main` the same day.

Acceptance:

- No home surface requires choosing a node.
- An unverified or read-only node is distinguishable at row level.
- The same repository on two machines can appear as one row.
- `docs/mobile-native-status.md` matches `main`.

Evidence: simulator screenshots on iPhone 17 Pro and iPad Pro 11-inch (M5) covering merged rows,
an unverified node and a viewer-role node.

## Cross-cutting constraints

- **Never run `bun test` in `apps/mobile`** — always `bun run --cwd apps/mobile test`.
- **No React component tests exist and none can.** react-native ships untranspiled Flow that
  rolldown cannot parse; any module importing `react-native` at module scope breaks every suite
  that loads it. `await import(...)` native modules **inside functions**. Put screen logic in pure
  model modules (`deriveXView(state) -> viewModel`) and keep `.tsx` as layout only —
  `features/hostedHub/hostedAuthModel.ts` and `HubNodeSection.tsx`'s
  `deriveHubNodeSectionModel` are the reference examples. A lighter alternative that also works is
  invoking a component as a plain function with hook deps mocked, as in
  `state/homeData.stability.test.ts`.
- **`bun typecheck` exit code is trustworthy; grepping its output is not** — ANSI colour codes
  defeat `grep 'error TS'`.
- `dev:desktop` does **not** rebuild the server bundle. After server edits run
  `bun run --filter ryco-cli build:bundle` (flag order matters).
- No `Co-Authored-By` lines in commit messages.

## QA environment

Hub-enrolled test node — the dev-runner strips `RYCO_HUB_*` from the environment through turbo
passthrough, so pass CLI flags:

```sh
node apps/server/dist/bin.mjs serve \
  --base-dir ~/.ryco/dev --dev-url http://<LAN-IP>:8081 \
  --port 13773 --host 0.0.0.0 \
  --hub-connector-enabled --hub-origin https://staging.ryco.space \
  --hub-node-name provenance-qa-node
```

Enroll with `hub enroll` (device code plus fingerprint; the owner approves in the staging Hub UI).
`hub` subcommands are status, enroll, pending, cancel, resume, leave. Any `hub`, `auth` or
`project` CLI call against the dev state directory needs `--dev-url`, or it opens the wrong SQLite
database and fails on migrations. Fixtures live in `~/.ryco/dev/qa-workspace`.

Waves 1, 3 and 4 need **two** nodes. Run a second `serve` with its own `--base-dir`, `--port` and
`--hub-node-name`, and enroll it separately.

Simulator work uses Ryco's own device control (verified available 2026-08-19: `devices.control`
granted; framebuffer, HID, accessibility and encoder all OK; Xcode 26.6 on macOS 26.6.1). Read
tools are `mcp__ryco_device__device_list`, `ryco_read_device_screenshot` and
`ryco_describe_device_ui`; the accessibility tree is better than a screenshot for asserting state.
Write tools are `ryco_propose_device_{boot,attach,launch,open_url,input,recording}` and create
approval requests rather than mutating inline. Preferred devices: **iPhone 17 Pro**
`E62AADE8-2B3E-4A93-8550-FADB9A2AE0A8` (iOS 26.5, 402×874@3) and **iPad Pro 11-inch (M5)**
`0C10EA76-1CF7-4098-B3DB-A7DFFCBF150F`. Fall back to `simctl` only if the device tools are
rejected.

Expo dev client: `bun run --cwd apps/mobile dev:client` (RycoDev scheme).

Two traps that cost a day each:

- **Dev-client DIRECT connections cannot open the node WebSocket at all.** Bearer bootstrap and
  ws-token succeed; the WS open fails client-side and no upgrade reaches the server. Known and
  unrelated to this series. **QA through the Hub relay** (`hostedHub/relaySocket.ts`), which works.
- **`simctl` typing uses the Mac's QWERTZ layout** (z/y swapped, `:` becomes `Ö`). Paste URLs and
  tokens with `simctl pbcopy` and long-press Paste.

## Out of scope

Push notifications and Live Activity; Android qualification; the general thread inspector;
mobile source control and terminal; Hub-side changes of any kind. The Hub relays opaque bytes and
gains no code in this series.
