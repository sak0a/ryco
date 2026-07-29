# Native mobile core workspace redesign implementation plan

**Design:** `docs/superpowers/specs/2026-07-26-native-mobile-core-workspace-redesign.md`
**Public repository:** `sak0a/ryco`
**Starting branch:** `codex/mobile-core-workspace-design`
**Starting commit:** `7d69bcd43`

## Objective

Turn `apps/mobile` into the approved C1 core workspace:

- Inbox for active and recent threads across live environments;
- Projects for project → worktree → thread hierarchy and basic mutations;
- Nodes for Hub and direct connection status and repair;
- compose-first New Task creation;
- complete thread context, Markdown, review, approvals, input, and attachments; and
- full-screen, simplified Settings.

The public app remains runnable after every task. The plan reuses the existing contracts,
connection supervisor, hosted runtime, native composer, Markdown renderer, and diff canvas.

## Explicit boundary

This plan does not modify the private `ryco-hub` repository.

The arbitrary-domain browser-to-native DPoP handoff requires a separate private security design,
explicit user permission, and its own implementation plan. Until that prerequisite exists, the
mobile domain editor and handoff entry remain development-gated. Existing build-time hosted mode
and direct connections continue to work.

## Execution rules

1. Use Bun `1.3.14`, as pinned by the repository.
2. Use `bun run --cwd apps/mobile test`; never use `bun test`.
3. Put screen decisions in pure `.ts` models because the test runner cannot mount React Native.
4. Add a failing focused test before each behavior change.
5. Keep native modules lazily imported where the existing platform seam requires it.
6. Do not duplicate readiness, authorization, orchestration, relay, or synchronization logic.
7. Dispatch non-idempotent mutations once with stable command IDs and wait for authoritative
   events before dependent commands.
8. Manually review every new or changed mount effect.
9. Run focused tests after each task and the complete public gates before completion.
10. Commit small, conventional, reviewable checkpoints.

## Task 1 — Semantic foundation and compact chrome

**Files:**

- Modify `apps/mobile/global.css`
- Modify `apps/mobile/src/components/RycoWordmark.tsx`
- Modify `apps/mobile/src/features/home/HomeScreen.tsx`
- Modify `apps/mobile/src/features/home/HomeScreen.test.ts`
- Modify `apps/mobile/src/features/settings/SettingsAppearanceRouteScreen.tsx`
- Modify `apps/mobile/src/features/threads/PendingApprovalCard.tsx`
- Modify `apps/mobile/src/features/threads/PendingUserInputCard.tsx`
- Modify `apps/mobile/src/features/threads/ThreadDetailScreen.tsx`
- Add `apps/mobile/src/features/threads/threadPresentation.ts`
- Add `apps/mobile/src/features/threads/threadPresentation.test.ts`

**Steps:**

1. Add red tests for the R-only mark, two separate 44-point header actions, semantic plan/approval
   tones, and neutral user-bubble presentation.
2. Replace the compact wordmark with the single R mark while keeping the full mark available for
   onboarding/About.
3. Separate Search/New Task header controls with explicit 44×44 frames and accessible labels.
4. Add a semantic plan token and replace raw violet, amber, and sky classes.
5. Change user-message tokens to the approved graphite surface and consume them.
6. Increase appearance stepper targets to 44 points with labels for increment/decrement.
7. Run focused tests, `rg` for forbidden palette classes, mobile typecheck, and formatter check.

**Checkpoint:** The existing Home and Thread routes still work, but their chrome and semantic
surfaces match the approved visual system.

## Task 2 — Pure C1 Home models

**Files:**

- Add `apps/mobile/src/features/home/homeMode.ts`
- Add `apps/mobile/src/features/home/homeMode.test.ts`
- Add `apps/mobile/src/features/inbox/inboxModel.ts`
- Add `apps/mobile/src/features/inbox/inboxModel.test.ts`
- Add `apps/mobile/src/features/projects/projectsModel.ts`
- Add `apps/mobile/src/features/projects/projectsModel.test.ts`
- Add `apps/mobile/src/features/nodes/nodesModel.ts`
- Add `apps/mobile/src/features/nodes/nodesModel.test.ts`
- Modify `apps/mobile/src/state/homeData.ts`
- Modify `apps/mobile/src/state/homeGrouping.ts`
- Modify `apps/mobile/src/state/homeGrouping.test.ts`

**Steps:**

