# Hosted Mobile PWA Experience Implementation Plan

> **Implementation status (2026-07-20):** The public implementation landed on `main` through PR
> #180, with lifecycle reconnect ownership completed through PR #183. This checklist is retained as
> the historical execution plan. Physical iOS and Chromium qualification remains outstanding and
> external to the public repository.

**Goal:** Make the production hosted Ryco client installable and usable on physical iOS and Android
devices while keeping authenticated, node-owned, and relay data network-only and making browser
resume fail closed until authorization and node state are current.

**Architecture:** A custom hosted-only Vite build hook will emit a static offline document and a
small service worker generated from an explicit immutable bundle allowlist. A page-owned PWA
lifecycle module will manage registration, installation, standalone detection, and user-approved
updates. The hosted state controller will add a generation-scoped browser-resume gate consumed by
the existing RPC capability layer. Responsive work will extend the existing sidebar, sheet,
safe-area, and mobile composer primitives instead of creating another application shell.

**Design spec:**
`docs/superpowers/specs/2026-07-19-hosted-mobile-pwa-experience-design.md`

## Execution rules

- Create `feat/hosted-mobile-pwa` from the approved design-and-plan commits before production work.
- Add a focused failing test before each behavior change and confirm that it fails for the intended
  reason.
- Do not add Workbox, a PWA plugin, background sync, push, IndexedDB, or another application-data
  cache.
- Never run `bun test`; use `bun run test` and optional package or file filters.
- Preserve direct-browser, desktop, hosted-static, SSH-assisted, and saved-environment behavior.
- Do not change relay schemas, fixtures, tickets, authentication, authorization policy, or canonical
  persistence schemas.
- Do not include private deployment names, URLs, issue references, identifiers, credentials, or
  captured payloads in code, tests, documentation, commits, or review material.
- Keep service-worker caches, browser storage, diagnostics, and screenshots free of authentication,
  node-owned, relayed, or user-authored content.
- Before each commit, run `git diff --check` and inspect the complete staged diff for generated drift,
  private data, and unrelated changes.

---

## Task 1: Add red build and cache-contract tests

**Files:**

- Create: `apps/web/src/pwa/buildArtifacts.test.ts`
- Create: `apps/web/src/pwa/serviceWorkerPolicy.test.ts`
- Modify: `apps/web/src/viteConfig.test.ts`

- [ ] Add a pure build-artifact test that supplies a synthetic Vite output bundle containing
      fingerprinted JavaScript, CSS, fonts, images, source maps, HTML, and non-fingerprinted files.
- [ ] Assert that only approved fingerprinted shell assets enter the sorted precache allowlist;
      exclude source maps, live `index.html`, arbitrary public files, and unknown output types.
- [ ] Assert that the generated cache key is deterministic and changes when the immutable bundle
      filenames change.
- [ ] Add request-policy table tests covering allowlisted immutable `GET`, navigation, unknown
      same-origin `GET`, cross-origin `GET`, non-`GET`, `Range`, `/api/**`, `/attachments/**`,
      `/.well-known/**`, `/v1/relay/**`, WebSocket, and event-stream-like requests.
- [ ] Require network-only classification before any cache lookup for every sensitive or dynamic
      request class.
- [ ] Add config tests proving the PWA build hook is present only when
      `VITE_RYCO_CLIENT_MODE=hosted-hub` and the Vite command is a production build.
- [ ] Add assertions that standard and development configs do not emit or register a service
      worker.
- [ ] Run the three focused test files and confirm they fail because the PWA build and policy
      modules do not yet exist.

**Checkpoint commit:** `test(web): define hosted PWA cache boundaries`

## Task 2: Generate the minimal hosted PWA artifacts

**Files:**

