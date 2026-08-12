import { RycoLetterMark } from "../../RycoLetterMark";
import { HUB_WORDMARK } from "../../../hubBranding";
import { cn } from "~/lib/utils";

/**
 * The Hub's brand lockup: the real Ryco letter-mark beside the Hub wordmark.
 *
 * Replaces the generic `ShieldCheckIcon` in a bordered square that stood in for
 * a logo, and the uppercase eyebrow that rendered the desktop client's name and
 * release channel ("Ryco (Beta) Hub"). See `hubBranding.ts`.
 *
 * The mark is `aria-hidden` inside `RycoLetterMark`, so the accessible name
 * comes from the wordmark text alone — one name, not two.
 */
export function HubWordmark({
  className,
  size = "default",
}: {
  readonly className?: string;
  /** `lg` is the gateway's masthead; `default` is the signed-in top bar. */
  readonly size?: "default" | "lg";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center font-semibold text-foreground",
        size === "lg" ? "gap-2.5 text-lg" : "gap-2 text-sm",
        className,
      )}
    >
      <RycoLetterMark className={size === "lg" ? "h-6" : "h-4.5"} />
      {HUB_WORDMARK}
    </span>
  );
}
