# Hub Node Naming Implementation Plan

**Goal:** Give every newly enrolled Hub node a stable, distinguishable default name, allow
Desktop/headless operators to choose the enrollment proposal, and let Hub owners rename approved
nodes from the hosted directory without changing identity or relay authority.

**Architecture:** Add optional Hub node-name launch configuration, resolve automatic labels from
the Hub identity state's persistent environment ID, and persist the resolved label with pending
enrollment state. Desktop owns its bundled server's value through the existing restart/bootstrap
path. The public hosted client calls the Hub's existing owner-only rename endpoint and refreshes
directory state by immutable node ID. No node-authenticated rename operation, relay protocol
change, or private Hub service change is required.

**Design spec:** `docs/superpowers/specs/2026-07-29-hub-node-naming-design.md`

## Execution rules

- Work only on `design/desktop-hub-connection` or a branch from it.
- Preserve the four pre-existing unstaged declaration-file changes under `scripts/lib/`; do not
  stage, reformat, revert, or include them in a feature commit.
- Add failing focused tests before each behavior change.
- Never run `bun test`; use `bun run test` or a package-scoped test script.
- Keep the public repository free of private Hub deployment details, identifiers, credentials, and
  qualification evidence.
- Do not change node IDs, environment-ID ownership, signing keys, relay tickets, role policy,
  mutation readiness, reconnect ownership, relay schemas, or canonical fixtures.
- Do not add a label, Hub origin, environment ID, or filesystem path to connector status,
  diagnostics, telemetry, or support output.
- Before each commit, run `git diff --check`, inspect the complete staged diff, and confirm only the
  intended files are staged.

---

## Task 1: Add bounded Hub node-name configuration

**Files:**

- Modify: `packages/shared/src/nodeIdentity.ts`
- Modify: `packages/shared/src/nodeIdentity.test.ts`
- Modify: `apps/server/src/config.ts`
- Modify: `apps/server/src/cli.ts`
- Modify: `apps/server/src/cli-config.test.ts`
- Modify: `apps/server/src/cli.test.ts`
- Modify: `packages/contracts/src/hubConnector.ts`
- Modify: `packages/contracts/src/hubConnector.test.ts`

- [ ] Add a shared normalization helper for an optional Hub node name. It accepts only a trimmed,
      non-empty string whose JavaScript length is at most 100; it returns no display value, origin,
      or identifier in its error.
- [ ] Add `nodeName: string | undefined` to `HubConnectorConfig` and its default/raw configuration
      shapes.
- [ ] Add `--hub-node-name` to the shared server command flags and `RYCO_HUB_NODE_NAME` to
      `EnvServerConfig`.
- [ ] Add optional `hubNodeName` to the bootstrap envelope used by Desktop.
- [ ] Resolve precedence exactly as the existing Hub launch settings do: flag, environment,
      bootstrap. Desktop will later strip the environment variable, leaving its bootstrap value as
      the only bundled-server source.
- [ ] When the connector is enabled and the selected name is invalid, set its existing
      `configurationIssue: "configuration_invalid"` result. Do not prevent the local HTTP server or
      provider runtime from starting.
- [ ] Keep an omitted name distinct from an invalid supplied value; omission selects the automatic
      resolver in Task 2.
- [ ] Reduce `HubEnrollmentCeremonyDetail.label` from 128 to the actual enrollment/Hub bound of 100.
- [ ] Test valid boundary values, whitespace-only input, leading/trailing whitespace, an overlong
      value, disabled/enabled connector behavior, every precedence combination, and the unchanged
      behavior of every existing Hub flag.
- [ ] Test CLI help includes `--hub-node-name` and no command output prints the configured value.
- [ ] Run:

  ```sh
  bun run test packages/shared/src/nodeIdentity.test.ts \
    packages/contracts/src/hubConnector.test.ts \
    apps/server/src/cli-config.test.ts \
    apps/server/src/cli.test.ts
  ```

**Commit:** `Add Hub node name launch configuration`

---

## Task 2: Resolve stable automatic enrollment labels

**Files:**

- Create: `apps/server/src/hubConnector/HubEnrollmentLabel.ts`
- Create: `apps/server/src/hubConnector/HubEnrollmentLabel.test.ts`
- Modify: `apps/server/src/hubConnector/HubConnectorLive.ts`
- Modify: `apps/server/src/hubConnector/HubConnector.ts`
- Modify: `apps/server/src/hubConnector/HubConnector.test.ts`
- Create: `apps/server/src/hubConnector/HubConnectorLive.test.ts`