- Create: `apps/web/src/pwa/buildArtifacts.ts`
- Create: `apps/web/src/pwa/serviceWorkerPolicy.ts`
- Create: `apps/web/src/pwa/offlineDocument.ts`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/index.html`
- Modify: `apps/web/public/site.webmanifest`
- Modify: `assets/prod/favicon/site.webmanifest`
- Modify: `assets/nightly/favicon/site.webmanifest`
- Modify: `assets/dev/favicon/site.webmanifest`
- Modify: `scripts/lib/brand-assets.test.ts`

- [ ] Implement a small custom Vite plugin that is included only for production `hosted-hub`
      builds.
- [ ] During bundle generation, derive the immutable allowlist only from emitted fingerprinted
      JavaScript, CSS, font, and static-image assets.
- [ ] Emit `/service-worker.js` from a reviewed source template with the sorted allowlist and a
      Ryco-owned cache name derived from the immutable bundle filenames.
- [ ] Emit `/offline.html` as a self-contained static document with no runtime data, request values,
      deployment labels, or application-store imports.
- [ ] Keep the live `index.html` network-only. A document navigation tries the network first and
      falls back only to `/offline.html` after a network failure.
- [ ] Make every non-navigation request pass through the pure request classifier before any cache
      operation. Cache only exact allowlisted URLs; do not use a broad path or extension matcher at
      runtime.
- [ ] On activation, delete only obsolete cache names carrying the exact Ryco PWA cache prefix.
- [ ] Do not call `skipWaiting` in response to installation alone. Accept a versioned activation
      message only after the page records an explicit user update action.
- [ ] Remove unconditional manifest insertion from `index.html`; hosted lifecycle code will attach
      it only in hosted mode.
- [ ] Extend all branded manifests with relative `start_url`, relative `scope`, standalone display,
      stable name/short-name, theme/background colors, and both conventional and maskable icon
      purposes while preserving brand-specific assets.
- [ ] Keep icon files outside the precache unless their emitted URL is immutable. Installation may
      fetch unversioned manifest icons from the network; they must not weaken the cache allowlist.
- [ ] Run the Task 1 tests, `scripts/lib/brand-assets.test.ts`, a standard web build, and a hosted web
      build.
- [ ] Inspect both output directories: standard output has no service-worker registration; hosted
      output has the manifest link, offline document, and worker with no private or dynamic URL.

**Checkpoint commit:** `feat(web): generate hosted PWA shell artifacts`

## Task 3: Add page-owned install and update lifecycle state

**Files:**

- Create: `apps/web/src/pwa/lifecycle.ts`
- Create: `apps/web/src/pwa/lifecycle.test.ts`
- Create: `apps/web/src/pwa/types.d.ts`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/env.ts`
- Modify: `apps/web/src/vite-env.d.ts`

- [ ] Model install eligibility, manual-install guidance, standalone state, registration failure,
      waiting update, and activation as bounded page-owned state.
- [ ] Keep a captured `beforeinstallprompt` event in memory only. Clear it after prompting,
      installation, teardown, or replacement.
- [ ] Derive installed state from `(display-mode: standalone)` with the legacy iOS standalone flag
      used only as a display compatibility fallback.
- [ ] Use platform classification only to choose instruction copy. It must never affect
      authentication, authorization, request routing, or capabilities.
- [ ] Register `/service-worker.js` with the hosted public base scope only after a production hosted
      page reaches the normal load path.
- [ ] Attach the manifest link only in hosted mode and remove lifecycle listeners and transient
      state on teardown.
- [ ] Detect a waiting worker and publish **Update ready**. Send the versioned activation message
      only from the explicit update action, then reload once after `controllerchange`.
- [ ] Surface registration failure as bounded installation unavailability while leaving online
      hosted use intact. Never render or persist the raw exception.
- [ ] Add fake event-target and service-worker-registration tests for prompt custody, dismissal,
      `appinstalled`, standalone detection, waiting updates, single reload, failure, and cleanup.
- [ ] Prove standard client mode never touches `navigator.serviceWorker` or appends a manifest.
- [ ] Run the focused lifecycle tests and the existing environment-mode tests.

**Checkpoint commit:** `feat(web): manage hosted PWA lifecycle`

## Task 4: Present installation and relay-trust guidance

**Files:**

- Create: `apps/web/src/components/hostedHub/HostedPwaControls.tsx`
- Create: `apps/web/src/components/hostedHub/HostedPwaControls.browser.tsx`
- Create: `apps/web/src/components/hostedHub/HostedRelayTrustNotice.tsx`
- Modify: `apps/web/src/components/hostedHub/HostedHubRoot.tsx`
- Modify: `apps/web/src/components/hostedHub/HostedHubRoot.browser.tsx`

- [ ] Render a dismissible **Install Ryco** action only when Chromium reports an eligible native
      prompt.
- [ ] Render concise iOS instructions for an eligible non-standalone Apple mobile browser: browser
      menu/share sheet, **Add to Home Screen**, **Open as Web App** when offered, then **Add**.
- [ ] Provide a bounded manual-install help surface when an otherwise supported browser exposes no
      native prompt.
- [ ] Hide installation UI in standalone mode and after `appinstalled`; keep ordinary browser use
      available after dismissal or prompt rejection.
- [ ] Put the install action in a stable hosted-shell location and make it available again from the
      hosted node menu or settings surface without an automatic modal.
- [ ] Use this exact disclosure as the initial reviewed copy: “Hosted connections use WSS transport
      security, but they are not application-level end-to-end encrypted. The trusted relay can
      observe forwarded bytes in memory and must not log or persist payloads.”
