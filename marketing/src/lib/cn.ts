/** Tiny classnames joiner — no dependency needed for a marketing site. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
