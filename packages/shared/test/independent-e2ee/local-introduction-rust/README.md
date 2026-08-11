# Independent Local Trusted Introduction verifier

This isolated Rust test reads `fixtures/e2ee/local-introduction/v1/valid.json` directly and
verifies it without importing any Ryco TypeScript implementation. It includes a deliberately
small canonical-CBOR decoder/encoder for the transcript value types, then independently checks:

- the exact 24-member request and 14-member approval transcripts;
- canonical byte-for-byte CBOR re-encoding;
- the domain-separated request digest and all three key fingerprints;
- the fixed-width P-256 request signature; and
- the Ed25519 node approval signature.

Run it from this directory with `cargo test --locked`. The crate is test-only. Its dependency
versions and complete transitive graph are pinned by `Cargo.lock` for the repository's Rust 1.68
toolchain.