- [ ] Show the disclosure on the hosted authentication/registration surface, node-selection path,
      and install-help surface. Do not put it only behind documentation or settings.
- [ ] Give dialogs, instructions, prompt actions, and dismissal controls accessible names, focus
      management, and at least 44-by-44 CSS-pixel touch targets on mobile.
- [ ] Add browser tests for Chromium prompt acceptance/rejection, iOS instructions, manual help,
      standalone hiding, disclosure presence in every hosted admission path, focus restoration, and
      absence in standard mode.
- [ ] Run the focused component browser test and all existing `HostedHubRoot` browser tests.

**Checkpoint commit:** `feat(web): add hosted PWA install guidance`

## Task 5: Add red browser-resume and mutation-gate coverage

**Files:**

- Modify: `apps/web/src/hostedHub/state.test.ts`
- Modify: `apps/web/src/hostedHub/capabilities.test.ts`
- Modify: `apps/web/src/components/hostedHub/HostedHubRoot.browser.tsx`
- Modify if transport isolation needs a focused assertion: `apps/web/src/hostedHub/transport.test.ts`

- [ ] Start from an authenticated, selected, online, session-ready hosted state with an allowed
      Operator mutation.
- [ ] Simulate `visibilitychange` to hidden, browser `offline`, `pageshow`, visible resume, and
      browser `online` independently.
- [ ] Prove hidden or offline state disables hosted mutation capability immediately while leaving
      the last rendered projection explicitly stale and read-only.
- [ ] Prove resume performs session validation, directory/grant refresh, a fresh relay attempt, and
      current-generation shell synchronization in that order.
- [ ] Keep mutations disabled between each phase, including when the old physical socket still
      appears online.
- [ ] Prove a `401`, removed grant, revoked node, incompatible node, refresh failure, relay failure,
      or snapshot failure fails closed on resume.
- [ ] Prove stale callbacks, timers, and prior relay generations cannot re-enable mutations.
- [ ] Prove duplicate visible/online/pageshow events coalesce into one resume operation.
- [ ] Prove a non-idempotent request with uncertain delivery is not replayed and remains
      **Delivery unknown** until authoritative replay and explicit acknowledgment.
- [ ] Prove standard/direct mode capability decisions are unchanged.
- [ ] Run the focused state, capability, transport, and hosted-root browser tests and confirm the new
      assertions fail on the current implementation for the intended freshness gaps.

**Checkpoint commit:** `test(web): define fail-closed hosted resume`

## Task 6: Implement the generation-scoped resume gate

**Files:**

- Modify: `apps/web/src/hostedHub/types.ts`
- Modify: `apps/web/src/hostedHub/state.ts`
- Modify: `apps/web/src/hostedHub/capabilities.ts`
- Modify: `apps/web/src/components/hostedHub/HostedHubRoot.tsx`
- Modify if ordered teardown needs a public entry point: `apps/web/src/hostedHub/environment.ts`

- [ ] Add an explicit browser/resume state that distinguishes current, suspended/offline, checking
      access, and synchronizing without replacing the existing account, directory, transport, or
      Ryco-session state models.
- [ ] Centralize `visibilitychange`, `online`, `offline`, and `pageshow` subscription in the hosted
      root/controller lifecycle. Do not add listeners in individual feature components.
- [ ] On hidden or offline, synchronously close the mutation gate and mark visible application data
      stale. Do not clear the current projection merely because the page is backgrounded.
- [ ] On visible/online resume, coalesce duplicate events and validate the current session using the
      existing same-origin, cookie-bound API.
- [ ] Refresh the authorized directory and selected grant before reconnecting. A missing, revoked,
      or identity-changed selection follows the existing deactivation and state-clearing path.
- [ ] Reconnect the surviving selected node through the existing retry/activation path so the old
      logical session is torn down, a fresh one-use ticket is requested, and one new generation owns
      callbacks.
- [ ] Keep the mutation gate closed until the current generation accepts an authoritative shell
      snapshot or valid replay point and the existing delivery-unknown rules permit the action.
- [ ] Extend `useHostedRpcCapability` freshness to require directory ready, transport online, Ryco
      session ready, and browser resume current. Role policy remains server-derived and unchanged.
- [ ] Render bounded **Offline**, **Checking access**, **Synchronizing**, **Reconnecting**, **Stale**,
      and **Delivery unknown** text in the hosted chrome. Do not render raw failures or identifiers.
- [ ] Preserve old-generation isolation, retry backoff, channel limits, and direct-mode behavior.
- [ ] Run all Task 5 tests, environment runtime resume tests, hosted transport tests, and hosted
      browser tests.

