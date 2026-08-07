# Independent Snow replay of Ryco E2EE fixtures

This test-only Rust crate replays the generated Ryco F6 IK and F7 NX handshake fixtures with
Snow, an implementation that shares no production code with Ryco. It consumes the fixture files
in `packages/shared/fixtures/e2ee/v1` directly; it does not copy their values and does not import
`relayE2ee` production modules.

The two tests independently construct `Noise_IK_25519_ChaChaPoly_SHA256` and
`Noise_NX_25519_ChaChaPoly_SHA256` from the generated prologue, test-only static keys, test-only
ephemeral keys, and handshake payloads. They assert:

- byte-exact Noise messages 1 and 2;
- payload recovery by the opposite Snow endpoint;
- the two endpoints' final SHA-256 Noise handshake hash against `noiseHandshakeHash`; and
- both raw Noise `Split()` outputs, which Ryco consumes as `epochSecretC2N` and
  `epochSecretN2C`.

Run it from this directory:

```sh
cargo test --locked
```

## Security and technical limits

Snow's deterministic ephemeral setter is a hidden method named
`fixed_ephemeral_key_for_testing_only`. Fixed ephemeral keys are unsafe outside reproducible test
vectors. The crate also enables Snow's `risky-raw-split` feature solely so tests can compare the
two `Split()` keys. That API deliberately exposes raw key material and must not be enabled by, or
copied into, production Ryco code.

Snow 0.9.6 cannot expose the final Noise chaining key through its documented API. Therefore this
harness cannot independently calculate Ryco's `exporterSecret`, which is a Ryco-specific
HKDF-Expand of that chaining key. It consequently does not validate `serverConfirmationKey`,
`serverConfirmation`, epoch rekeying, or record protection. Those are not standard Noise outputs;
testing them here would require a Snow fork, undocumented internal access, or a second custom
implementation and would weaken the harness's independence.

F6/F7's `noiseHandshakeHash` is standard Noise `h`. Their `sessionBindingHash` is a different Ryco
construction over canonical CBOR and exact hello/accept carrier bytes; the harness never equates the
two.

Snow validates the standard Noise state machine and primitives only. It does not parse Ryco's CBOR
hello/accept carriers, validate signatures or certificates, enforce authorization, or model relay
timeouts and downgrade policy. The harness intentionally feeds Snow the `noiseMessage1` and
`noiseMessage2` portions produced by the actual generated Ryco fixtures.

See [UPSTREAM.md](UPSTREAM.md) for the exact source and license provenance.