1. Define `HomeMode = "inbox" | "projects" | "nodes"` and a pure reducer for mode, query, and
   node scope.
2. Derive Inbox `Active now` and `Recent` sections with deterministic priority and recency.
3. Derive Project rows grouped by environment with worktree/thread counts and bounded metadata.
4. Derive Node rows from direct runtime records and hosted directory state without merging their
   credential planes.
5. Define specific empty-state actions for missing connection, missing project, missing thread,
   and filtered results.
6. Test multi-environment scoping, stale/read-only states, missing references, stable ordering,
   and shallow-stable outputs.

**Checkpoint:** All C1 presentation and navigation decisions are testable without React Native.

## Task 3 — C1 Home shell and Inbox

**Files:**

- Add `apps/mobile/src/components/RycoMark.tsx`
- Add `apps/mobile/src/components/HomeModeControl.tsx`
- Add `apps/mobile/src/features/inbox/InboxScreen.tsx`
- Add `apps/mobile/src/features/inbox/InboxThreadRow.tsx`
- Add `apps/mobile/src/features/projects/ProjectsScreen.tsx`
- Add `apps/mobile/src/features/nodes/NodesScreen.tsx`
- Modify `apps/mobile/src/features/home/HomeScreen.tsx`
- Modify `apps/mobile/src/features/home/HomeRouteScreen.tsx`
- Modify `apps/mobile/src/features/home/HomeScreen.test.ts`
- Modify `apps/mobile/src/Stack.tsx`

**Steps:**

1. Render the compact Inbox/Projects/Nodes control below the native glass header.
2. Preserve each mode's query, scope, and scroll position for the Home lifetime.
3. Use `@legendapp/list` for Inbox and Projects, with row keys scoped by environment.
4. Add current-mode search and an All nodes/one-node scope control.
5. Route empty-state actions to Nodes, Add Project, or New Task.
6. Keep the R menu limited to Hub account/Connect Hub, Settings, and About.
7. Validate VoiceOver labels, 320-point width, Dynamic Type, and pressed states.

**Checkpoint:** Home is fully navigable as C1; Inbox is useful with both empty and live state.

## Task 4 — Full-screen route structure and Settings

**Files:**

- Modify `apps/mobile/src/navigation/mvpRouteConfig.ts`
- Modify `apps/mobile/src/navigation/mvpRouteConfig.test.ts`
- Modify `apps/mobile/src/Stack.tsx`
- Modify `apps/mobile/src/features/settings/SettingsRouteScreen.tsx`
- Add `apps/mobile/src/features/settings/SettingsWorkspaceRouteScreen.tsx`
- Add `apps/mobile/src/features/settings/SettingsHubRouteScreen.tsx`
- Add `apps/mobile/src/features/settings/SettingsAboutRouteScreen.tsx`
- Modify `apps/mobile/src/features/settings/SettingsAppearanceRouteScreen.tsx`
- Modify `apps/mobile/src/features/settings/SettingsClientStorageRouteScreen.tsx`

**Steps:**

1. Replace the Settings form sheet with a full-screen native-stack route.
2. Remove Settings → Environments and its duplicate Add Environment path.
3. Add Hub, Workspace defaults, Appearance, and App sections.
4. Keep routine connect/switch/reconnect/remove actions exclusively in Nodes.
5. Route the existing hosted account surface from Hub settings when hosted mode is available.
6. Show version, build stage, diagnostics, privacy, and licenses in App/About.
7. Update route/linking tests and ensure overlay-path behavior remains correct.

**Checkpoint:** Settings has one understandable full-screen hierarchy and no duplicate node
browser.

## Task 5 — Project and worktree actions

**Files:**

- Add `apps/mobile/src/features/projects/projectActions.ts`
- Add `apps/mobile/src/features/projects/projectActions.test.ts`
- Add `apps/mobile/src/features/projects/ProjectRouteScreen.tsx`
- Add `apps/mobile/src/features/projects/ProjectDetailScreen.tsx`
- Add `apps/mobile/src/features/projects/AddProjectRouteScreen.tsx`
- Add `apps/mobile/src/features/projects/WorktreeRow.tsx`
- Add `apps/mobile/src/features/projects/WorktreeEditorSheet.tsx`
- Modify `apps/mobile/src/navigation/mvpRouteConfig.ts`
- Modify `apps/mobile/src/navigation/mvpRouteConfig.test.ts`
- Modify `apps/mobile/src/Stack.tsx`

