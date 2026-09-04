import type { E2eeChannelClaim } from "./e2eeTrustUiModel";

/**
 * The SF Symbol names the §13 trust surfaces render, and nothing else.
 *
 * ITS OWN MODULE, WITH NO RUNTIME IMPORTS, because of what has to be able to
 * read it. `AppSymbol` resolves an unmapped SF name to nothing at all on Android
 * — no glyph, no error — so the acknowledgement checkbox the §13.2 step 5 action
 * is gated on can silently disappear on one platform. The only way to catch that
 * is to assert these names against `AppSymbol.tsx`'s Android table, and the test
 * that does it can load neither a `.tsx` (react-native ships untranspiled Flow)
 * nor the model (which reaches the secure store). The claim type is imported for
 * types only, so nothing follows it at runtime.
 */
export const E2EE_TRUST_SYMBOLS = [
  "lock",
  "lock.open",
  "checkmark.shield",
  "exclamationmark.triangle",
  "checkmark.circle",
  "questionmark.circle",
] as const;

/** One glyph per claim, chosen from the same value the label is. */
export const CLAIM_SYMBOLS: Record<E2eeChannelClaim, (typeof E2EE_TRUST_SYMBOLS)[number]> = {
  verified: "checkmark.shield",
  "account-trusted": "lock",
  "pairing-only": "exclamationmark.triangle",
  legacy: "lock.open",
  "legacy-no-custody": "lock.open",
  none: "lock",
};

/** The §13.2 step 4 acknowledgement checkbox's two states. */
export const E2EE_ACKNOWLEDGEMENT_SYMBOLS = {
  checked: "checkmark.circle",
  unchecked: "questionmark.circle",
} as const satisfies Record<"checked" | "unchecked", (typeof E2EE_TRUST_SYMBOLS)[number]>;
