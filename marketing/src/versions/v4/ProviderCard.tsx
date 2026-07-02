/**
 * One provider tile — used both in the static reduced-motion grid and as a face
 * on the 3D agent deck. The `deck` variant trades the translucent fill for an
 * opaque one so cards never bleed through each other while orbiting.
 */
import { BrandIcon } from "@/assets/brands";
import { cn } from "@/lib/cn";
import type { Provider } from "@/data/content";
import { ACCENT } from "./theme";

export function ProviderCard({
  p,
  index,
  variant = "default",
}: {
  p: Provider;
  index: number;
  variant?: "default" | "deck";
}) {
  const deck = variant === "deck";
  return (
    <article
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-3xl border p-7 transition-colors duration-300 sm:p-8",
        deck
          ? "border-white/12 bg-[#0e0f13] shadow-[0_40px_120px_-50px_rgba(0,0,0,0.9)]"
          : "border-white/10 bg-white/[0.03] hover:border-white/20",
      )}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -right-16 -top-16 size-44 rounded-full blur-3xl transition-opacity duration-500",
          deck ? "opacity-60" : "opacity-0 group-hover:opacity-100",
        )}
        style={{ background: p.accent }}
      />
      {/* accent hairline along the top edge — reads as a lit card face on the deck */}
      {deck && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: `linear-gradient(90deg, transparent, ${p.accent}, transparent)` }}
        />
      )}
      <div className="relative flex items-center justify-between">
        <span
          className="grid size-14 place-items-center rounded-2xl border"
          style={{
            color: p.accent,
            borderColor: `${p.accent}40`,
            background: `${p.accent}12`,
          }}
        >
          <BrandIcon name={p.brand} className="size-7" />
        </span>
        <span className="font-['JetBrains_Mono'] text-sm tabular-nums text-white/25">
          {String(index + 1).padStart(2, "0")}
        </span>
      </div>

      <div className="relative mt-6 flex items-center gap-2.5">
        <h3 className="font-['Space_Grotesk'] text-2xl font-semibold tracking-[-0.01em] text-white">
          {p.name}
        </h3>
        {p.earlyAccess && (
          <span
            className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: ACCENT, borderColor: `${ACCENT}55`, background: `${ACCENT}14` }}
          >
            Early access
          </span>
        )}
      </div>
      <p className="relative mt-1 font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-white/55">
        {p.vendor} · {p.blurb}
      </p>
      <p className="relative mt-5 text-[15px] leading-relaxed text-white/65">{p.detail}</p>
    </article>
  );
}
