# Relay E2EE — §16.4 browser-suite coverage and what is deferred

`docs/relay-e2ee-protocol.md` §16.4 requires part of the §16.3 vector corpus to run in the web
browser test suite as well as under the repository's Node gate:

> Families exercising web-facing surfaces — F1, F2, F7, F8, F10, the admitted-pattern cases of F3,
> the `WebSAS` half of F14, the NX cases of F16, and the P-256 cases of F17 — MUST also run in the
> web browser test suite.

This note records exactly which of those run in Chromium today, which do not, and why. It exists so
the gap is a tracked obligation rather than an omission somebody has to rediscover from the suite
listing.

## What runs in Chromium today

Both files are under `apps/web/src/components/hostedHub/` because
`apps/web/vitest.browser.config.ts` includes only `src/components/**/*.browser.tsx` — a browser
vector placed anywhere else silently matches nothing, and `vp test run` reports success over zero
matched files.

| Family                          | Where                            | What it drives                                                                                                                                                                             |
| ------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F3 — admitted-pattern cases     | `E2eeNxHandshake.browser.tsx`    | The committed `["IK"]` statement evaluated as web, latched (`K2`/`P15`, buffered sends non-empty and none flushed) and unlatched (`K3`, labelled rule-level); `["IK","NX"]` as web (`K1`). |
| F7 — NX rules this tier reaches | `E2eeMaliciousRelay.browser.tsx` | The responder-static substitution driven live against a real node half, and the nonempty message-1 payload refused by that node half.                                                      |
| F10 — the web mapping (§12.1.1) | both files                       | `K1`, `K2`, `K3`, `K5`, `K10`, `K11`, `K12`, `K13`, `K14`, `K15` and the `P16` accept rows, each with its §12.1.1 classification stated as an input.                                       |
| F14 — the `WebSAS` half         | `E2eeNxHandshake.browser.tsx`    | Every `web-sas-session-*` case re-derived in Chromium WebCrypto and byte-matched against the committed intermediates, plus §3.2.1 S11.                                                     |

All of them read the committed fixtures in `packages/shared/fixtures/e2ee/v1/` directly. Nothing in
`apps/web` regenerates or copies them, so §16.4's "a vector that produces different bytes on any
supported runtime is a release-blocking defect" is checked against the corpus and not against a
second copy of it.

## What is deferred, and to when

**Deferred to Phase 6.** These are the RUNTIME-PARITY families: they assert that shared code
produces identical bytes under Chromium, and none of them is specific to the web tier's own rows.
They are already green under the Node gate in `packages/shared/src/relayE2eeCorpus.test.ts`.

| Family | Title                                     | Why it is not here yet                                                                                                                                                                                           |
| ------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1     | Payload discrimination and chunk pipeline | Pure shared-codec parity. No web-tier decision depends on it that F10 does not already drive in the browser.                                                                                                     |
| F2     | Carrier compatibility (§5.5, §5.6)        | Pure shared-codec parity, and its interesting half is the node's advertisement sizing, which does not run in a browser at all.                                                                                   |
| F8     | Record protection (§9.1–§9.3)             | Requires an established session per case; the browser file that establishes one lands with the Phase 6 record-layer parity run.                                                                                  |
| F17    | Key-material validation — the P-256 cases | P-256 is the NATIVE tier's client identity key (§8.1). The web tier carries no client identity at all, so nothing in `apps/web` reaches these paths; they are parity checks on `@noble/curves` under Chromium.   |
| F16    | Authorization context — the NX cases      | Not named in the ruling that scoped this slice, and recorded here rather than dropped. §8.3's NX arm has no Branch A record and no admitted-authority snapshot, so what a browser run would add is codec parity. |

**None of these deferrals weakens a claim this tier makes.** §2.2 and §2.3 already deny the web
tier any operator-proof protection: the Hub serves every byte of the JavaScript, so it can complete a
genuine handshake, draw a genuine §13.5 `WebSAS`, and exfiltrate the plaintext regardless of which
vectors pass in which runtime. The families above are correctness parity, and the correctness they
pin is already gated under Node.

## The web §13 surfaces: what is wired, and what is still owed

The web tier now runs a §4.4 machine on every relay socket, publishes what that machine locked
(`apps/web/src/hostedHub/e2eeSession.ts`), and all three hosted connection surfaces — the desktop
node menu, the phone connection sheet, and the pill — read it. §12.2's "MUST label the channel
**legacy** in every user-facing surface" is therefore met in shipped code, and the browser render
sweeps draw `Legacy`, `Unsigned web`, and `Securing` like every other bounded status
(`apps/web/test/hostedConnectionVocabulary.ts` carries the §4.4 dimension).

Two §13.5 duties are **not** discharged and are owed to the copy slice that follows:

| Owed                             | What is missing                                                                                                                                                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §13.5 "Shown in the web UI"      | The `WebSAS` is derived client-side and held in the §13 projection, and nothing renders it. Until it is drawn — with §13.5's advisory-only disclosure text beside it, which MUST say the comparison cannot protect against the Hub operator — the owner has no string to compare against the node CLI's.      |
| The relay trust notice's wording | `HOSTED_RELAY_TRUST_DISCLOSURE` is channel-independent and says the same thing whether the channel locked `e2ee` or `legacy`. Its "not application-level end-to-end encrypted / the trusted relay can observe forwarded bytes" sentence is stale for a `web-unsigned` channel and is an UNDERSTATEMENT there. |

The second is deliberately left understated rather than rewritten in passing. §2.2 and §2.3 forbid
this tier from presenting a stronger claim for a weaker configuration, and a notice that starts
describing NX protection is exactly where that rule is violated by accident; the replacement text is
security copy and belongs with the `WebSAS` surface that has to state the same caveat.

## Still outstanding beyond this document

§16.4 also requires the COMPLETE corpus to pass on physical devices on both mobile platforms before
the native client ships E2EE support. That is a separate acceptance gate of the native rollout, is
not discharged by anything in this repository's automated suites, and is not what this note tracks.
