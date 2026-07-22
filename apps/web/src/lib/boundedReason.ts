/**
 * The single bound for operator-facing "why is this unavailable" text.
 *
 * Reasons reach the UI from mutation-capability resolution, so they are bounded
 * at the point of rendering rather than trusted to be short: nothing longer is
 * ever rendered, announced, or put in a `title`. This lives here because the
 * phone primitives, the traits controls, and the model picker all render the
 * same strings and must bound them identically.
 */
const MAX_DISABLED_REASON_LENGTH = 120;

export function boundedDisabledReason(reason: string): string {
  const collapsed = reason.replace(/\s+/gu, " ").trim();
  if (collapsed.length <= MAX_DISABLED_REASON_LENGTH) return collapsed;
  return `${collapsed.slice(0, MAX_DISABLED_REASON_LENGTH - 1)}…`;
}
