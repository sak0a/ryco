// The hosted relay trust disclosure, as a FUNCTION OF THE CHANNEL STATE.
//
// It used to be one exported constant — "Hosted connections use WSS transport
// security, but they are not application-level end-to-end encrypted" — rendered
// unconditionally at five mount sites. That sentence was true of every web
// channel until this tier ran a §4 handshake. It is now false of a locked one,
// and a false sentence about confidentiality is the §2.2 defect read backwards:
// a surface that cannot change its claim cannot make an honest one either.
//
// SO THE CLAIM IS A SELECTOR, NOT A STRING, and this is a `.logic.ts` sibling
// for the reason `AccountSettings.logic.ts` is: a decision whose failure mode is
// security-relevant rather than cosmetic belongs somewhere a node test can reach
// it without a DOM. The five mount sites consume the selector through the
// component, which reads the live §13 projection itself, so there is no code
// path left that renders a claim the channel has outgrown.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS COPY MAY NOT SAY
// ─────────────────────────────────────────────────────────────────────────────
// Every sentence below is a security claim, and `docs/relay-e2ee-protocol.md`
// bounds all of them:
//
// 1. **No stronger claim for a weaker configuration** (§2.2, §12.2). The
//    fallback state is called legacy and carries no E2EE or active-Hub wording;
//    the NX state is never spelled the way the signed native tier is.
// 2. **The web ceiling is stated, not implied** (§2.4). "The served web client
//    is never operator-proof … A malicious Hub may serve code that completes the
//    genuine node handshake, displays the genuine session `WebSAS`, and
//    separately exfiltrates plaintext or traffic keys." The `web-unsigned` copy
//    says exactly that, in those terms.
// 3. **The latch is described as what it is** (§2.3, §17.5). "The web disclosure
//    text MUST state the web bullet above. It MUST NOT describe the web latch as
//    durable, cross-session, or Hub-resistant" — and §17.5 adds that the web
//    latch and the durable native latch "MUST NOT be described in the same
//    terms". The copy says the opposite of durable, because that is what is true.
//
// `HostedRelayTrustNotice.logic.test.ts` scans every string here for the phrases
// those rules forbid. The scan is a bare substring match and therefore cannot
// tell a claim from its negation, so this module does not use the banned words
// at all — including in the negative. "Never operator-proof" is written as
// "cannot protect against the Hub operator", which is §13.5's own phrasing and
// carries no token a future edit could strand in the affirmative.

import type { WebHostedE2eeChannelStatus } from "../../hostedHub/connectionStatus";

/**
 * How loudly the notice presents itself — colour only, never the claim.
 *
 * `caution` is for every state whose payload the Hub can read: no channel yet,
 * a channel still negotiating, and §12.2's fallback. `advisory` is for the one
 * state that encrypted something, and it is deliberately NOT a success tone:
 * §2.2's *Web, unsigned ephemeral* row is a usable channel with a ceiling, and
 * dressing it in the colour the native verified row gets would be the overclaim
 * §2.2 forbids arrived at through styling instead of through words.
 */
export type HostedRelayTrustTone = "caution" | "advisory";

export interface HostedRelayTrustDisclosure {
  readonly tone: HostedRelayTrustTone;
  /**
   * The whole claim, as ONE string.
   *
   * Not a headline plus a body: the §2.4 ceiling and the §2.3 latch bullet are
   * the parts a reader skips, and a two-field shape is an invitation to render
   * only the first one.
   */
  readonly body: string;
}

/**
 * One disclosure per channel state this tier can be in.
 *
 * Keyed on `WebHostedE2eeChannelStatus` — the tier-fenced union — so the two
 * native rows are unrepresentable here rather than merely unwritten. That fence
 * is `Exclude<HostedE2eeChannelStatus, "verified" | "unverified">`, so a member
 * added to the shared union lands in this `Record`'s key set automatically and
 * the repository stops compiling until someone writes it a sentence. The test
 * walks `HOSTED_E2EE_CHANNEL_STATUSES` and asserts the same thing at runtime,
 * so the guarantee does not depend on anyone reading this comment.
 */
const HOSTED_RELAY_TRUST_DISCLOSURES = {
  /**
   * No §4 channel in this tier, or none open yet — the sign-in surface, the node
   * directory, and the install instructions. It claims nothing about E2EE in
   * either direction, and keeps the relay-trust statement that was always true
   * of a hosted connection with no channel behind it.
   */
  unavailable: {
    tone: "caution",
    body: "Hosted connections reach your nodes through the Ryco Hub over WSS. No node channel is open in this tab, so the Hub still forwards what you send in a form it can read, and it is expected not to log or keep it.",
  },
  /** §4.4 `negotiating`: nothing is locked and nothing has been released. */
  negotiating: {
    tone: "caution",
    body: "This tab is still agreeing a channel with your node and has released nothing to it yet. Until that settles, treat this connection as one the Hub can read.",
  },
  /**
   * §2.2's *Web, unsigned ephemeral* row. The two MUSTs that shape it are §2.4's
   * ceiling — the Hub serves the code, so a genuine handshake and a genuine
   * §13.5 code are compatible with wholesale exfiltration — and §2.3's web
   * bullet, which is stated as the in-memory, per-tab, worth-nothing-against-the-
   * Hub thing it is. The last sentence is §2.3's own: "Only node-enforced
   * effective `requireE2EE` closes the plaintext path for web."
   */
  "web-unsigned": {
    tone: "advisory",
    body: "This tab and your node agreed a browser channel, so while the code this page is running is honest the Hub relays ciphertext instead of readable payload. It is weaker than the channel the Ryco mobile app gets, and it cannot protect against the Hub operator, who serves every byte of this page's JavaScript and could serve code that completes the same handshake, shows the same session code, and copies your data anyway. Its downgrade check is held in memory only — empty again in every new tab and after every reload, and worth nothing against that operator. Only your node can close the plaintext path for browsers.",
  },
  /**
   * §12.2's mandatory label. It names the fallback and makes no confidentiality
   * claim at all — and it does not name a cause, because this client cannot tell
   * one: §12.2 covers both "a missing or stripped advertisement" and an
   * advertisement "the node itself could not emit".
   */
  legacy: {
    tone: "caution",
    body: "This channel fell back to legacy plaintext. This tab cannot tell whether your node offered no encrypted channel or something on the path removed the offer, so treat everything sent over it as readable by the Hub, which is expected not to log or keep it. Only your node can refuse plaintext for browsers.",
  },
} as const satisfies Record<WebHostedE2eeChannelStatus, HostedRelayTrustDisclosure>;

/** The claim this tier is entitled to make about the channel it is on. */
export function hostedRelayTrustDisclosure(
  status: WebHostedE2eeChannelStatus,
): HostedRelayTrustDisclosure {
  return HOSTED_RELAY_TRUST_DISCLOSURES[status];
}

/** Every disclosure, for the scan that reads them all. */
export const HOSTED_RELAY_TRUST_DISCLOSURE_STATES = Object.keys(
  HOSTED_RELAY_TRUST_DISCLOSURES,
) as ReadonlyArray<WebHostedE2eeChannelStatus>;
