# Relay E2EE — §16.4 browser-suite coverage and what remains

`docs/relay-e2ee-protocol.md` §16.4 requires part of the §16.3 vector corpus to run in the web
browser test suite as well as under the repository's Node gate:

> Families exercising web-facing surfaces — F1, F2, F7, F8, F10, the admitted-pattern cases of F3,
> the `WebSAS` half of F14, the NX cases of F16, and the P-256 cases of F17 — MUST also run in the
> web browser test suite.

This note records exactly what runs in Chromium today, what does not, and why. It exists so any gap
is a tracked obligation rather than an omission somebody has to rediscover from the suite listing.

**Every family §16.4 names now runs in the browser suite.** The five that this note previously
carried as deferred — F1, F2, F8, F16's NX cases, and F17's P-256 cases — landed with the Phase 6
runtime-parity run. What remains is not a family: it is the corpus's own declaration of the run,
which still says the run does not exist. See “What remains” below.

## What runs in Chromium today

Every file is under `apps/web/src/components/hostedHub/` because
`apps/web/vitest.browser.config.ts` includes only `src/components/**/*.browser.tsx` — a browser
vector placed anywhere else silently matches nothing, and `vp test run` reports success over zero
matched files. A new vector file is only real once it appears by path in the run's own file list.

| Family                                   | Where                                                           | What it drives                                                                                                                                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 — payload discrimination and chunking | `E2eeCodecParity.browser.tsx`                                   | The §4.3 receive pipeline for all 12 cases carrying a wire payload, the §4.5 budget and both sides of the plaintext ceiling re-protected from the family's own §6.5 stand-in secrets, and the chunked reassembly. |
| F2 — carrier compatibility (§5.5, §5.6)  | `E2eeCodecParity.browser.tsx`                                   | C1 through the assembler in both prelude states; C6 parsed by **Chromium's own** `JSON.parse`, with and without the prelude; the maximum carrier re-prepared at the §5.5 advertisement floor.                     |
| F3 — admitted-pattern cases              | `E2eeNxHandshake.browser.tsx`                                   | The committed `["IK"]` statement evaluated as web, latched (`K2`/`P15`, buffered sends non-empty and none flushed) and unlatched (`K3`, labelled rule-level); `["IK","NX"]` as web (`K1`).                        |
| F7 — NX rules this tier reaches          | `E2eeMaliciousRelay.browser.tsx`                                | The responder-static substitution driven live against a real node half, and the nonempty message-1 payload refused by that node half.                                                                             |
| F8 — record protection (§9.1–§9.3)       | `E2eeRecordProtection.browser.tsx`                              | Every case, on a session established from the F6 trace's committed §6.5 outputs: both AADs and the nonce, both counter-zero-and-one traces re-protected byte for byte, and all six tampers through `unprotect`.   |
| F10 — the web mapping (§12.1.1)          | `E2eeNxHandshake.browser.tsx`, `E2eeMaliciousRelay.browser.tsx` | `K1`, `K2`, `K3`, `K5`, `K10`, `K11`, `K12`, `K13`, `K14`, `K15` and the `P16` accept rows, each with its §12.1.1 classification stated as an input.                                                              |
| F14 — the `WebSAS` half                  | `E2eeNxHandshake.browser.tsx`                                   | Every `web-sas-session-*` case re-derived in Chromium WebCrypto and byte-matched against the committed intermediates, plus §3.2.1 S11.                                                                            |
| F16 — the NX cases                       | `E2eeCodecParity.browser.tsx`                                   | The web/NX context block's §8.3 commitment and both absence forms against the IK arm; the absence-semantics violation as `P13`; and the NX channel that no §13.6 withdrawal matches, beside the sweep that does.  |
| F17 — the P-256 cases                    | `E2eeCodecParity.browser.tsx`                                   | All nine rejected §7.1 public-key encodings plus the valid control, and all seven rejected signature encodings verified against F04's committed transcript through `verifyE2eeSignature`.                         |

All of them read the committed fixtures in `packages/shared/fixtures/e2ee/v1/` directly, through the
one reader in `apps/web/test/e2eeCorpus.ts`. Nothing in `apps/web` regenerates or copies them, so
§16.4's "a vector that produces different bytes on any supported runtime is a release-blocking
defect" is checked against the corpus and not against a second copy of it.

`apps/web/test/e2eeCorpus.ts` also carries the §9 session harness. F8 is the only family here that
cannot be checked from bytes alone — every case is a record protected or authenticated by a session
that already holds epoch secrets — and that is the whole reason it was deferred. The harness builds
one from a family's own committed secrets; F1's two boundary cases reuse it unchanged, differing
only in which family's secrets they hand over.

**No cross-runtime byte divergence was found.** Every committed envelope, AAD, header, nonce,
context block, commitment, and reassembly this run drives reproduces in Chromium exactly as it does
under Node. §16.4 makes a divergence release-blocking; there is none to report.

