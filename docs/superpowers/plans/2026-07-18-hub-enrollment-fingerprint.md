# Hub enrollment fingerprint implementation plan

**Goal:** Let an operator compare the node-side canonical public-key fingerprint with the Hub approval screen before approving device-code enrollment.

**Architecture:** Extend the existing bounded `HubEnrollmentStartResult` shared contract with one strictly validated fingerprint string. Format the enrollment identity's existing 32-byte fingerprint inside `HubConnector.enroll()`, carry it through the authenticated loopback route, and render the same value in human and JSON CLI output. Do not expose raw keys or touch relay contracts.

**Public issue:** #174

## Task 1: Add the strict result contract

**Files:**

- Modify: `packages/contracts/src/hubConnector.ts`
- Modify: `packages/contracts/src/hubConnector.test.ts`

1. Add a reusable schema for `SHA256:` followed by exactly 43 base64url characters.
2. Make `fingerprint` required in `HubEnrollmentStartResult`.
3. Add acceptance and rejection tests for prefix, alphabet, padding, and length.
4. Run `bun run test packages/contracts/src/hubConnector.test.ts`.

## Task 2: Return the generated identity fingerprint

**Files:**

- Modify: `apps/server/src/hubConnector/HubConnector.ts`
- Modify: `apps/server/src/hubConnector/HubConnector.test.ts`
- Modify as required: HTTP boundary tests under `apps/server/src/hubConnector/`

1. Import and use `formatNodePublicKeyFingerprint()` from `@ryco/shared/nodeIdentity`.
2. Format only `started.publicKey.fingerprint`; never recompute from caller-controlled metadata.
3. Add the field to the exact result-key assertion.
4. Prove malformed internal fingerprint bytes fail through the existing bounded enrollment failure path.
5. Prove responses exclude raw public keys, protected-store references, polling secrets, origins, and paths.
6. Run the focused connector and HTTP tests with `bun run test`.

## Task 3: Render both CLI formats

**Files:**

- Modify: `apps/server/src/cli.ts`
- Modify: `apps/server/src/cli.test.ts`

1. Print `Fingerprint: SHA256:...` between device code and expiry in human output.
2. Preserve schema-validated JSON serialization with the identical `fingerprint` field.
3. Add human and JSON output assertions.
4. Verify no polling secret, raw key, origin, or path enters either output.
5. Run `bun run test apps/server/src/cli.test.ts`.

## Task 4: Document the verification step

**Files:**

- Modify: `docs/hub-connector.md`

1. Document both output modes and require exact fingerprint comparison before approval.
2. State that a mismatch must be denied and investigated.
3. Keep examples free of real origins, codes, keys, paths, and private infrastructure.

## Task 5: Validate and publish the public change

1. Run `bun fmt`.
2. Run `bun lint`.
3. Run `bun typecheck`.
4. Run `bun run typecheck:effect` because the Effect CLI and schema are changed.
5. Run all focused tests, then `bun run test`.
6. Run the relevant server build and release smoke if required by the changed package graph.
7. Audit the complete diff for private references, secrets, generated drift, and unrelated changes.
8. Confirm relay schemas and fixtures are unchanged.
9. Commit with clear conventional commits, push the branch, and open a public PR closing #174.
10. Wait for CI and review, address every actionable comment, rerun affected gates, and merge only when green.

## Task 6: Record downstream compatibility

1. Document that downstream consumers must pin an immutable reviewed public-main commit.
2. Require node and approval fingerprints to compare exactly before enrollment approval.
3. Keep downstream deployment identifiers, infrastructure, policy, and qualification records outside the public repository.
