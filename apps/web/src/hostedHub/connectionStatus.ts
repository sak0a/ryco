import {
  deriveHostedConnectionStatusIndicator as deriveSharedIndicator,
  deriveHostedConnectionStatusText as deriveSharedText,
  type HostedConnectionStatusIndicator,
  type HostedConnectionStatusInput,
  type HostedConnectionStatusText,
  type HostedE2eeChannelStatus,
} from "@ryco/client-runtime/authorization";

export * from "@ryco/client-runtime/authorization";

/**
 * The §4.4 channel states THIS TIER MAY REPORT, and the reason this module is
 * more than a re-export.
 *
 * `HostedE2eeChannelStatus` is one union shared by two tiers with no
 * discriminant, and two of its members are native-only by construction:
 * `verified` means both halves of `docs/relay-e2ee-protocol.md` §2.2's bottom
 * row — a locked `e2ee` channel AND a pin the owner verified (§13.1) — and
 * `unverified` means §13.1's release-gated pairing channel. Web holds no durable
 * pin of any kind (§6.3, §13.1), so it can be in neither state, and reporting
 * either would render the native rows verbatim from a client whose JavaScript
 * the Hub serves — the one outcome §2.2, §2.3, and §2.4 forbid.
 *
 * Nothing in the shared union, the shared derivation, or a pure suite stops a
 * caller from passing one: they are string literals in an optional field. So the
 * fence is HERE, at the tier boundary, where the tier is known. Every apps/web
 * call site reaches the derivation through this module (`types.ts` re-exports
 * this file for the same reason), and through it `e2eeStatus: "verified"` is a
 * compile error rather than a review question — which is what the exhaustive
 * `Record`s in `connectionStatus.ts` do for every other decision in that file.
 */
export type WebHostedE2eeChannelStatus = Exclude<
  HostedE2eeChannelStatus,
  "verified" | "unverified"
>;

/** The shared input with the §4.4 dimension narrowed to this tier's states. */
export interface WebHostedConnectionStatusInput extends Omit<
  HostedConnectionStatusInput,
  "e2eeStatus"
> {
  readonly e2eeStatus?: WebHostedE2eeChannelStatus;
}

/**
 * The shared derivation, callable only with a channel state this tier can be in.
 *
 * Runtime behavior is the shared function's, unchanged and unwrapped in every
 * other respect: a narrowing that also rewrote or dropped a member would be a
 * second opinion about the property §2.2 forbids overstating, and the two would
 * disagree the first time one of them was extended.
 */
export function deriveHostedConnectionStatusText(
  input: WebHostedConnectionStatusInput,
): HostedConnectionStatusText {
  return deriveSharedText(input);
}

/** The collapsed indicator, fenced to this tier's channel states in the same way. */
export function deriveHostedConnectionStatusIndicator(
  input: WebHostedConnectionStatusInput,
): HostedConnectionStatusIndicator {
  return deriveSharedIndicator(input);
}
