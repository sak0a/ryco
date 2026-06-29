/**
 * The one button primitive for v4. A lime "primary" or a glassy "ghost", both
 * with a light sheen that sweeps across on hover, a subtle press, and optional
 * magnetic pull (handled by `useMagnetic` via the `data-magnetic` hook in the
 * page). Children carry their own icons so callers keep the arrow-nudge idiom.
 */
import { cn } from "@/lib/cn";
import { ACCENT, focusRing } from "./theme";

export function MagneticButton({
  href,
  variant = "primary",
  external = false,
  magnetic = true,
  size = "lg",
  className,
  ariaLabel,
  children,
}: {
  href: string;
  variant?: "primary" | "ghost";
  external?: boolean;
  magnetic?: boolean;
  size?: "lg" | "sm";
  className?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  const primary = variant === "primary";
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      {...(magnetic ? { "data-magnetic": "" } : {})}
      aria-label={ariaLabel}
      className={cn(
        "group/btn relative inline-flex items-center justify-center overflow-hidden font-semibold transition-[filter,background-color,border-color] duration-300",
        size === "lg" ? "rounded-xl px-6 py-3 text-[15px]" : "rounded-full px-3.5 py-2 text-sm",
        primary
          ? "text-[#0a0b0d] hover:brightness-[1.04]"
          : "border border-white/15 bg-white/[0.03] text-white hover:border-white/30 hover:bg-white/[0.06]",
        focusRing,
        className,
      )}
      style={primary ? { background: ACCENT, boxShadow: `0 18px 50px -26px ${ACCENT}` } : undefined}
    >
      {/* sheen sweep */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 -translate-x-[260%] bg-gradient-to-r from-transparent to-transparent transition-transform duration-700 ease-out group-hover/btn:translate-x-[460%]",
          primary ? "via-white/45" : "via-white/12",
        )}
      />
      <span className="relative z-10 inline-flex items-center gap-2 transition-transform duration-200 group-active/btn:scale-[0.96]">
        {children}
      </span>
    </a>
  );
}
