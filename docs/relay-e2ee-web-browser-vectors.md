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

The web tier runs a §4.4 machine on every relay socket, publishes what that machine locked
(`apps/web/src/hostedHub/e2eeSession.ts`), and all three hosted connection surfaces — the desktop
node menu, the phone connection sheet, and the pill — read it. §12.2's "MUST label the channel
**legacy** in every user-facing surface" is therefore met in shipped code, and the browser render
sweeps draw `Legacy`, `Unsigned web`, and `Securing` like every other bounded status
(`apps/web/test/hostedConnectionVocabulary.ts` carries the §4.4 dimension).

The two §13.5 duties this note previously recorded as owed are now discharged:

| Duty                             | Where it is discharged                                                                                                                                                                                                                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §13.5 "Shown in the web UI"      | `HostedE2eeVerification.tsx`, mounted in the desktop node menu. The renderer returns the code, the format caption, and §13.5's advisory sentence as ONE value (`HostedE2eeVerification.logic.ts`), so a caller cannot draw the characters without the "cannot protect against the Hub operator, who serves that code" denial. A locked channel that reached the surface with no conforming code — the derivation is allowed to fail without costing the channel — draws the absence as a sentence rather than as nothing, so the display duty cannot fail open. |
| The relay trust notice's wording | `HostedRelayTrustNotice.logic.ts`. The claim is now a selector over the channel state, keyed on the tier-fenced `WebHostedE2eeChannelStatus`, so a new channel state cannot ship without a sentence. The `web-unsigned` copy states §2.3's web bullet and §2.4's served-code ceiling; the `legacy` copy is §12.2's mandatory label. |

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
