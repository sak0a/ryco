# Relay protocol v1 fixtures

This directory is the canonical compatibility corpus for the Ryco relay protocol. The public Ryco
repository owns these files. Relay implementations consume them directly from an immutable Ryco
version or commit and must not maintain divergent copies.

Each `.cbor` file is exactly one WebSocket binary-message payload using the deterministic CBOR
profile documented in [`docs/relay-protocol.md`](../../../../../docs/relay-protocol.md). The
manifest records the purpose, encoded byte length, SHA-256 digest, and expected decoded value or
stable error code. Manifest byte strings use lowercase hexadecimal in a `{ "$bytes": "..." }`
object.

## Regenerating fixtures

After an intentional protocol change, run from the repository root:

```sh
bun run generate:relay-fixtures
bun run test
```

Generation uses fixed inputs, sorted paths, deterministic CBOR, stable JSON formatting, and no
timestamps or randomness. Tests generate the complete corpus in memory and compare it byte for
byte with the committed files. They never update fixtures automatically.

Review every manifest digest and binary change before committing. Compatible minor versions may
add optional fields or fields that become required only after both peers negotiate that minor.
Breaking meaning or an incompatible frame class requires a new protocol major and a new fixture
directory.

Consumers must verify the pinned Ryco version or commit and the manifest digests. Copying these
files into another repository without immutable provenance and integrity verification is not a
supported consumption model.