- [ ] Add a pure `resolveHubEnrollmentLabel` helper taking the optional configured name, friendly
      machine label, and Hub identity-state environment ID.
- [ ] For the automatic path, hash
      `"ryco.hub-node-label.v1\0" + environmentId` with SHA-256, take the first 20 bits, and encode
      exactly four uppercase Crockford Base32 characters.
- [ ] Produce `<machine label> · <tag>`, truncating only the machine portion so the result is at most
      100 JavaScript code units. Iterate Unicode scalars while truncating so a surrogate pair is
      never split.
- [ ] Keep explicit valid names exact after normalization and do not append the tag.
- [ ] Refactor the connector's startup metadata so platform/version and the friendly machine label
      stay static, while the final enrollment label is resolved only after reading the Hub identity
      state that owns the environment ID.
- [ ] Do not alter `ExecutionEnvironmentDescriptor.label` or direct/saved/SSH environment
      presentation.
- [ ] Add fixed-vector tests for the hash/tag algorithm, two distinct environment IDs, deterministic
      restart behavior, exact 100-character output, Unicode truncation, empty machine fallback, and
      explicit-name precedence.
- [ ] Add connector coverage proving enrollment sends the resolved label and no connector status or
      error gains the label.
- [ ] Run:

  ```sh
  bun run test apps/server/src/hubConnector/HubEnrollmentLabel.test.ts \
    apps/server/src/hubConnector/HubConnector.test.ts \
    apps/server/src/hubConnector/HubConnectorLive.test.ts
  ```

**Commit:** `Resolve stable Hub enrollment labels`

---

## Task 3: Persist the exact pending ceremony label

**Files:**

- Modify: `apps/server/src/hubIdentity/LocalHubIdentityState.ts`
- Modify: `apps/server/src/hubIdentity/LocalHubIdentityState.test.ts`
- Modify: `apps/server/src/hubIdentity/HubEnrollmentClient.ts`
- Modify: `apps/server/src/hubIdentity/HubEnrollmentClient.test.ts`
- Modify: `apps/server/src/hubConnector/HubIdentityRuntime.ts`
- Modify: `apps/server/src/hubConnector/HubIdentityRuntime.test.ts`
- Modify: `apps/server/src/hubConnector/HubConnector.ts`
- Modify: `apps/server/src/hubConnector/HubConnector.test.ts`
- Modify: `docs/node-identity.md`
- Modify: `docs/hub-connector.md`

- [ ] Add `label: string | null` to `PendingHubEnrollmentState`. It is bounded non-secret ceremony
      metadata, not an identifier or bearer value.
- [ ] Parse an absent legacy field as `null`, validate a present field with the same trimmed
      1–100-character rule, and keep the state-file version compatible.
- [ ] Write the resolved label into the initial pending record before the enrollment HTTP request.
      Preserve it through response commit, polling, cancellation, teardown, and crash recovery.
- [ ] Add `label: string | null` to `PendingHubEnrollmentDetail` and return it from
      `HubIdentityRuntime.readPendingEnrollment`.
- [ ] Make `HubConnector.readEnrollment` use the persisted label. For a legacy `null`, reconstruct
      only the pre-feature friendly machine label; do not apply a newly configured explicit name or
      automatic suffix.
- [ ] Keep the immediate enrollment response and the re-read ceremony byte-identical for all new
      records.
- [ ] Test migration from a pending record with no label, corruption for invalid present labels,
      persistence before transport, cleanup on failure/cancel, restart re-read, explicit-name
      changes during pending state having no effect, and active identity state remaining readable.
- [ ] Update public identity/connector documentation with the bounded pending label and the
      owner-authority boundary.
- [ ] Run:

  ```sh
  bun run test apps/server/src/hubIdentity \
    apps/server/src/hubConnector/HubIdentityRuntime.test.ts \
    apps/server/src/hubConnector/HubConnector.test.ts
  ```

**Commit:** `Persist pending Hub enrollment labels`

---

## Task 4: Carry node naming through Desktop launch ownership

**Files:**

- Modify: `packages/contracts/src/ipc.ts`
- Modify: `apps/desktop/src/desktopSettings.ts`
- Modify: `apps/desktop/src/desktopSettings.test.ts`
- Create: `apps/desktop/src/hubLaunchEnvironment.ts`
- Create: `apps/desktop/src/hubLaunchEnvironment.test.ts`
- Modify: `apps/desktop/src/preload.ts`
- Modify: `apps/desktop/src/main.ts`

