# Native mobile delivery status

**Current as of 2026-08-21 on `main`, after demand-driven multi-connect merged in PR #397.** This is
the concise delivery ledger for the native app. Older design specifications and implementation
plans remain useful as historical records, but this file is authoritative when their status
language disagrees. Delivery states below are explicit; the distinction between merged and open
work is load-bearing.

## Delivered on `main`

- A dedicated Expo/React Native app with native navigation, thread/inbox surfaces, composer,
  approvals, settings, project selection, and the baseline review/diff flow.
- Direct-node and hosted-Hub connection planes over the shared client runtime. Direct/saved nodes
  multi-connect through the supervision map; the hosted plane now acquires connections from
  mounted thread/provider/VCS scopes and retains at most three by scope plus LRU. Hosted operation
  never constructs direct node HTTP URLs.
- **Native identity v2 is merged**, not on a blocker branch. `6ff51502c` landed 2026-08-13 via
  PRs #352/#353 (polish in #354 the next day): additive v2 contracts, DPoP-mint transport, and
  the full-screen access gate — the workspace navigator mounts only after a revalidated native
  Hub session or a saved direct node with readable credential material. A Hub must explicitly
  advertise the `nativeIdentity` v2 capability or the protocol stays dark and direct pairing
  remains available. Browser identity v1 stays cookie/CSRF; native session material is staged in
  SecretKV and published as a bearer credential only after a durable write/read-back;
  recovery-code sessions are withheld until acknowledgement; browser cookies are never converted
  into native credentials. Ten follow-up commits (`66bd4125b`…`0ef6918fd`) hardened entitlements,
  local sign-out, native iOS confirmations, anti-bot binding, verified-email transitions and the
  identity action hierarchy. The old onboarding sheet is gone.
- Hosted account security, native DPoP sessions, relay E2EE trust state (the §13 pin store with
  crash-atomic promotion and the `anyNodeVerified` marker), and the account email
  verification-link handoff.
- The read-only workspace file browser from PR #330 (merged 2026-08-12, `dc2af6431`):
  tree/search/source browsing, raster/SVG/sandboxed-HTML previews, deep-link parsing, and the
  regular-width file inspector — still the only surface with a split layout.
- Since 2026-08-16: Expo/React Native upgrades, deterministic-clock E2EE pairing tests, queued
  messages steering into active turns (`8244e7b92`), and the shared Agent Control queue state
  with proposal approval surfaces (`caf8af36c`, `022d2430c`).
- iOS-first simulator/development-client workflows. Android code exists in several platform
  seams, but Android product QA is not complete.

## Node-provenance series

Plan: `docs/superpowers/plans/2026-08-19-mobile-node-provenance-model.md`. The objective: a node
stops being a mode the user is in and becomes an attribute of a row — the test is "if the user
has to know which machine something is on before they can see it, it is wrong." Three things stay
explicit by design: E2EE first contact (one deliberate verification per node, ever), role
(viewer/operator/owner), and machine sleep as a row fact, never a mode.

| Wave | PR   | State     | What it does                                                                                                                                                                                                                                                                                                                                                                                               |
| ---- | ---- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | #387 | on `main` | Outbox drain gates on the message's own environment; per-environment WS status slots beside the unchanged global.                                                                                                                                                                                                                                                                                          |
| 2    | #388 | on `main` | Per-environment SQLite snapshot cache + persisted Hub node roster: a sleeping machine's projects, worktrees and threads stay rendered, visibly stale from Hub directory presence. Explicit sign-out purges cached content; session expiry deliberately does not.                                                                                                                                           |
| 3a   | #390 | on `main` | Opening a thread re-targets the single hosted connection to its node (debounced and cancel-safe). Unselectable nodes open read-only from cache with one of five bounded reasons; the E2EE status pill settles transients behind a 500 ms threshold with "Not verified"/"Legacy" always breaking through.                                                                                                   |
| 4    | #391 | on `main` | Demotes node out of the interface: no "Nodes" home mode, projects group by project with machines as row provenance, same-repo rows can merge across machines behind the repository-grouping preference, and per-row role/trust markers use the established vocabulary.                                                                                                                                     |
| 3b   | #397 | on `main` | Demand-driven hosted multi-connect: mounted thread/provider/VCS scopes are refcounted, connection lifetime is retained scopes plus LRU under a named maximum of three, non-retained background connections are released, wake-up is staggered, and `delivery-unknown` stays per environment and appears on its own rows. #392's capacity assessment discharged the gate for this exact bound and sequence. |

Two facts the series established that any future work must respect:

- **Relay-socket state does not track node reachability.** Killing a node never surfaces at the
  app's WS layer — the socket terminates at the Hub, which stays healthy. Row liveness comes from
  Hub directory presence (`node.presence.online`), and cached-row staleness is cache provenance
  alone, never transport state. Wave 2's adversarial review found a critical bug from exactly
  this conflation.
- **Aggregation is client-side by necessity.** Relay E2EE makes the Hub forward opaque bytes; it
  cannot see thread titles, project names or approval state. No design may assume the Hub
  composes the inbox, and push notifications later must be contentless-push-plus-client-fetch or
  a locally decrypting notification service extension.

## Open delivery slices

| Slice                                 | Repository state         | What remains                                                                                                                       |
| ------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| General thread inspector              | Not on `main`            | Land the shared files/review/source-control/terminal container before treating those surfaces as one architecture.                 |
| Mobile source control                 | Not on `main`            | Branch/status/actions and the full native review workflow need a scoped PR and current validation.                                 |
| Mobile terminal                       | Not on `main`            | Only `terminalPreferences` exists; the bounded renderer and focused workspace need a scoped PR plus native QA.                     |
| Agent notifications and Live Activity | Not on `main`            | Client runtime, native lifecycle, Hub push-token support, permissions UX, device QA — under the contentless-push constraint above. |
| Tablet inspector                      | Delivered for files only | Generalize the regular-width split layout across workspace tools. Home surfaces are width-neutral single columns.                  |
| Android                               | Unqualified              | Exercise image/SVG/HTML preview, WebView isolation, navigation, native modules, and relay lifecycle on Android.                    |
| Store distribution                    | Not complete             | Apple Developer/App Store Connect/TestFlight work remains separate from simulator and Personal Team development.                   |

## File-browser acceptance still open (from PR #330)

- Exercise a real `?line=N` file deep link on iOS.
- Qualify the preview paths on Android.
- Decide whether raster zoom/pan and HTML pull-to-refresh belong in the first follow-up.
- Clear render failures when changing preview modes, not only after pull-to-refresh.
- Preserve `expo-image`'s memory-only cache policy for node-owned raster bytes.
- Replace raw filesystem read errors with bounded messages so absolute node paths cannot leak.
- Treat physical-device relay E2EE qualification as a separate release gate; simulator QA does
  not satisfy it.
