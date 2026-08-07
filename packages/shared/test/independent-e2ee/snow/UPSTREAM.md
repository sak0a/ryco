# Snow upstream and license provenance

The harness pins the crates.io package `snow` at exactly version `0.9.6`; `Cargo.lock` pins its full
transitive dependency graph.

| Field               | Value                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Project             | Snow, a pure-Rust Noise Protocol Framework implementation                                                                                |
| Upstream repository | <https://github.com/mcginty/snow>                                                                                                        |
| Release tag         | `v0.9.6`                                                                                                                                 |
| Tag commit          | `a4be73faa042c5967f39662aa66919f774831a9a`                                                                                               |
| Crates.io archive   | <https://static.crates.io/crates/snow/snow-0.9.6.crate>                                                                                  |
| Archive SHA-256     | `850948bee068e713b8ab860fe1adc4d109676ab4c3b621fd8147f06b261f2f85`                                                                       |
| Declared license    | `Apache-2.0 OR MIT`                                                                                                                      |
| License texts       | [Apache-2.0](https://github.com/mcginty/snow/blob/v0.9.6/LICENSE-APACHE), [MIT](https://github.com/mcginty/snow/blob/v0.9.6/LICENSE-MIT) |

Snow is listed as a reference Rust implementation by the Noise project, and the generated Ryco F15
fixture provenance already records Snow's upstream vector corpus. This harness goes further than
transcoding that upstream corpus: it executes Snow against Ryco's own generated F6/F7 inputs.

The `risky-raw-split` feature and `fixed_ephemeral_key_for_testing_only` method are upstream Snow
test facilities. Their use is confined to this independent test crate; neither is evidence that raw
split extraction or fixed ephemeral keys are suitable for production.