**Checkpoint commit:** `feat(web): gate hosted mutations across resume`

## Task 7: Establish the responsive acceptance matrix before layout changes

**Files:**

- Create: `apps/web/src/components/HostedMobileShell.browser.tsx`
- Modify: `apps/web/src/components/ChatView.browser.tsx`
- Modify: `apps/web/src/components/DiffPanel.browser.tsx`
- Modify: `apps/web/src/components/ThreadTerminalDrawer.browser.tsx`
- Modify: `apps/web/src/components/hostedHub/HostedHubRoot.browser.tsx`
- Modify if reusable helpers are needed: `apps/web/test/browserViewport.ts`

- [ ] Add reusable viewport cases for 320-by-568, a representative modern phone, phone landscape,
      tablet, and the existing desktop baseline.
- [ ] Assert no document-level horizontal overflow on authentication, invitation, recovery-code,
      node-directory, empty-shell, active-chat, approval, diff, terminal, and settings surfaces.
- [ ] Assert the mobile sidebar opens from the compact header, retains focus correctly, closes on
      navigation, and leaves the selected node/environment context visible below the header.
- [ ] Assert primary mobile controls meet the 44-by-44 CSS-pixel target without requiring desktop
      controls to grow.
- [ ] Exercise text scaling and reduced-motion media queries; assert controls remain reachable and
      no behavior depends on an animation finishing.
- [ ] Stub `VisualViewport` to model the software keyboard and assert the composer remains inside the
      visible viewport with its send/approval actions reachable.
- [ ] Exercise portrait-to-landscape resizing without remounting or losing the selected node,
      draft, active thread, or panel mode.
- [ ] Require dense diff and terminal content to scroll inside their own surfaces rather than
      expanding the page width.
- [ ] Run the focused browser files and record the exact failing components before changing layout
      production code.

**Checkpoint commit:** `test(web): cover hosted mobile layouts`

## Task 8: Apply only the responsive corrections proven necessary

**Primary files:**

- Modify: `apps/web/src/components/hostedHub/HostedHubRoot.tsx`
- Modify: `apps/web/src/components/RootAppShell.tsx`
- Modify: `apps/web/src/components/AppSidebarLayout.tsx`
- Modify: `apps/web/src/components/chat/ChatHeader.tsx`
- Modify: `apps/web/src/components/sidebar/SidebarChrome.tsx`
- Modify: `apps/web/src/components/NoActiveThreadState.tsx`
- Modify: `apps/web/src/components/RightPanelSheet.tsx`
- Modify: `apps/web/src/rightPanelLayout.ts`
- Modify: `apps/web/src/index.css`

**Conditional files, only with a focused red test:**

- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/DiffPanel.tsx`
- `apps/web/src/components/ThreadTerminalDrawer.tsx`
- `apps/web/src/components/ui/dialog.tsx`
- `apps/web/src/components/ui/sheet.tsx`
- Create: `apps/web/src/hooks/useVisualViewportCssVars.ts`
- Create: `apps/web/src/hooks/useVisualViewportCssVars.test.ts`

- [ ] Give `AppSidebarLayout` a hosted chrome slot so the node/environment selector participates in
      layout instead of covering mobile content. Preserve the current compact fixed desktop menu.
- [ ] Use the existing off-canvas `Sidebar` as the mobile navigation drawer and preserve its thread,
      project, settings, and close-on-navigation behavior.
- [ ] Make mobile sidebar triggers and primary header actions 44 CSS pixels without changing the
      desktop icon-button density.
- [ ] Make right-panel, approval, and dense dialog surfaces full-screen or bottom-sheet-like at the
      narrow breakpoint while retaining current desktop sizing and focus traps.
- [ ] Prefer existing `dvh`/`svh` and safe-area utilities. Add one `VisualViewport` adapter only if
      the keyboard test remains red with CSS alone; expose centralized CSS variables and clean up
      every listener and animation frame.
- [ ] Keep composer, pending approvals, notices, and bottom actions above the keyboard and bottom
      safe area without double-applying inset padding.
- [ ] Contain diff and terminal horizontal scrolling within those surfaces and keep the page itself
      fixed to the viewport.
- [ ] Preserve portrait/landscape state, text scaling, reduced motion, desktop/tablet layout, and
      window-controls-overlay behavior.
- [ ] Rerun every Task 7 case after each focused correction and leave production files untouched
      when their tests are already green.

**Checkpoint commit:** `feat(web): refine hosted mobile shell`

## Task 9: Document installation, security limits, and qualification

**Files:**

- Modify: `docs/hosted-hub-client.md`
- Create: `docs/hosted-mobile-pwa-qualification.md`
- Modify only if clarification is required: `docs/relay-protocol.md`

- [ ] Replace the statement that installable/mobile PWA behavior is out of scope with the hosted-only
      build, install, cache, update, offline, and resume contract.
- [ ] Document Android Chrome native prompting and iOS Safari manual Add to Home Screen guidance.
- [ ] Document that installation does not create application-level end-to-end encryption and quote
      the same trusted-relay limitation shown in the UI.
- [ ] Document that conversations, files, terminals, attachments, credentials, tickets, request
      bodies, and relay payloads never enter the service-worker cache.
- [ ] Add a physical-device checklist for iOS Safari and Android Chrome covering browser use,
      install, standalone launch, real hosted node use, keyboard, background/foreground,
      offline/online, reconnect, authorization failure, update activation, and cache inspection.
- [ ] Define bounded evidence: immutable revisions, device/browser versions, test result, and
      redacted screenshots only. Explicitly forbid identities, URLs, node/project metadata,
      credentials, proofs, request bodies, and payloads.
- [ ] Keep environment deployment, access mutation, and evidence destinations out of public docs.

**Checkpoint commit:** `docs(web): document hosted PWA qualification`

## Task 10: Run regression and security-specific verification

**Files:** No planned production changes.

- [ ] Run all tests under `apps/web/src/pwa`.
- [ ] Run all hosted state, API, environment, capability, transport, and component tests.
- [ ] Run environment runtime resume and thread-subscription tests.
- [ ] Run the responsive browser files for hosted root, shell, chat, diff, terminal, dialogs, and
      approvals.
- [ ] Build both standard and production hosted modes into separate clean temporary output
      directories.
- [ ] Serve the hosted output locally over an approved secure origin, install its service worker,
      perform representative authenticated synthetic activity, and inspect `CacheStorage`.
- [ ] Assert exact cache membership equals the generated immutable allowlist plus the static offline
      document; no live HTML, API, relay, attachment, user-authored, or cross-origin response is
      present.
- [ ] Assert update activation waits for the explicit action and does not reload an active client
      automatically.
- [ ] Assert service-worker unregister/reload leaves standard mode fully usable and no Ryco cache
      cleanup touches unrelated origin caches.
- [ ] Confirm direct-browser, desktop-local, hosted-static, saved remote, and SSH-assisted startup,
      navigation, mutation capabilities, and reconnect tests remain green.
- [ ] Confirm no canonical relay schema or fixture changed.

## Task 11: Run public quality gates and review the branch

- [ ] Confirm Bun `1.3.14`.
- [ ] Run `bun install --frozen-lockfile` only if dependency state requires installation; no new
      dependency is planned.
- [ ] Run `bun fmt`.
- [ ] Run `bun run fmt:check`.
- [ ] Run `bun lint`.
- [ ] Run `bun typecheck`.
- [ ] Run `bun run typecheck:effect` if any touched hosted runtime path is checked by the Effect
      language-service gate.
- [ ] Run `bun run test`.
- [ ] Run `bun run build`.
- [ ] Run `bun run --cwd apps/web test:browser`.
- [ ] Run `bun run release:smoke` and the existing web bundle measurement gate.
- [ ] Review the complete branch diff for unrelated edits, modified released migrations, generated
      artifacts, schema/fixture drift, private references, secrets, sensitive diagnostics, and
      browser-persistence boundary violations.
- [ ] Confirm the service worker contains only public immutable asset paths and stable bounded
      messages.

## Task 12: Publish and qualify without crossing the live-mutation boundary

- [ ] Push `feat/hosted-mobile-pwa` to the public origin.
- [ ] Open a focused public PR describing installability, cache isolation, resume gating, responsive
      behavior, compatibility, and automated evidence without mentioning a private issue or service.
- [ ] Wait for CI and review, resolve every actionable comment, and rerun affected gates.
- [ ] Merge only after all required checks pass and record the immutable public-main merge commit.
- [ ] Treat pinning that commit elsewhere, rebuilding/deploying a hosted service, altering access,
      and performing physical-device qualification against a live environment as separate work.
- [ ] Do not claim the hosted mobile PWA qualification complete until physical iOS Safari and
      Android Chrome evidence passes against compatible immutable web, service, and node revisions.

## Private follow-up boundary

This public plan does not authorize updating another repository's dependency pin, deploying or
restarting a service, changing DNS or configuration, altering monitoring or backups, changing any
account/session/grant/invitation/node state, or admitting/removing a user. Any such live operation
requires its own exact target, commands or UI actions, impact analysis, evidence list, rollback, and
explicit approval.