- [ ] Extend `DesktopHubLaunchConfig` with `nodeName: string | null` and
      `DesktopBridge.setHubLaunchConfig` with optional `nodeName`.
- [ ] Add nullable `hubNodeName` to `DesktopSettings`; an absent field in an existing settings file
      migrates to `null` without rewriting the file on read.
- [ ] Extend `setDesktopHubPreference` to preserve unrelated values and support explicit reset to
      `null`.
- [ ] Validate a non-null value in Electron main before writing. A rejected value must leave the
      prior file and running backend untouched.
- [ ] Return the value through `getHubLaunchConfig` and expose it through the preload bridge without
      adding any generic filesystem access.
- [ ] Extract the Desktop-owned Hub environment removal into the small testable
      `hubLaunchEnvironment.ts` helper, include `RYCO_HUB_NODE_NAME`, and keep all existing stripped
      Hub variables covered.
- [ ] Pass only the persisted value as `hubNodeName` through the one-time bootstrap pipe.
- [ ] Make `setDesktopHubPreference` return the existing object for an exact no-op. The IPC handler
      writes and relaunches only when the returned object changed.
- [ ] Never log the configured node name because its automatic base is a machine label.
- [ ] Test old-settings migration, round trip, reset-to-automatic, preservation across other Hub
      setting changes, invalid input, child-environment stripping, bootstrap propagation, and
      failure-before-relaunch ordering.
- [ ] Run focused contracts and Desktop tests, then:

  ```sh
  bun run test apps/desktop/src/desktopSettings.test.ts \
    apps/desktop/src/hubLaunchEnvironment.test.ts
  bun run build:desktop
  ```

**Commit:** `Add Desktop Hub node name ownership`

---

## Task 5: Add the Desktop node-name settings row

**Files:**

- Modify: `apps/web/src/components/settings/HubSection.tsx`
- Modify: `apps/web/src/components/settings/HubAdvancedOptions.tsx`
- Modify: `apps/web/src/components/settings/HubAdvancedOptions.test.ts`
- Modify: `apps/web/src/components/settings/SettingsPanels.browser.tsx`

- [ ] Load the persisted node name with the existing Hub launch configuration and keep a separate
      draft/error state.
- [ ] Add a primary `Node name` settings row adjacent to `Hub address`, not inside Advanced.
- [ ] Use a blank draft for `null` and the placeholder
      `Automatic: machine name · node code`.
- [ ] Reuse the identity-presence authority rule: editable only when identity is `none`; pending,
      active, and unknown states are locked.
- [ ] Saving a non-empty draft trims and sends `{ nodeName }`; saving an emptied previously
      configured draft sends `{ nodeName: null }`. Label the mutation `Save and restart`.
- [ ] Do not present the local proposal as the canonical name after enrollment. Locked copy directs
      the operator to the Hub, where the stored name is authoritative.
- [ ] Keep the pending ceremony's exact persisted label visible in its existing comparison list.
- [ ] Add `--hub-node-name` and `RYCO_HUB_NODE_NAME` guidance to the advanced CLI equivalents
      without exposing the user's configured value.
- [ ] Browser-test automatic/configured drafts, validation, save/reset payloads, restart affordance,
      all four identity states, pending ceremony consistency, and keyboard/accessibility names.
- [ ] Run:

  ```sh
  bun run test apps/web/src/components/settings/HubAdvancedOptions.test.ts
  bun run --cwd apps/web test:browser -- src/components/settings/SettingsPanels.browser.tsx
  ```

**Commit:** `Add Desktop Hub node name settings`

---

## Task 6: Add the bounded hosted rename API

**Files:**

- Modify: `packages/client-runtime/src/authorization/api.ts`
- Modify: `packages/client-runtime/src/authorization/api.test.ts`
- Modify: `packages/client-runtime/src/authorization/types.ts` only if a branded input type is
  needed

- [ ] Add `HostedHubApi.renameNode(nodeId, label, signal?)`.
- [ ] Validate the existing bounded node-ID pattern and a trimmed 1–100-character label before
      sending.
- [ ] Send `POST /api/admin/nodes/:nodeId/rename` with `{ label }` through the shared request path.
      Browser requests must use the current CSRF behavior; native requests must retain the current
      DPoP behavior.
- [ ] Accept only an object with `ok === true`; malformed success responses become
      `invalid_response`.
- [ ] Do not include the attempted label, node ID, response body, or private Hub error detail in a
      thrown message or log.
- [ ] Test cookie/CSRF, native bearer/DPoP, encoded route construction, invalid local inputs,
      forbidden/session failure, malformed success, abort, and the exact bounded body.
