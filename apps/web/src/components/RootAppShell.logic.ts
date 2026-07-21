import type { PresentationTier } from "../lib/presentationTier";

/**
 * Whether the welcome payload's bootstrap thread should replace the logical
 * root route. Desktop keeps its last-thread redirect; the phone tier lands on
 * Home (the thread list) instead, which is the phone default surface after a
 * session is established.
 */
export function shouldApplyBootstrapThreadRedirect(input: {
  readonly pathname: string;
  readonly tier: PresentationTier;
}): boolean {
  return input.pathname === "/" && input.tier !== "phone";
}
