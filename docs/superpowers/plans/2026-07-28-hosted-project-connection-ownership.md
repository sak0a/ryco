# Hosted Project Connection Ownership Implementation Plan

**Goal:** Make hosted folder browsing, project creation, and clone destination selection use the
single lifecycle-owned current environment connection and recover across connection replacement.

**Design:** `docs/superpowers/specs/2026-07-28-hosted-project-connection-ownership-design.md`

## Execution rules

- Work only on `fix/hosted-project-connection-readiness` in the public Ryco repository.
- Keep `feat/hub-connector-cli-flags` and PR #254 unchanged.
- Do not change `ryco-hub` until the public repair is complete and reviewed.
- Add a failing regression before changing production behavior.
- If the regression disproves split connection ownership, stop and amend the design before
  modifying production code.
- Preserve the hosted lifecycle as the only owner of relay attempts, connection publication,
  snapshot readiness, and mutation authority.
- Do not log RPC payloads, filesystem contents, credentials, tickets, private identifiers, or
  deployment details.
- Never run `bun test`; use `bun run test`.

## Task 1: Reproduce split hosted connection ownership

**Files:**

- Modify: `apps/web/src/hostedHub/lifecycle.integration.test.ts`
- Modify if focused isolation is clearer: `apps/web/src/localApi.test.ts`

- [ ] Activate a hosted node and obtain the browser-local API before or during activation.
- [ ] Accept the current shell snapshot and assert one supervisor-owned connection.
- [ ] Replace or resume the hosted generation.
- [ ] Prove a connection-bound local API operation can target a stale client or cause a competing
      client while `readEnvironmentApi()` cannot resolve the current environment.
- [ ] Assert the regression fails for the same pre-dispatch boundary observed live.
- [ ] Run the focused integration test and record the expected failure.

## Task 2: Make browser-local API client resolution lifecycle-safe

**Files:**

- Modify: `apps/web/src/localApi.ts`
- Modify: `apps/web/src/localApi.test.ts`
- Modify as required: `apps/web/src/environments/runtime/index.ts`

- [ ] Separate cached platform-stable behavior from connection-bound client resolution.
- [ ] Resolve the current supervisor-owned primary client at invocation time.
- [ ] In hosted mode, return the bounded unavailable error when no current connection exists.
- [ ] In hosted mode, never call a helper that creates or registers a primary connection.
- [ ] Preserve direct and desktop startup behavior.
- [ ] Preserve native API overrides and optional MCP behavior without retaining an obsolete hosted
      client.
- [ ] Prove an API object obtained before replacement uses the replacement client afterward.
- [ ] Prove generic hosted local API access does not create a connection.
- [ ] Prove direct-mode local API access still resolves its primary backend.

## Task 3: Couple filesystem retries to the exact connection

**Files:**

- Modify: `apps/web/src/rpc/useProject.ts`
- Modify: `apps/web/src/rpc/projectAtoms.ts`
- Modify: `apps/web/src/rpc/projectAtoms.test.ts`
- Modify: `apps/web/src/components/useFilesystemBrowse.browser.tsx`

- [ ] Pass the exact connection/API identity observed by `useSyncExternalStore` into the active
      browse controller.
- [ ] Avoid a second unrelated global lookup between the connection notification and RPC dispatch.
- [ ] Keep the connection/API object out of the persistent browse cache key.
- [ ] On replacement, update the controller target and retry when no fresh successful data exists.
- [ ] Preserve fetch-token protection against superseded responses.
- [ ] Preserve prior successful entries during reconnect and server errors.
- [ ] Prove unavailable-to-current-connection recovery sends one `filesystem.browse` request through
      the replacement client.

## Task 4: Cover complete hosted project flows

**Files:**

- Modify: `apps/web/src/components/CommandPaletteDialog.browser.tsx` if present
- Otherwise modify the closest existing command-palette browser suite.
- Modify as needed: `apps/web/src/components/CommandPaletteDialog.tsx`

- [ ] Open Add project, choose Local folder while the environment is unavailable, then publish the
      current connection.
- [ ] Prove directories appear without closing and reopening the picker.
- [ ] Prove manual project submission still reports a visible bounded error if readiness disappears
      at submission time.
- [ ] Prove clone destination browsing uses the same current connection.
- [ ] Preserve provider readiness and setup-required behavior.

## Task 5: Run focused validation

- [ ] Run the focused local API tests.
- [ ] Run the focused hosted lifecycle integration tests.
- [ ] Run project atom and filesystem browse tests.
- [ ] Run the affected command-palette browser tests.
- [ ] Run `git diff --check` and inspect the complete diff.
- [ ] Confirm no Hub repository files or private operational details entered the public change.

## Task 6: Run the repository backstop

- [ ] Confirm the pinned Bun version is active.
- [ ] Run `bun install --frozen-lockfile`.
- [ ] Run `bun fmt`.
- [ ] Run `bun run fmt:check`.
- [ ] Run `bun lint`.
- [ ] Run `bun typecheck`.
- [ ] Run `bun run typecheck:effect`.
- [ ] Run `bun run test`.
- [ ] Run `bun run build`.
- [ ] Run `bun run build --filter=@ryco/web`.
- [ ] Install the pinned browser runtime if required.
- [ ] Run `bun run --cwd apps/web test:browser`.

## Task 7: Publish the public repair

- [ ] Inspect the branch diff against `origin/main`.
- [ ] Commit production and test changes with focused conventional commits.
- [ ] Push `fix/hosted-project-connection-readiness`.
- [ ] Open a draft PR against public Ryco `main`.
- [ ] Include live reproduction evidence and exact validation without private identifiers.

## Task 8: Prepare Hub integration after public completion

- [ ] Re-read `ryco-hub` repository instructions before modifying it.
- [ ] Create a separate Hub branch from `main`.
- [ ] Update only the public Ryco pin and generated bundle artifacts required by that repository.
- [ ] Run the Hub repository's required validation.
- [ ] Open a dependent Hub PR referencing the public repair.
- [ ] After both changes merge and the node restarts, re-run live folder browse, manual project
      creation, clone destination, and oversized-directory qualification.
