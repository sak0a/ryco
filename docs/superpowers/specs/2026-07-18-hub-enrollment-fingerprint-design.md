# Hub enrollment fingerprint CLI design

## Problem

The outbound Hub connector creates an Ed25519 identity locally and sends its public descriptor during device-code enrollment. The Hub approval surface displays the resulting canonical public-key fingerprint, but `ryco hub enroll` currently prints only the device code and expiry. An operator therefore cannot independently compare the node-side fingerprint before approval.

## Scope

Expose the already-computed public verification fingerprint in the bounded local enrollment result and in both CLI presentations. This change is public connector behavior. It does not alter relay schemas, relay fixtures, protocol versions, Hub authorization policy, or key custody.

## Contract

`HubEnrollmentStartResult` gains one required field:

```ts
fingerprint: `SHA256:${string}`;
```

The runtime schema accepts only `SHA256:` followed by exactly 43 base64url characters, which is the unpadded encoding of a 32-byte SHA-256 digest. The connector formats the fingerprint with the existing `formatNodePublicKeyFingerprint()` helper so node and approval surfaces use the same canonical representation.

The result continues to contain only bounded public enrollment metadata: connector status, device code, expiry, poll interval, and fingerprint. It must not contain the raw public key, private key, protected-store reference, polling secret, Hub origin, local path, or internal error text.

## Data flow

1. The node identity runtime generates the Ed25519 key and computes its fingerprint before sending the public enrollment descriptor.
2. The enrollment client returns the existing `StartedHubEnrollment.publicKey.fingerprint` bytes to the connector.
3. `HubConnector.enroll()` converts those bytes to canonical display form and includes the string in `HubEnrollmentStartResult`.
4. The authenticated loopback enrollment route returns the schema-validated result.
5. `ryco hub enroll` prints `Fingerprint: SHA256:...`; `--json` emits the identical value in `fingerprint`.
6. The operator compares that value with the Hub approval screen before approving or denying the request.

## Failure and security behavior

Fingerprint formatting is deterministic and validates the required 32-byte digest. An invalid internal value follows the existing bounded enrollment failure path; the CLI must not fall back to a different representation or omit the field. Enrollment remains pending until explicit approval, and denial, expiry, cancellation, protected-store custody, and polling behavior are unchanged.

Device codes remain intentional short-lived CLI output. Polling secrets and private keys never enter the response, CLI output, logs, URLs, diagnostics, or persisted public metadata. The fingerprint is public verification metadata but remains subject to existing logging and diagnostic redaction policy.

## Alternatives

- Reading `hub-identity.json` from the CLI was rejected because it bypasses the authenticated local server boundary and introduces state races.
- Returning the raw public key was rejected because it exposes unnecessary data and gives operators a non-canonical value to compare.
- Adding a CLI-only side channel was rejected because human and machine consumers should share one strict result contract.

## Verification

- Contract tests accept the canonical fingerprint and reject wrong prefixes, padding, alphabets, or lengths.
- Connector tests prove the returned fingerprint comes from the generated enrollment identity and that the exact result keys remain bounded.
- HTTP and CLI tests prove schema validation across the authenticated loopback boundary.
- Human CLI tests assert the fingerprint line; JSON tests assert the identical field.
- Security tests continue proving polling secrets, protected-store references, raw keys, origins, and paths are absent.
- Public formatting, lint, type checking, Effect checking, focused tests, full `bun run test`, hosted-client build where dependency consumption is affected, and CI must pass.

## Rollout

Land the change in a dedicated public pull request. Downstream consumers may advance only to an immutable reviewed commit reachable from public `main`. Operators must upgrade the node CLI before relying on fingerprint comparison; no compatibility downgrade or relay protocol change is permitted.