**Steps:**

1. Add pure builders for `project.create`, `project.meta.update`, `worktree.create`,
   `worktree.meta.update`, `worktree.archive`, and `worktree.restore`.
2. Reuse the environment API dispatch seam and shared readiness decision.
3. Validate node-owned workspace paths without deriving local paths on the phone.
4. Implement Add Project, Project detail, worktree create/rename/archive/restore, and thread lists.
5. Show one local optimistic worktree row only while awaiting its authoritative event.
6. Preserve the current draft and remove the optimistic row on bounded failure.
7. Test stable IDs, single dispatch, readiness denial, reconciliation, and error mapping.

**Checkpoint:** A mutation-ready direct or hosted node can create and manage projects/worktrees.

## Task 6 — Compose-first New Task

**Files:**

- Add `apps/mobile/src/features/newTask/newTaskModel.ts`
- Add `apps/mobile/src/features/newTask/newTaskModel.test.ts`
- Add `apps/mobile/src/features/newTask/newTaskController.ts`
- Add `apps/mobile/src/features/newTask/newTaskController.test.ts`
- Add `apps/mobile/src/features/newTask/NewTaskRouteScreen.tsx`
- Add `apps/mobile/src/features/newTask/NewTaskContextSheet.tsx`
- Add `apps/mobile/src/features/newTask/NewTaskComposer.tsx`
- Modify `apps/mobile/src/navigation/mvpRouteConfig.ts`
- Modify `apps/mobile/src/navigation/mvpRouteConfig.test.ts`
- Modify `apps/mobile/src/Stack.tsx`

**Steps:**

1. Derive defaults from launch context, current mutation-ready environment, and saved preferences.
2. Keep prompt/attachments mounted while Node, Project, Worktree, model, and runtime controls open.
3. Implement the ordered missing-step controller: project → worktree → thread → first turn.
4. Use stable command/message IDs and authoritative-event waits between dependent commands.
5. Retain successful objects and draft state after a later-step failure.
6. Name the failed step and expose explicit retry without silently repeating earlier mutations.
7. Navigate to Thread only after thread creation is authoritative; represent uncertain turn
   delivery honestly.

**Checkpoint:** New Task can create the missing hierarchy and start real work from one screen.

## Task 7 — Thread completeness

**Files:**

- Add `apps/mobile/src/features/threads/ThreadMessage.tsx`
- Add `apps/mobile/src/features/threads/ThreadContextBar.tsx`
- Add `apps/mobile/src/features/threads/threadHeaderModel.ts`
- Add `apps/mobile/src/features/threads/threadHeaderModel.test.ts`
- Modify `apps/mobile/src/features/threads/ThreadDetailScreen.tsx`
- Modify `apps/mobile/src/features/threads/ThreadRouteScreen.tsx`
- Modify `apps/mobile/src/features/threads/ThreadComposer.tsx`
- Modify `apps/mobile/src/features/threads/executeSendTurn.ts`
- Modify `apps/mobile/src/features/threads/executeSendTurn.test.ts`

**Steps:**

1. Replace the timeline `ScrollView` with a keyboard-aware virtualized list.
2. Render assistant content through the native selectable Markdown component on iOS and a
   selectable plain-text fallback elsewhere.
3. Render user messages with the semantic graphite bubble.
4. Wire the native composer editor and attachment strip into turn payloads.
5. Add the persistent `Node · Project · Worktree` context bar.
6. Add visible Review and More actions; expose rename, archive/unarchive, stop, and details.
7. Keep approvals/input requests above the composer with keyboard-safe wrapped actions.
8. Test header action visibility, context fallbacks, attachments, draft retention, and outbox
   behavior in pure models.

**Checkpoint:** Existing and newly created threads support the approved mobile chat/review loop.

## Task 8 — Nodes surface and direct connection clarity

**Files:**

- Modify `apps/mobile/src/features/nodes/NodesScreen.tsx`
- Add `apps/mobile/src/features/nodes/NodeRow.tsx`
- Add `apps/mobile/src/features/nodes/DirectConnectionMethods.tsx`
- Modify `apps/mobile/src/features/connection/ConnectionsNewRouteScreen.tsx`
- Modify `apps/mobile/src/features/connection/useConnectionController.ts`
- Modify `apps/mobile/src/features/hostedHub/HubNodeSection.tsx`
- Modify `apps/mobile/src/features/hostedHub/HubNodeSection.test.ts`

