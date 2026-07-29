# Hosted canonical environment identity implementation plan

**Design:** `docs/superpowers/specs/2026-07-29-hosted-canonical-environment-identity-design.md`

**Goal:** Keep one Hub-issued environment identity across hosted activation, server lifecycle
events, project state, routing, and RPC connection lookup.

## Task 1: Pin the identity policy with unit tests

**Files:**

- Modify: `apps/web/src/components/RootAppShell.logic.test.ts`
- Modify: `apps/web/src/components/RootAppShell.logic.ts`

1. Add failing tests for direct identity selection, hosted identity selection when server and Hub
   identifiers differ, and the hosted pre-descriptor race.
2. Add a pure resolver that returns the server identifier in direct mode, the current primary
   descriptor identifier in hosted mode, and `null` when hosted ownership has not published a
   descriptor.
3. Run the focused logic test.

## Task 2: Apply the canonical identity in the app shell

**Files:**

- Modify: `apps/web/src/components/RootAppShell.tsx`
- Add or modify a focused component/browser regression test under `apps/web/src/components`

1. Pass the authentication gate's hosted ownership into `EventRouter`.
2. Resolve lifecycle welcome and server configuration identities through the pure resolver.
3. In hosted mode, preserve the Hub-published primary descriptor instead of replacing it with the
   server descriptor.
4. Use the resolved identity for active-environment state, bootstrap synchronization, project
   lookup and keys, scoped references, and thread navigation.
5. If a hosted event arrives before the Hub descriptor is available, perform no identity-dependent
   mutation.
6. Add regression coverage proving a differing server identifier cannot replace the Hub identity
   or target an unregistered connection.

## Task 3: Validate

1. Install with the pinned Bun runtime and frozen lockfile if dependencies are not already current:
   `bun install --frozen-lockfile`.
2. Run focused web tests for the resolver and hosted lifecycle regression.
3. Run:

   ```sh
   bun fmt
   bun run fmt:check
   bun lint
   bun typecheck
   bun run typecheck:effect
   bun run test
   bun run build
   bun run build --filter=@ryco/web
   bun run --cwd apps/web test:browser:install
   bun run --cwd apps/web test:browser
   ```

4. Inspect the final diff for accidental generated or unrelated files.

## Task 4: Publish and deploy

1. Push the public fix branch and open a PR with the live failure evidence and validation results.
2. After merge, update the private Hub repository's vendored Ryco revision in a separate PR.
3. Redeploy the Hub static assets. The node server does not need a behavior change for this fix.
4. Hard-reload the hosted app and verify directory browsing, project creation/addition, and a
   large-repository listing over the live relay.
