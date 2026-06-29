/**
 * Wraps a real product screenshot in tasteful window chrome so captures look
 * intentional in a marketing context. Reusable across versions.
 */
import { cn } from "@/lib/cn";

export interface ScreenshotFrameProps {
  src: string;
  alt: string;
  /** Optional caption shown in the title bar. */
  title?: string;
  className?: string;
  imgClassName?: string;
  theme?: "light" | "dark";
  /** Hide the traffic-light chrome for a barer look. */
  chrome?: boolean;
  loading?: "eager" | "lazy";
  /**
   * Optional focus region (normalised 0–1) the frame can zoom into so the
   * interesting part of a busy screenshot reads at small sizes. `zoomed` toggles
   * between the full shot (false) and the magnified region (true), animated.
   */
  focus?: { x: number; y: number; zoom: number };
  zoomed?: boolean;
}

export function ScreenshotFrame({
  src,
  alt,
  title,
  className,
  imgClassName,
  theme = "light",
  chrome = true,
  loading = "lazy",
  focus,
  zoomed = false,
}: ScreenshotFrameProps) {
  const dark = theme === "dark";
  const scale = focus && zoomed ? focus.zoom : 1;
  return (
    <figure
      className={cn(
        "overflow-hidden rounded-xl border",
        dark ? "border-white/10 bg-[#0d0d10]" : "border-black/10 bg-white",
        className,
      )}
    >
      {chrome && (
        <div
          className={cn(
            "flex items-center gap-1.5 border-b px-3.5 py-2.5",
            dark ? "border-white/10 bg-[#141418]" : "border-black/[0.06] bg-[#f6f5f3]",
          )}
        >
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
          {title && (
            <span
              className={cn(
                "mx-auto -translate-x-3 truncate text-xs",
                dark ? "text-white/40" : "text-black/40",
              )}
            >
              {title}
            </span>
          )}
        </div>
      )}
      {/* wrapper clips the zoom so it never bleeds over the chrome bar */}
      <div className="overflow-hidden">
        <img
          src={src}
          alt={alt}
          loading={loading}
          draggable={false}
          className={cn("block w-full select-none", imgClassName)}
          style={
            focus
              ? {
                  transformOrigin: `${focus.x * 100}% ${focus.y * 100}%`,
                  transform: `scale(${scale})`,
                  transition: "transform 0.85s cubic-bezier(0.22, 1, 0.36, 1)",
                  willChange: "transform",
                }
              : undefined
          }
        />
      </div>
    </figure>
  );
}