**Steps:**

1. Present the configured Hub and its nodes first, direct saved connections second.
2. Show node, role, presence, selected state, relay/direct transport, and bounded readiness.
3. Keep Hub selection fail-closed until directory/browser state is current.
4. Present QR, pairing URL, host + code, LAN host, and Tailscale host as clear methods under
   Direct connection.
5. Label Tailscale as direct reachability, not a separate account plane.
6. Keep reconnect, rename, disconnect, and recoverable removal actions in Nodes.
7. Regression-test Hub/direct credential isolation.

**Checkpoint:** Users can understand and repair every currently supported connection method.

## Task 9 — One-Hub public profile seam

**Files:**

- Add `apps/mobile/src/hostedHub/hubProfile.ts`
- Add `apps/mobile/src/hostedHub/hubProfile.test.ts`
- Add `apps/mobile/src/hostedHub/hubCapability.ts`
- Add `apps/mobile/src/hostedHub/hubCapability.test.ts`
- Add `apps/mobile/src/features/settings/HubDomainEditor.tsx`
- Modify `apps/mobile/src/features/settings/SettingsHubRouteScreen.tsx`
- Modify `apps/mobile/src/hostedHub/runtimeConfig.ts`
- Modify `apps/mobile/src/platform/config.ts`

**Steps:**

1. Normalize one absolute HTTPS origin and reject credentials, path, query, fragment, malformed
   host, and production-insecure origins.
2. Persist only origin, bounded label, and compatibility metadata in non-secret KV.
3. Keep native session credentials in SecureStore and DPoP key material non-exportable.
4. Define the public bounded capability decoder/client without private server policy.
5. Build an explicit Hub-domain reset plan that tears down Hub-scoped state and preserves direct
   connections.
6. Development-gate editing and browser-handoff entry until the compatible Hub endpoint exists.
7. Test normalization, compatibility failures, reset isolation, and absence of secret fields.

**Checkpoint:** The public client is ready for a separately approved arbitrary-domain handoff
without shipping a broken production action.

## Task 10 — Interactive QA and complete public gates

**Files:** Verification only, except focused fixes found by QA.

**Steps:**

1. Run:

   ```sh
   bun install --frozen-lockfile
   bun fmt
   bun run fmt:check
   bun lint
   bun typecheck
   bun run typecheck:effect
   bun run test
   bun run build
   bun run --cwd apps/mobile test
   bun run --cwd apps/mobile typecheck
   cd apps/mobile && APP_VARIANT=development ./node_modules/.bin/expo config
   ```

2. Strip ANSI only when inspecting typecheck text; always trust the command exit code.
3. Use the Expo development client and Fast Refresh in the iOS Simulator.
4. Exercise Inbox/Projects/Nodes, Settings, New Task, Thread, Review, offline/reconnect, approval,
   user input, keyboard, rotation, and supported phone widths.
5. Inspect accessibility labels/order, Dynamic Type, Reduce Motion, touch targets, safe areas, and
   horizontal overflow.
6. Review the complete diff for released-migration changes, contract forks, credentials, private
   data, generated drift, and unrelated files.
7. Record simulator limitations honestly; do not claim camera, Secure Enclave, passkey, Keychain,
   deployed Hub relay, or real-device lifecycle evidence.

**Checkpoint:** All public gates pass and simulator evidence supports the mobile UX claims.

## Private follow-up gate

After Task 9, stop and ask the user for permission before any write in `ryco-hub`. If permission is
granted, create a separate private security specification and plan for:

- unauthenticated bounded capability discovery;
- ephemeral system-browser authentication;
- one-time DPoP-key-bound native handoff;
- expiry, replay protection, throttling, compare-and-update persistence, and audit behavior;
- stable bounded errors and strict secret/logging exclusions; and
- deployed-Hub plus real-device qualification.

The public and private changes must stay on separate branches, commits, and pull requests.

## Plan self-review

- No placeholder tasks or unresolved implementation choices remain.
- Every approved design section maps to a task.
- Files, terminal, advanced Git, tablet split view, notifications, and release work remain
  deferred.
- The public/private boundary is explicit.
- Each behavior-heavy task starts with pure tests and ends with a runnable checkpoint.
- React Native mount effects remain subject to manual review because the test suite cannot mount
  screens.
