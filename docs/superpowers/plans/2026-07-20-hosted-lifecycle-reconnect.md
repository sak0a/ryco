# Hosted lifecycle reconnect implementation plan

**Goal:** Make hosted browser offline/online and background/foreground recovery complete
automatically through one fresh, fail-closed session lifecycle without duplicate environment or
relay connections.

**Design spec:**
`docs/superpowers/specs/2026-07-20-hosted-lifecycle-reconnect-design.md`

## Execution rules

- Work only on `fix/hosted-lifecycle-reconnect` in the public repository.
- Add the composed regression before changing production behavior and confirm that it fails for the
  overlapping reconnect-owner reason.
- Never run `bun test`; use `bun run test` or package-level `bun run ... test` commands.
- Preserve relay protocol 1.2, schemas, fixtures, ticket policy, authorization, delivery-unknown,
  request non-replay, and non-hosted reconnect behavior.
- Do not add private issue, deployment, account, node, project, URL, or operational details to the
  public repository, tests, commits, logs, or pull request.
- Inspect the complete staged diff and run `git diff --check` before every commit.

## Task 1: Add the red composed lifecycle regression

**Files:**

- Add or modify a focused test under `apps/web/src/hostedHub/` that composes the real hosted state
  controller, hosted environment transition, environment connection bootstrap, relay-attempt
  lifecycle callbacks, and shell snapshot readiness.
- Reuse focused test utilities from `apps/web/src/hostedHub/transport.test.ts` and
  `apps/web/src/environments/runtime/connection.test.ts` where extraction improves clarity.

- [ ] Establish an authenticated, authorized, online selected node and a ready shell snapshot.
- [ ] Dispatch browser suspension and prove mutation authorization fails closed immediately.
- [ ] Dispatch online/visible recovery while the generic connection recovery path is eligible.
- [ ] Reproduce the prior overlap between a generic `EnvironmentConnection.reconnect()` and hosted
      same-node replacement.
- [ ] Prove the prior behavior can leave an online relay generation without current shell
      readiness.
- [ ] Confirm the focused test fails before production changes for that ownership conflict, not
      because of an unrelated timeout or incomplete mock.

## Task 2: Add transport-only hosted suspension

**Files:**

- Modify: `apps/web/src/hostedHub/environment.ts`
- Modify: `apps/web/src/hostedHub/environment.test.ts`
- Modify: `apps/web/src/hostedHub/state.ts`
- Modify: `apps/web/src/hostedHub/state.test.ts`

- [ ] Add an idempotent hosted suspension operation on the existing serialized environment
      transition queue.
- [ ] Reset attempt-local ticket/request state and dispose the primary environment connection.
- [ ] Preserve same-node descriptors, projections, drafts, queued UI state, and terminal
      presentation during suspension.
- [ ] Keep full cleanup for sign-out, authorization removal, revocation, and node switching.
- [ ] Have `suspendBrowser()` invalidate authority and enqueue transport suspension.
- [ ] Ensure a newer suspension aborts an in-flight resume and that activation runs behind any
      queued suspension.
- [ ] Ensure an aborted activation never creates a replacement connection.

## Task 3: Make hosted lifecycle the only hosted reconnect owner

**Files:**

- Modify: `apps/web/src/components/WebSocketConnectionSurface.tsx`
- Modify: `apps/web/src/components/WebSocketConnectionSurface.logic.test.ts`
- Modify: `apps/web/src/components/RootAppShell.tsx`
- Modify: `apps/web/src/environments/runtime/service.ts`
- Modify: `apps/web/src/environments/runtime/service.threadSubscriptions.test.ts`

- [ ] Pass the existing hosted auth-gate mode into the generic connection surface through a small,
      explicit recovery-policy input.
- [ ] In hosted mode, continue tracking browser online and connection display state without forcing
      online, focus, stalled-window, or generic manual reconnects.
- [ ] Preserve the generic forced reconnect and retry action for direct and desktop modes.
- [ ] Do not install the environment runtime's visibility/pageshow reconnect listener in hosted
      mode.
- [ ] Preserve visibility/pageshow recovery for non-hosted primary and saved environments.
- [ ] Keep the hosted transport's own retry schedule and hosted retry control unchanged.

## Task 4: Complete recovery and failure coverage

**Files:**

- Modify the composed hosted lifecycle test from Task 1.
- Modify focused state, environment, transport, connection, and connection-surface tests only where
  required.

- [ ] Prove offline to online obtains fresh attempt material, opens one relay, accepts one current
      snapshot, and becomes ready without refresh.
- [ ] Prove hidden/background to visible uses the same complete path.
- [ ] Prove repeated offline, hidden, online, visible, focus, and pageshow events do not create loops
      or duplicate relay/environment connections.
- [ ] Prove stale-generation relay callbacks and snapshots cannot restore role, readiness, or
      mutation authority.
- [ ] Prove same-node recovery preserves presentation state while replacing transport state.
- [ ] Prove a relay channel without a shell snapshot reaches the 30-second synchronization failure.
- [ ] Prove session expiry during resume clears account authority and prevents another ticket or
      socket attempt.
- [ ] Prove mutation authorization remains false through session validation, directory refresh,
      relay connection, and replay until the current snapshot is accepted.
- [ ] Prove delivery-unknown behavior and explicit acknowledgement remain unchanged.
- [ ] Prove direct, saved, and desktop recovery behavior is unchanged.

## Task 5: Run focused and complete public validation

- [ ] Run the new composed lifecycle test alone.
- [ ] Run hosted state, environment, transport, relay socket, environment connection, environment
      service, connection-surface, and hosted browser tests.
- [ ] Run `bun fmt`.
- [ ] Run `bun run fmt:check`.
- [ ] Run `bun lint`.
- [ ] Run `bun typecheck`.
- [ ] Run `bun run typecheck:effect` because the environment/RPC lifecycle touches Effect-backed
      transport behavior.
- [ ] Run `bun run test`.
- [ ] Run `bun run build`.
- [ ] Run `bun run --cwd apps/web test:browser`.
- [ ] Run `bun run release:smoke`.
- [ ] Confirm canonical relay schemas and compatibility fixtures have no diff.

## Task 6: Review and publish the public change

- [ ] Run `git diff --check` and inspect the complete branch diff against `origin/main`.
- [ ] Scan source, tests, docs, output, commit messages, and PR text for secrets, private
      identifiers, infrastructure details, payloads, URLs, or issue references.
- [ ] Confirm there is no schema, fixture, migration, cache-policy, or generated drift.
- [ ] Commit the implementation conventionally with the configured signer.
- [ ] Push the real public branch and open a focused public pull request describing only the
      reusable lifecycle defect.
- [ ] Wait for required CI and review, address actionable comments, and rerun affected gates.
- [ ] Merge only after required checks pass and record the immutable public-main commit.

## Private follow-up boundary

Updating another repository's public gitlink, rebuilding a private image, deploying a service,
changing access/session state, performing physical-device qualification, or running a rollback
drill are separate follow-up operations. Repository pinning follows its own branch and pull request.
Any live deployment or access-state mutation requires its separately approved exact operation
packet.
