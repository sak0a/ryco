# Cross-node trust, readiness, and client-parity implementation plan

**Goal:** Make two-node operation safe and complete in Web, Desktop, and native mobile, with one-scan native trust, node-scoped mutations/settings/notifications, concise browser security UI, a discoverable Hub fingerprint, and mobile source-control parity.

**Architecture:** Extend the shared client runtime with two authoritative primitives: a native trust-onboarding state machine and an immutable node mutation lease. Adapt Desktop and mobile to those primitives, keep browser trust at its existing unsigned ceiling, and resolve every operation through an explicit environment. Deliver the work in four independently testable waves, while keeping the production node read-only during qualification.

**Design:** `docs/superpowers/specs/2026-08-29-cross-node-trust-readiness-and-parity-design.md`

## Wave 1: Trust and identity

### Task 1: Add the shared native trust-onboarding state machine

**Files:**

- Add: `packages/client-runtime/src/authorization/nativeTrustOnboarding.ts`
- Add: `packages/client-runtime/src/authorization/nativeTrustOnboarding.test.ts`
- Modify: `packages/client-runtime/package.json`
- Modify as required: `packages/client-runtime/src/authorization/*`

1. Model the approved public states and events as a closed, platform-neutral transition table.
2. Carry environment, client fingerprint, request nonce, account, Hub origin, node identity, role, and expiry in bounded context.
3. Reject expired, replayed, wrong-client, wrong-node, wrong-account, and wrong-origin approval envelopes before changing trust state.
4. Make successful approval enter `reconnecting` and become `ready` only after the first authenticated IK channel.
5. Preserve a separate `recovery-required` path for the existing manual fingerprint and safety-number ceremony.
6. Export only bounded commands and selectors needed by native adapters.
7. Run `bun run --cwd packages/client-runtime test src/authorization/nativeTrustOnboarding.test.ts`.

### Task 2: Adopt one-scan onboarding on mobile and Desktop

**Files:**

- Modify: `apps/mobile/src/features/e2ee/e2eeTrustUiModel.ts`
- Modify: `apps/mobile/src/features/e2ee/e2eeTrustUiModel.test.ts`
- Modify as required: `apps/mobile/src/features/e2ee/*`, `apps/mobile/src/platform/*`
- Modify: `apps/desktop/src/desktopE2eeTrust.ts`
- Modify: `apps/desktop/src/desktopE2eeTrust.test.ts`
- Modify as required: `apps/desktop/src/desktopWorkspaceClient.ts`, Electron bridge declarations, and web Desktop adapters

1. Make **Verify this device** request approval and present scanning as the default native path.
2. Move fingerprint entry and safety-number acknowledgement behind **Use recovery setup**.
3. Consume the node-signed envelope through the shared state machine, pin the node, and reconnect automatically.
4. Keep Desktop-local trusted introduction zero-scan and prevent it from authorizing remote nodes.
5. Test the visible action count: one owner approval, one scan, no second acknowledgement.
6. Run focused mobile and Desktop trust tests.

### Task 3: Add the active node fingerprint to Hub status

**Files:**

- Modify: `packages/contracts/src/hubConnector.ts`
- Modify: `packages/contracts/src/hubConnector.test.ts`
- Modify: `apps/server/src/hubConnector/HubIdentityRuntime.ts`
- Modify: `apps/server/src/hubConnector/HubIdentityRuntime.test.ts`
- Modify: `apps/server/src/hubConnector/HubConnector.ts`
- Modify: `apps/server/src/hubConnector/HubConnector.test.ts`
- Modify: `apps/server/src/cli.ts`
- Modify: `apps/server/src/cli.test.ts`
- Modify: `docs/hub-connector.md`

1. Add a bounded public identity descriptor with only the canonical formatted fingerprint.
2. Return it whenever an active identity exists, independently of enrollment state.
3. Print `Fingerprint: SHA256:...` in human status output and add `fingerprint` to validated JSON.
4. Assert that raw keys, secrets, protected-store names, local paths, polling data, and internal identifiers never enter status output.
5. Update recovery documentation to reference the status command.
6. Run focused contracts and server tests.

## Wave 2: Readiness and provenance

### Task 4: Introduce node mutation leases

**Files:**

- Add: `packages/client-runtime/src/authorization/nodeMutationLease.ts`
- Add: `packages/client-runtime/src/authorization/nodeMutationLease.test.ts`
- Modify as required: `packages/client-runtime/src/authorization/state.ts`, relay lifecycle, workspace state, and package exports
- Modify as required: mutation-facing RPC adapters in `apps/web`, `apps/desktop`, and `apps/mobile`

1. Define the immutable lease with environment, selection generation, snapshot generation, role, and readiness proofs.
2. Derive it only from the authoritative hosted lifecycle owner.
3. Invalidate synchronously on node/account/origin/relay/directory/role/identity/snapshot changes.
4. Require matching environment and current generations at each mutation entry point.
5. Preserve cached read-only presentation while reconnecting and disable mutation controls with a concise node-specific status.
6. Test every invalidation input and stale-generation rejection.
7. Run focused client-runtime lifecycle and transport tests.

### Task 5: Eliminate stale new-task targeting

**Files:**

- Modify: `apps/web/src/hooks/useHandleNewThread.ts`
- Modify: `apps/web/src/hooks/useHandleNewThread.test.tsx` or the nearest existing focused test
- Modify as required: `apps/web/src/components/ChatView.tsx`, composer draft state, and hosted workspace selectors

