# Node identity primitives

Ryco provides reusable primitives for a node to create and protect a local signing identity,
enroll that public identity with an HTTPS service, prove possession of its private key, and rotate
the key safely. These modules do not implement an outbound connector, relay channel bridge,
account policy, grants, or service-side administration.

## Cryptography and identifiers

The initial signing algorithm is Ed25519. Public keys are raw 32-byte values and signatures are 64
bytes. Node and environment identifiers are random rather than key-derived, so rotation does not
change either identity.

The node public-key fingerprint is:

```text
SHA-256(canonical-CBOR([
  "ryco.node-key.v1",
  algorithm,
  publicKeyBytes
]))
```

It is displayed as `SHA256:` followed by unpadded Base64URL. A service must derive the fingerprint
from the submitted public key rather than accepting a caller-supplied fingerprint.

`@ryco/shared/nodeIdentity` validates key formats, calculates fingerprints, encodes signed
transcripts, and compares fixed cryptographic values. Validation errors are bounded and never
reflect caller material.

## Signed authentication transcript

An HTTPS preflight returns a fresh 32-byte challenge. The node signs the deterministic CBOR encoding
of this exact array:

```text
[
  "ryco.node-auth.proof.v1",
  canonicalHubOrigin,
  protocolMajor,
  protocolMinor,
  nodeId,
  activeKeyId,
  challengeExpiresAtUnixMs,
  challengeBytes
]
```

The resulting challenge and signature populate the existing relay node-authentication frame's
`nonce` and `signature` fields. This does not change the relay frame schema or protocol version.
The challenge is kept only in memory by the node. The service is responsible for digest-only
storage, expiry, and atomic single-use claim.

The canonical origin is an exact HTTPS origin with no credentials, path, query, fragment, or
trailing slash. Loopback HTTP origins are accepted for local development only.

## Protected key storage

`NodeSigningIdentity` exposes generation, public descriptor lookup, signing, and deletion. It has
no private-key export method. Private keys are PKCS#8 DER inside the implementation and are cleared
from temporary byte buffers after import or storage.

The protected-store adapters use:

- Bun's native secrets API when the process runs under Bun;
- `@github/keytar` for the packaged Node CLI, backed by macOS Keychain, Linux Secret Service, or
  Windows Credential Vault;
- an explicitly enabled permissioned-file fallback on POSIX systems.

The file fallback is never automatic. Its directory is owned by the effective user with mode
`0700`; each regular, non-symlinked, single-link key file is mode `0600`. Creation is exclusive,
fsynced, and installed without replacing an existing key. An interrupted install's matching
temporary hard link is removed on the next access before the link count is enforced. Every read
revalidates type, ownership, link count, mode, and size. Windows fails closed when its OS credential
store is unavailable rather than offering a file fallback without a verified restrictive DACL.

OS credential APIs do not expose a portable atomic create-if-absent primitive. The adapters
serialize same-process creates, and identity generation is additionally serialized by the local
identity writer lock. Deployments must run only one Ryco process against a local identity state;
competing processes are rejected by that lock rather than racing key creation.

A missing, locked, unavailable, or corrupt protected store fails closed. An enrolled node never
silently generates a replacement key. Protected-store material is machine/user scoped and is not a
portable backup. Recovery must be an explicit service-owner procedure. Deletion cannot guarantee
erasure from external system backups.

Private keys must never enter command-line arguments, environment exports, settings, diagnostics,
logs, analytics, traces, crash reports, or network requests.

## Local identity state

The local identity state contains only:

- a stable random `EnvironmentId`;
- non-bearer node and key identifiers;
- protected-store entry names;
- bounded enrollment and rotation timestamps.

Polling secrets remain in the protected store, and challenges and signatures are never persisted.
The JSON state file is bounded, validated on every read, written through a fsynced atomic rename,
and guarded by an exclusive local writer lock. A corrupt, symlinked, hard-linked, oversized, or
insecurely permissioned state file fails closed. A lock owned by a live process is never reclaimed;
a well-formed lock whose recorded PID no longer exists is reclaimed after its inode is rechecked.

## Enrollment client

The enrollment client:

1. Creates the Ed25519 key and EnvironmentId locally.
2. Sends only the public key and bounded node metadata.
3. Receives a short human device code and an independent 32-byte polling secret.
4. Stores only a protected-store reference in local JSON.
5. Polls no faster than the server-provided bounded interval, for at most 120 attempts.
6. Persists the approved NodeId, active key ID, and retryable cleanup reference before deleting the
   polling secret.

Raw enrollment values are returned only from the start call. Local `cancel()` deletes pending key
and polling custody; it deliberately does not create an unauthenticated server-side cancellation
path. Server cancellation remains an authenticated administration operation.

If the first approved poll response is lost, the protected polling secret and pending local state
allow the same ceremony to resume. If local approval processing commits but the caller loses the
result, subsequent polling returns the persisted active identity without another network request.

Native HTTPS transports omit ambient credentials, disable caching and redirects, send bounded JSON,
enforce a 15-second request/read deadline, and reject oversized or malformed responses. A 404/410
poll response is terminal only when it contains the enrollment protocol's bounded unavailable
marker. They do not create or operate a browser registration flow.

## Rotation client

Rotation creates a second protected Ed25519 key while retaining the old active key. The old key
signs this deterministic CBOR transcript:

```text
[
  "ryco.node-key-rotation.proof.v1",
  canonicalHubOrigin,
  protocolMajor,
  protocolMinor,
  rotationRequestId,
  nodeId,
  oldActiveKeyId,
  newKeyId,
  newAlgorithm,
  newPublicKeyBytes,
  newFingerprintBytes,
  challengeExpiresAtUnixMs,
  challengeBytes
]
```

The staged key remains separate until the service reports owner-approved activation. After
activation the authentication selector tries the new key. The old key is deleted only after a
successful authentication with the new key. Rejected rotation deletes the staged key and retains
the old key. A lost proof response is resumed through the persisted non-bearer rotation request ID;
if proof was not committed, the client obtains a fresh challenge rather than persisting the old one.
The proof request returns the in-memory challenge alongside the signature so the service can match
only a stored digest and reconstruct the transcript without persisting raw challenge material.

## Canonical fixtures

Deterministic test-only Ed25519 fixtures are generated by:

```bash
bun run generate:node-identity-fixtures
```

The checked-in manifest is
[`packages/shared/fixtures/node-identity/v1/manifest.json`](../packages/shared/fixtures/node-identity/v1/manifest.json).
It records public key, fingerprint, exact CBOR transcript, transcript SHA-256, and signature for
authentication and rotation. The fixture key is public test material and must never be used for a
real node.

Changing identity domains or transcript fields requires regenerating the fixture, reviewing every
manifest change, and updating all consumers to an immutable reviewed Ryco commit. Relay fixtures
remain canonical and unchanged.