**None of this adds a security property the web tier claims.** §2.2 and §2.3 deny that tier any
operator-proof protection: the Hub serves every byte of the JavaScript, so it can complete a genuine
handshake, draw a genuine §13.5 `WebSAS`, and exfiltrate the plaintext regardless of which vectors
pass in which runtime. These families are correctness parity and nothing more. Read as a security
claim they would say something false.

## What remains

**The corpus still declares the browser run as not existing, and that is now the whole gap.**
`packages/shared/fixtures/e2ee/v1/manifest.json` carries `crossRuntime.browserRun.state:
"not-wired"` with the reason "this repository has no browser test gate over `packages/shared`, so no
vector in these families has yet been run anywhere but Node", and each of the nine family files
repeats that sentence in its own `deferred` list.

That was already stale for F3, F7, F10, and F14 before this run — those landed in Phase 4 without
the declaration moving — and it is now stale for all nine. It is accurate about `packages/shared`,
which still has no browser gate; it is wrong about the vectors, which run in `apps/web`.

Correcting it is a `packages/shared` change with a wide blast radius: the manifest and every family
file are generator output, so the text moves through `scripts/generate-e2ee-fixtures.ts` and a
regeneration of all eighteen files, and `packages/shared/src/relayE2eeCorpus.test.ts` asserts the
current wording directly (`crossRuntime.browserRun.state` is compared against `"not-wired"`, and
every named family is required to repeat the declaration). It is deliberately not bundled with the
run it describes. **Until it lands, a reader who opens the fixtures — and not this note — will be
told the browser run does not exist.** That is the reason this section exists rather than a silence.

## The web §13 surfaces: what is wired, and what is still owed

The web tier runs a §4.4 machine on every relay socket, publishes what that machine locked
(`apps/web/src/hostedHub/e2eeSession.ts`), and all three hosted connection surfaces — the desktop
node menu, the phone connection sheet, and the pill — read it. §12.2's "MUST label the channel
**legacy** in every user-facing surface" is therefore met in shipped code, and the browser render
sweeps draw `Legacy`, `Unsigned web`, and `Securing` like every other bounded status
(`apps/web/test/hostedConnectionVocabulary.ts` carries the §4.4 dimension).

The two §13.5 duties this note previously recorded as owed are now discharged:

| Duty                             | Where it is discharged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §13.5 "Shown in the web UI"      | `HostedE2eeVerification.tsx`, mounted in the desktop node menu. The renderer returns the code, the format caption, and §13.5's advisory sentence as ONE value (`HostedE2eeVerification.logic.ts`), so a caller cannot draw the characters without the "cannot protect against the Hub operator, who serves that code" denial. A locked channel that reached the surface with no conforming code — the derivation is allowed to fail without costing the channel — draws the absence as a sentence rather than as nothing, so the display duty cannot fail open. |
| The relay trust notice's wording | `HostedRelayTrustNotice.logic.ts`. The claim is now a selector over the channel state, keyed on the tier-fenced `WebHostedE2eeChannelStatus`, so a new channel state cannot ship without a sentence. The `web-unsigned` copy states §2.3's web bullet and §2.4's served-code ceiling; the `legacy` copy is §12.2's mandatory label.                                                                                                                                                                                                                             |

The glyph and tone at all three connection surfaces now key on
`HostedConnectionStatusIndicator.guarantee` rather than on connectedness
(`HostedConnectionControls.logic.ts`). Both `legacy` and `web-unsigned` are usable sessions, so
keyed on `connected` they drew the identical green connected glyph — §2.2's "MUST NOT present a
stronger claim for a weaker configuration", arrived at through an icon.

**One §13.5 surface gap remains, and it is a scope ruling rather than an oversight.** The `WebSAS`
renders in the desktop node menu only. `AGENTS.md` freezes the `apps/web` phone tier — "Do not
extend the web phone tier" — and mounting a new block inside the phone connection sheet is a new
phone-tier surface. `apps/mobile` is the intended phone experience and ships the native §13 trust
surfaces. Unfreezing the web phone tier to add the `WebSAS` is a separate approved change.

**What makes the phone tier truthful is the copy, and that had to be fixed rather than asserted.**
This note previously claimed the phone tier "claims nothing the absent code would have qualified".
That was false as shipped: the `web-unsigned` disclosure told every reader on both tiers that a
malicious Hub "could serve code that … shows the same session code", which presupposes a comparison
value on the page. On the phone connection sheet there is none, so that sentence described a §13.5
affordance the reader did not have. The disclosure no longer refers to a session code in any state,
and `HostedRelayTrustNotice.logic.test.ts` scans all four bodies for the reference so it cannot come
back; the pointer at the ceremony now lives in `HostedE2eeVerification.logic.ts`, which renders only
where the characters do. Both tiers still carry the same state-keyed disclosure and the same
guarantee-keyed glyph, and the claim they carry is now one the phone tier can support.

## Still outstanding beyond this document

§16.4 also requires the COMPLETE corpus to pass on physical devices on both mobile platforms before
the native client ships E2EE support. That is a separate acceptance gate of the native rollout, is
not discharged by anything in this repository's automated suites, and is not what this note tracks.