1. Resolve an explicit project/environment target at action time.
2. Await a current matching mutation lease before creating or navigating to an empty draft.
3. Never inherit the previous primary environment after a selection change.
4. Retarget only empty unsent drafts; require an explicit move for non-empty drafts.
5. Add a deterministic rapid-select-then-New-Task regression test.
6. Run the focused web tests.

### Task 6: Make settings and notifications environment-explicit

**Files:**

- Modify: `apps/web/src/components/settings/settingsSections.logic.ts`
- Modify as required: settings registry, settings dialog/header, node settings panels, and route state
- Modify: `apps/web/src/components/ProviderUpdateLaunchNotification.logic.ts`
- Modify: `apps/web/src/components/ProviderUpdateLaunchNotification.tsx`
- Modify: `apps/web/src/components/ProviderUpdateLaunchNotification.logic.test.ts`
- Modify as required: `apps/web/src/components/RootAppShell.tsx`, provider pills, notification state, and navigation

1. Declare each settings section as browser, device, account, or node scoped.
2. Render scope and node label in settings headers; include environment ID in node-scoped routes and writes.
3. Require a matching mutation lease for node setting changes.
4. Add environment/node/provider provenance to provider updates and node-originated errors.
5. Include environment in dedupe and seen-state keys.
6. Select and ready the originating environment before notification actions navigate or mutate.
7. Add two-environment tests for copy, dedupe, seen state, offline behavior, and navigation.

### Task 7: Simplify the browser node popover without weakening Security settings

**Files:**

- Modify: `apps/web/src/components/hostedHub/HostedE2eeVerification.logic.ts`
- Modify: `apps/web/src/components/hostedHub/HostedE2eeVerification.logic.test.ts`
- Modify: `apps/web/src/components/hostedHub/HostedRelayTrustNotice.logic.ts`
- Modify as required: node popover and Settings Security components/tests
- Modify: `docs/hosted-hub-client.md`

1. Add explicit node-menu and Security-settings placements to the verification view model.
2. Return no explanatory prose for the node-menu placement.
3. Render only node label/state, browser-channel status, code, Copy, and **Security details** in the popover.
4. Keep the complete unsigned-browser and plaintext-fallback disclosure in Settings -> Security.
5. Test zero prose in the popover and complete disclosure in Settings.

## Wave 3: Desktop parity

### Task 8: Wire DesktopWorkspaceClient into the unified workspace

**Files:**

- Modify: `apps/desktop/src/desktopWorkspaceClient.ts`
- Modify as required: `apps/desktop/src/main.ts`, preload/bridge declarations, Desktop workspace cache and trust tests
- Modify: `apps/web/src/platform/desktopWorkspaceTarget.ts`
- Modify as required: unified workspace index/selectors and `apps/web/src/components/settings/HubSection.tsx`

1. Expose typed catalog refresh, verification, demand-retain/renew/release, connection state, snapshot subscription, and environment activation through Electron.
2. Merge Desktop remote snapshots with the colocated backend in the shared workspace index.
3. Make machine rows actionable with Verify, Connect, Open, and Disconnect.
4. Resolve Inbox, Projects, task, Files, Review, Agents, settings, Git, and PR APIs from environment IDs.
5. Preserve safe stale catalog data on refresh failure and prioritize interactive demand over metadata.
6. Add two-node catalog, connection, routing, stale-cache, and verification tests.
7. Run focused Desktop/web tests and `bun run build:desktop`.

## Wave 4: Mobile parity and qualification

### Task 9: Add native source-control and pull-request parity

**Files:**

- Add/modify: `apps/mobile/src/features/sourceControl/*`
- Modify as required: mobile navigation, project/task screens, shared client-runtime source-control state, and mobile tests

1. Add environment/project/worktree-scoped status, staged/unstaged files, and diffs.
2. Add guarded stage, unstage, discard, commit, branch, fetch, pull, and push actions.
3. Add PR metadata, checks/review state, open-in-browser, and supported create/update actions.
4. Reuse existing server contracts and capability flags; do not add a mobile-only Git implementation.
5. Require read readiness for reads and matching mutation leases for writes; keep cached offline views read-only.
6. Preserve explicit confirmation for destructive operations.
7. Run focused mobile tests and an iOS Simulator build.

### Task 10: Cross-client automated backstop

1. Run focused tests for all changed packages.
2. Run `bun fmt`, `bun run fmt:check`, `bun lint`, `bun typecheck`, and `bun run test` because the final change spans all runtime boundaries.
3. Run `bun run build --filter=@ryco/web` and `bun run --cwd apps/web test:browser`; install the pinned Playwright browser first only if absent.
4. Run `bun run build:desktop`.
5. Build and launch the iOS app in Simulator and run its focused native suite.
6. Audit the complete diff for secrets, private Hub data, generated drift, and unrelated changes.

### Task 11: Two-node, three-client production qualification

1. Record production repository status and keep it read-only throughout qualification.
2. Start or enroll one disposable node scoped to the isolated QA directory.
3. In Chrome, exercise two-node selection, isolated task creation, Files, Review, Agents, scoped settings, notification provenance, Git, and PR/check views.
4. Verify rapid select-then-New-Task cannot target the previous node.
5. In `/Applications/Ryco.app`, discover, verify, connect, open, and use both nodes through standard workspace routes.
6. In iOS Simulator, perform the one-scan flow, create an isolated task, and exercise source control and PR views; inspect production read-only.
7. Verify node popovers have no long disclosure and Settings Security retains it.
8. Verify human and JSON Hub status show the same recovery fingerprint.
9. Recheck production repository status byte-for-byte against the baseline.
10. Record only sanitized qualification results; never commit private identifiers, credentials, fingerprints, or infrastructure details.
