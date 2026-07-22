import { cn } from "~/lib/utils";
import { GLASS_SURFACE_TIERS, type GlassSurfaceTier } from "~/themes/appearancePreferences";

/**
 * The phone material system's tier selector.
 *
 * A **tier** says where a surface sits in the elevation model; the active
 * **Material step** — the existing `surfaceTransparency` preference, whose
 * phone control exposes Solid / Standard / Glass — decides how that tier
 * guarantees contrast:
 *
 * - `Solid` is opaque with no blur.
 * - `Standard` is a single layer at the tier's coverage floor and applies no
 *   scrim.
 * - `Glass` is a thinner blurred layer plus a scrim beneath the content, so the
 *   composited coverage still meets the same floor.
 *
 * Each tier resolves to a token triple — backdrop blur radius, backdrop
 * saturation, background alpha — plus the scrim alpha, all emitted per Material
 * step and per colour scheme by `themes/appearancePreferences.ts` and consumed
 * by the `.app-glass-surface` rules in `index.css`. The blur and the saturation
 * travel as one `backdrop-filter` token so `Solid` can resolve to `none`. No
 * consumer names a blur, alpha, radius or shadow.
 *
 * The floors that make the guarantee hold are asserted over resolved,
 * composited colours in `GlassSurface.browser.tsx`.
 *
 * There is deliberately no wrapper component: consumers apply the material to
 * an element they do not own — a Base UI `Drawer.Popup`, the connection pill's
 * own `button`, the dock capsule — so a wrapper would add a box that has to be
 * made transparent again. The tier is applied as a class instead.
 */
export { GLASS_SURFACE_TIERS, type GlassSurfaceTier };

const GLASS_SURFACE_TIER_CLASS_NAMES: Record<GlassSurfaceTier, string> = {
  sheet: "app-glass-surface-sheet",
  chip: "app-glass-surface-chip",
  dock: "app-glass-surface-dock",
};

/** The class pair that renders a surface on the given material tier. */
export function glassSurfaceClassName(tier: GlassSurfaceTier): string {
  return cn("app-glass-surface", GLASS_SURFACE_TIER_CLASS_NAMES[tier]);
}