- [ ] Run:

  ```sh
  bun run test packages/client-runtime/src/authorization/api.test.ts
  ```

**Commit:** `Add the hosted Hub node rename client`

---

## Task 7: Add owner-only rename UX to hosted node details

**Files:**

- Modify: `apps/web/src/components/hostedHub/HostedNodeDetail.tsx`
- Create: `apps/web/src/components/hostedHub/HostedNodeRenameDialog.tsx`
- Modify: `apps/web/src/components/hostedHub/HostedHubRoot.tsx`
- Modify: `apps/web/src/components/hostedHub/HostedNodeDirectory.browser.tsx`

- [ ] Pass the authenticated owner capability and an async rename callback into
      `HostedNodeDetail`; keep the node itself re-resolved from store state by immutable ID.
- [ ] Render a `Rename` action only for account role `owner` on the desktop/tablet presentation.
      Viewers and operators receive no disabled placeholder.
- [ ] Open one focused dialog with the current canonical label prefilled, auto-focus on the input,
      and explicit Cancel/Save actions.
- [ ] Disable Save for an unchanged, blank, overlong, or pending value. Keep validation copy bounded
      and place mutation failures in an accessible alert without closing the dialog.
- [ ] On success, close the rename dialog, call `hostedHubController.refreshDirectory()`, and keep
      the detail selection tied to the same node ID so the row/sheet update to the returned
      directory label.
- [ ] Keep rename available for offline and revoked nodes; only connection controls remain blocked.
- [ ] Do not add the action or dialog to the frozen `apps/web` phone tier. It continues displaying
      refreshed canonical labels; native mobile management UI is a separate parity task.
- [ ] Browser-test owner success, unchanged/invalid input, API failure recovery, operator/viewer
      absence, offline/revoked availability, selection stability after reordered labels, the
      desktop/tablet presentation, and the unchanged phone-tier control set.
- [ ] Run:

  ```sh
  bun run --cwd apps/web test:browser -- src/components/hostedHub/HostedNodeDirectory.browser.tsx
  ```

**Commit:** `Add owner-only Hub node rename UI`

---

## Task 8: Documentation and full validation

**Files:**

- Modify: `docs/hub-connector.md`
- Modify: `docs/node-identity.md`
- Modify: CLI/help snapshots or public setup docs only where current behavior is documented

- [ ] Document the automatic format, explicit Desktop/CLI configuration, 100-character bound,
      pending-label persistence, and Hub-owner rename rule.
- [ ] State explicitly that the name is metadata and cannot affect node identity, grants, relay
      routing, or mutation authority.
- [ ] Confirm the private Hub service needs no source change and keep deployment follow-up out of
      the public implementation.
- [ ] Confirm Bun is `1.3.14`; if dependencies are not already current, run
      `bun install --frozen-lockfile`.
- [ ] Install the pinned browser runtime if absent:

  ```sh
  bun run --cwd apps/web test:browser:install
  ```

- [ ] Run the complete required backstop:

  ```sh
  bun fmt
  bun run fmt:check
  bun lint
  bun typecheck
  bun run typecheck:effect
  bun run test
  bun run build
  bun run build --filter=@ryco/web
  bun run --cwd apps/web test:browser
  bun run build:desktop
  ```

- [ ] After formatting/builds, inspect `git status` and remove no generated file blindly. Preserve
      unrelated pre-existing changes and stage only intentional feature files.
- [ ] Run `git diff --check`, inspect the complete branch diff against `origin/main`, and confirm no
      private or sensitive material entered source, tests, docs, errors, or snapshots.

## Manual qualification

Using two disposable local node state directories against a non-production Hub:

1. Start both without a configured name and verify their enrollment/approval labels share the
   machine base but have different stable tags.
2. Restart before approval and verify each pending ceremony retains the exact same label.
3. Enroll a Desktop node with an explicit name and a CLI node with `--hub-node-name`.
4. Rename one from the owner Hub directory and verify web/phone directory and detail surfaces update
   without reconnecting or changing the selected node.
5. Verify an operator account has no rename affordance and a direct mutation remains forbidden.
6. Restart the renamed node and verify the Hub rename remains canonical.

Do not record the live Hub origin, deployment identifiers, node IDs, credentials, or qualification
screenshots in the public repository.

## Completion boundary

Implementation is complete when automatic and configured enrollment names work through Desktop and
CLI, pending ceremonies retain their exact proposal across restart, Hub owners can rename approved
nodes, non-owners and nodes cannot, existing Hub records remain untouched, and every required
validation gate passes.
