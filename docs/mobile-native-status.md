# Native mobile delivery status

**Current as of 2026-08-13 at public `main` `8f910252e`.** This is the concise delivery
ledger for the native app. Older design specifications and implementation plans remain useful as
historical records, but this file is authoritative when their status language disagrees.

## Delivered on `main`

- A dedicated Expo/React Native app with native navigation, thread/inbox surfaces, composer,
  approvals, settings, project selection, and the baseline review/diff flow.
- Direct-node and hosted-Hub connection planes over the shared client runtime. The native client
  does not construct direct node HTTP URLs for hosted operation.
- Hosted account security, native DPoP sessions, relay E2EE trust state, and the account email
  verification-link handoff. Email transport remains a Hub deployment capability rather than a
  mobile-client responsibility.
- The read-only workspace file browser from PR #330: tree/search/source browsing,
  raster/SVG/sandboxed-HTML previews, deep-link parsing, and a regular-width file inspector.
- iOS-first simulator/development-client workflows. Android code exists in several platform seams,
  but Android product QA is not complete.

## Native identity v2 protocol dependency

The additive native identity v2 contracts and client-runtime transport are staged as a public
dependency for a later full-screen mobile access gate. A Hub must explicitly advertise a compatible
`nativeIdentity` v2 capability before a client may use those endpoints; an absent capability keeps
the protocol dark and preserves the existing native-handoff v1 document.

Browser identity v1 remains a cookie/CSRF transport. Native identity v2 uses DPoP-mint requests and
returns native session material without adopting or persisting it. The future mobile transaction
owner must complete its recovery-code journal and durable credential transition before it unlocks
the workspace. Browser cookies are never converted into native credentials by this path.

This protocol/runtime slice does not change startup navigation, onboarding UI, or the current
system-browser handoff. The compatible Hub implementation must land and be qualified before the
separate mobile blocker change is built or enabled.

## Open delivery slices

| Slice                                 | Repository state         | What remains                                                                                                       |
| ------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| General thread inspector              | Not on `main`            | Land the shared files/review/source-control/terminal container before treating those surfaces as one architecture. |
| Mobile source control                 | Not on `main`            | Branch/status/actions and the full native review workflow need a scoped PR and current validation.                 |
| Mobile terminal                       | Not on `main`            | The bounded terminal renderer and focused workspace need a scoped PR plus native QA.                               |
| Agent notifications and Live Activity | Not on `main`            | Requires the client runtime, native lifecycle work, Hub push-token support, permissions UX, and device QA.         |
| Durable offline inbox                 | Partial foundations only | Define retention/privacy limits and prove stale-state/reconnect behavior before calling it an offline cache.       |
| Tablet inspector                      | Delivered for files only | Generalize the regular-width split layout across workspace tools.                                                  |
| Android                               | Unqualified              | Exercise image/SVG/HTML preview, WebView isolation, navigation, native modules, and relay lifecycle on Android.    |
| Store distribution                    | Not complete             | Apple Developer/App Store Connect/TestFlight work remains separate from simulator and Personal Team development.   |

## PR #330 merge record

PR #330, **Add responsive mobile file browser workspace**, merged on 2026-08-12 as
`dc2af64310315535272292f2433b621f0451da73`. It contains the read-only tree/search/source browser,
raster/SVG/sandboxed-HTML previews, and responsive file inspector. It does not contain the later
generalized inspector, source-control, terminal, notification, or broader inbox/composer work.

The 2026-08-12 audit merged the PR head into current `main` in a disposable worktree with no Git
conflicts. Current typechecks passed for `packages/contracts`, `packages/client-runtime`, and
`apps/mobile`; focused validation passed 44 client-runtime file-domain tests, 102 mobile
file/RPC/route tests, and 60 server workspace tests. `git diff --check` also passed.

The preferred follow-up sequence is:

1. Keep the merged file-domain and bounded RPC behavior stable.
2. Land the generalized thread-inspector refactor as a focused follow-up that reuses the file browser,
   review, source-control, and terminal surfaces rather than maintaining separate workspace shells.
3. Split unrelated local UI, terminal, VCS, notification, and inbox history into independently
   reviewable changes based on current `main`.

## File-browser acceptance still open

- Exercise a real `?line=N` file deep link on iOS.
- Qualify the preview paths on Android.
- Decide whether raster zoom/pan and HTML pull-to-refresh belong in the first follow-up.
- Clear render failures when changing preview modes, not only after pull-to-refresh.
- Preserve `expo-image`'s memory-only cache policy for node-owned raster bytes.
- Replace raw filesystem read errors with bounded messages so absolute node paths cannot leak.
- Treat physical-device relay E2EE qualification as a separate release gate; simulator QA does
  not satisfy it.
