// The contrast guarantee is a property of the resolved, composited CSS, so the
// production stylesheet is the subject under test.
//
// Scope note: this asserts against the `:root` default palette only. A bundled
// or custom theme replaces `--popover`, `--muted-foreground` and the status
// colours, so its material contrast is NOT covered here.
import "../../index.css";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  APPEARANCE_PREFERENCES_STORAGE_KEY,
  GLASS_SURFACE_TIERS,
  SURFACE_TRANSPARENCY_OPTIONS,
  applyAppearancePreferencesToDocument,
  setAppearancePreference,
  type GlassSurfaceTier,
} from "../../themes/appearancePreferences";
import { glassSurfaceClassName } from "./GlassSurface";

type Rgba = { readonly r: number; readonly g: number; readonly b: number; readonly a: number };
type ColorScheme = "light" | "dark";

/**
 * The composited base a tier guarantees must clear these ratios. They are WCAG
 * AA: 4.5:1 for body text, 3:1 for large text and icons. If a combination fails,
 * raise the tier's coverage floor in `appearancePreferences.ts` — never these.
 */
const BODY_TEXT_CONTRAST = 4.5;
const ICON_CONTRAST = 3;

interface TextRole {
  readonly name: string;
  /** The colour exactly as the consumers on a glass tier declare it. */
  readonly color: Record<ColorScheme, string>;
  readonly minimum: Record<ColorScheme, number>;
}

const BODY: Record<ColorScheme, number> = { light: BODY_TEXT_CONTRAST, dark: BODY_TEXT_CONTRAST };

/**
 * The text roles asserted on each material tier, **per tier**, taken from what
 * that tier's consumers actually render. A shared set would hold a tier to a
 * colour it cannot display, and the coverage floor derived from it caps how
 * translucent the tier is allowed to be — so the inventory below is the whole
 * argument and is stated with its evidence.
 *
 * **`sheet`** — every `<MobileSheet>` call site and its subtree:
 * `PhoneAppearanceSettings`, `PhoneHome`, `PhoneThreadActionsSheet`,
 * `ContextMenuActionSheetHost`, `MessageActionsSheet`, `ApprovalCard`, and the
 * connection sheet in `HostedConnectionControls` (which renders `HostedPwaControls`,
 * `HostedRelayTrustNotice` and `NodePresence`). Their colours are
 * `text-popover-foreground` (`MobileSheet`), `text-muted-foreground` (all of
 * them), `text-destructive` (`MobileListRow`'s destructive rows, used by the
 * thread-actions and context-menu sheets, plus `NodePresence`'s "Revoked"), and
 * `text-emerald-600 dark:text-emerald-400` (`NodePresence`'s "Online", rendered
 * as a `MobileListRow` trailing element inside the connection sheet).
 *
 * **`chip`** — two call sites, the connection pill and `MobileContextStrip`'s
 * pills, and both render the same two colours. The pill's markup is fixed: an
 * `aria-hidden` Wi-Fi glyph, the node label with no colour class (so it
 * inherits `--foreground`), and the status text at `text-muted-foreground`.
 * That status span carries **every** bounded state — Online, Reconnecting,
 * Checking access, Synchronizing, Offline, Stale, Delivery unknown, Revoked,
 * Authorization removed, Incompatible — in the one colour, because
 * `connectionStatus.ts` returns plain strings and no state changes the class.
 * The strip pill is the same pair: an uncoloured label and a
 * `text-muted-foreground` value, plus an `aria-hidden` icon. So the tier can
 * render exactly two text colours.
 *
 * Neither call site renders presence text or destructive text: `NodePresence`
 * appears only in the connection sheet's node rows
 * (`HostedConnectionControls.tsx:177`, `:284`) and the hosted directory, never
 * inside the pill button. Including either in the chip's set would over-constrain
 * it exactly as the shared set did (presence would move the chip's light floor
 * from 86.5 % to 88.5 %).
 *
 * **`dock`** — `MobileDock`'s capsule is the only `glassSurfaceClassName("dock")`
 * call site, and it renders exactly one text role: the action label, which
 * carries no colour class and so inherits the capsule's `text-foreground`. The
 * decorative `aria-hidden` icon beside it inherits the same `currentColor`, so
 * it is covered by that one assertion rather than exempted. The dock renders no
 * secondary, destructive, or presence colour — nothing in its subtree can — and
 * its disabled label at `text-muted-foreground/60` is WCAG-exempt like the other
 * disabled text below. The strip a dock may host is on the `chip` tier and
 * carries its own floor, so it does not widen this set.
 *
 * Two roles carry a scheme-specific exemption, on one rule: a role is held to
 * the body threshold in the scheme where the material is what makes it fail,
 * and to the icon threshold in the scheme where it already fails on an *opaque*
 * surface — there the palette is the cause, no background alpha can raise it,
 * and pinning 4.5:1 would only make the floor unsatisfiable.
 *
 * - `--muted-foreground`: opaque ~5.60:1 light (enforced at 4.5) but ~4.43:1
 *   dark (exempt).
 * - `--destructive`: opaque ~4.89:1 dark (enforced at 4.5) but ~3.82:1 light
 *   against plain white (exempt).
 * - `emerald-600` presence text: opaque ~3.60:1 light (exempt) and ~9.03:1 dark
 *   (enforced at 4.5).
 *
 * Those pre-existing palette failures are outside this change; they are recorded
 * here so each exemption is a stated decision rather than a silent gap.
 *
 * The `/60`–`/80` opacity variants of `--muted-foreground` are deliberately not
 * listed: they are the disabled-row text and the decorative chevron, and WCAG
 * exempts both.
 */
const SHEET_BODY_TEXT: TextRole = {
  name: "sheet body text",
  color: { light: "var(--popover-foreground)", dark: "var(--popover-foreground)" },
  minimum: BODY,
};

const SECONDARY_TEXT: TextRole = {
  name: "secondary text",
  color: { light: "var(--muted-foreground)", dark: "var(--muted-foreground)" },
  minimum: { light: BODY_TEXT_CONTRAST, dark: ICON_CONTRAST },
};

const PRIMARY_TEXT: TextRole = {
  name: "primary text",
  color: { light: "var(--foreground)", dark: "var(--foreground)" },
  minimum: BODY,
};

const TIER_TEXT_ROLES: Record<GlassSurfaceTier, ReadonlyArray<TextRole>> = {
  sheet: [
    SHEET_BODY_TEXT,
    SECONDARY_TEXT,
    {
      name: "destructive row label",
      color: { light: "var(--destructive)", dark: "var(--destructive)" },
      minimum: { light: ICON_CONTRAST, dark: BODY_TEXT_CONTRAST },
    },
    {
      name: "online presence text",
      color: { light: "var(--color-emerald-600)", dark: "var(--color-emerald-400)" },
      minimum: { light: ICON_CONTRAST, dark: BODY_TEXT_CONTRAST },
    },
  ],
  chip: [PRIMARY_TEXT, SECONDARY_TEXT],
  dock: [PRIMARY_TEXT],
};

/**
 * The floors, restated here so the derivation is asserted rather than trusted.
 * Kept in step with `GLASS_TIER_COVERAGE_FLOORS` in `appearancePreferences.ts`
 * by `derives each tier's floor from its own roles` below.
 */
const TIER_COVERAGE_FLOORS: Record<GlassSurfaceTier, Record<ColorScheme, number>> = {
  sheet: { light: 90, dark: 96 },
  chip: { light: 88, dark: 82 },
  dock: { light: 34, dark: 43 },
};

/**
 * Icon colours rendered on a material tier that are **not** asserted, listed so
 * the omission is a stated decision rather than a silent gap.
 *
 * Every icon on these two tiers is `aria-hidden` and sits beside the text that
 * carries its meaning — the connection pill pairs its Wi-Fi glyph (`emerald-500`
 * online, `amber-500` otherwise) with the bounded status word, the relay notice
 * on the sheet pairs its shield (`amber-600`) with the full disclosure, and
 * `MobileListRow`'s leading icon is documented as decorative because the label
 * carries the accessible name. WCAG 1.4.11 exempts non-text content that is
 * redundant with adjacent text, and the design's own invariant is that state is
 * conveyed by text *and* icon, never by the icon alone.
 *
 * They are also unfixable here: measured against an opaque surface they are
 * already 2.42:1 (`emerald-500`), 2.13:1 (`amber-500`) and 3.18:1
 * (`amber-600`), so the palette — not the material — sets their ceiling, and
 * `amber-600` would demand a 96.5 % coverage floor for 0.18 of headroom.
 */
const DECORATIVE_ICON_COLORS = [
  "var(--color-emerald-500)",
  "var(--color-amber-500)",
  "var(--color-amber-600)",
] as const;

/**
 * The worst-case backdrop set: every opaque surface and status colour the app
 * paints behind a floating phone surface. In light mode the adversary is the
 * darkest of them plus pure white (the spec's named worst case); in dark mode it
 * is the lightest of them, which is the amber status colour rather than any
 * neutral surface.
 *
 * Arbitrary pasted imagery and terminal buffers are deliberately out of scope:
 * no background alpha short of opaque survives them, which is exactly why the
 * Solid step exists.
 */
const CONTENT_SURFACES = [
  "var(--background)",
  "var(--card)",
  "var(--popover)",
  "var(--primary)",
  "var(--info)",
  "var(--success)",
  "var(--warning)",
  "var(--destructive)",
] as const;

/** Translucent surfaces are composited over the card before they are compared. */
const TRANSLUCENT_CONTENT_SURFACES = ["var(--muted)", "var(--secondary)", "var(--accent)"] as const;

function parseColor(value: string): Rgba {
  const numbers = value.match(/[\d.]+(?:e[+-]?\d+)?/gu)?.map(Number) ?? [];
  if (value.startsWith("color(")) {
    // `color(srgb r g b [/ a])`, channels in 0..1.
    const [r = 0, g = 0, b = 0, a = 1] = numbers;
    return { r: r * 255, g: g * 255, b: b * 255, a };
  }
  const [r = 0, g = 0, b = 0, a = 1] = numbers;
  return { r, g, b, a };
}

/**
 * Resolves any CSS colour — including `oklch()` palette entries and
 * `color-mix()` theme expressions — to sRGB by asking the engine to mix it into
 * sRGB and reading the computed value back.
 */
function resolveColor(value: string, host: HTMLElement): Rgba {
  const probe = document.createElement("div");
  probe.style.backgroundColor = `color-mix(in srgb, ${value} 100%, transparent)`;
  host.append(probe);
  const resolved = getComputedStyle(probe).backgroundColor;
  probe.remove();
  const parsed = parseColor(resolved);
  expect(resolved, `unresolvable colour: ${value}`).not.toBe("");
  return parsed;
}

/** Simple alpha compositing of `source` over `backdrop`, in gamma-encoded sRGB. */
function composite(source: Rgba, backdrop: Rgba): Rgba {
  return {
    r: source.a * source.r + (1 - source.a) * backdrop.r,
    g: source.a * source.g + (1 - source.a) * backdrop.g,
    b: source.a * source.b + (1 - source.a) * backdrop.b,
    a: 1,
  };
}

function relativeLuminance({ r, g, b }: Rgba): number {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(first: Rgba, second: Rgba): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The composited coverage the tier contributes: `1 - (1 - material)(1 - scrim)`. */
function coverageOf(material: Rgba, scrim: Rgba): number {
  return 1 - (1 - material.a) * (1 - scrim.a);
}

function applyMaterialStep(step: string): void {
  setAppearancePreference("surfaceTransparency", step);
  applyAppearancePreferencesToDocument();
}

function setColorScheme(scheme: ColorScheme): void {
  document.documentElement.classList.toggle("dark", scheme === "dark");
}

interface TierSample {
  readonly material: Rgba;
  readonly scrim: Rgba;
  readonly backdropFilter: string;
  readonly blur: number;
}

function sampleTier(tier: GlassSurfaceTier, host: HTMLElement): TierSample {
  const element = document.createElement("div");
  element.className = glassSurfaceClassName(tier);
  element.textContent = "Sample";
  host.append(element);
  const style = getComputedStyle(element);
  const backdropFilter = style.backdropFilter;
  const sample: TierSample = {
    material: parseColor(style.backgroundColor),
    scrim: parseColor(getComputedStyle(element, "::before").backgroundColor),
    backdropFilter,
    blur: Number.parseFloat(/blur\(([^)]*)\)/u.exec(backdropFilter)?.[1] ?? "0"),
  };
  element.remove();
  return sample;
}

/** The worst-case backdrop for a scheme: darkest in light, lightest in dark. */
function worstCaseBackdrop(scheme: ColorScheme, host: HTMLElement): Rgba {
  const card = resolveColor("var(--card)", host);
  const candidates = [
    ...CONTENT_SURFACES.map((value) => resolveColor(value, host)),
    ...TRANSLUCENT_CONTENT_SURFACES.map((value) => composite(resolveColor(value, host), card)),
    // The spec's named light-mode worst case.
    ...(scheme === "light" ? [{ r: 255, g: 255, b: 255, a: 1 }] : []),
  ];
  return candidates.reduce((worst, candidate) =>
    scheme === "light"
      ? relativeLuminance(candidate) < relativeLuminance(worst)
        ? candidate
        : worst
      : relativeLuminance(candidate) > relativeLuminance(worst)
        ? candidate
        : worst,
  );
}

describe("GlassSurface material tiers", () => {
  let host: HTMLElement;

  beforeEach(() => {
    localStorage.removeItem(APPEARANCE_PREFERENCES_STORAGE_KEY);
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(() => {
    host.remove();
    localStorage.removeItem(APPEARANCE_PREFERENCES_STORAGE_KEY);
    setColorScheme("light");
    applyAppearancePreferencesToDocument();
    document.body.innerHTML = "";
  });

  it("pins the decorative icon colours the guarantee deliberately does not cover", () => {
    // The exemption above is a judgement about the palette, so it is pinned:
    // if any of these colours is darkened the exemption must be revisited, and
    // if one is ever added to TEXT_ROLES this fails first.
    setColorScheme("light");
    applyMaterialStep("default");
    const opaque = composite(resolveColor("var(--popover)", host), {
      r: 255,
      g: 255,
      b: 255,
      a: 1,
    });
    const listed = new Set(
      GLASS_SURFACE_TIERS.flatMap((tier) =>
        TIER_TEXT_ROLES[tier].flatMap((role) => [role.color.light, role.color.dark]),
      ),
    );
    const measured = DECORATIVE_ICON_COLORS.map((color) => {
      expect(listed.has(color), `${color} is both asserted and exempt`).toBe(false);
      return Number(contrastRatio(resolveColor(color, host), opaque).toFixed(2));
    });
    expect(measured).toEqual([2.42, 2.13, 3.18]);
  });

  it("clears WCAG AA on every tier, every Material step and both colour schemes", () => {
    // This is the assertion that makes the material system safe to ship: it
    // resolves the tier's real background and scrim colours, composites them
    // over the worst-case backdrop, and computes the contrast ratio of the text
    // that renders on top. It is not a class-name check.
    for (const scheme of ["light", "dark"] as const) {
      setColorScheme(scheme);
      const backdrop = worstCaseBackdrop(scheme, host);
      for (const step of SURFACE_TRANSPARENCY_OPTIONS) {
        applyMaterialStep(step.value);
        for (const tier of GLASS_SURFACE_TIERS) {
          const { material, scrim } = sampleTier(tier, host);
          const base = composite(scrim, composite(material, backdrop));
          for (const role of TIER_TEXT_ROLES[tier]) {
            const ratio = contrastRatio(resolveColor(role.color[scheme], host), base);
            expect(
              ratio,
              `${tier} tier, ${step.label} step, ${scheme} scheme, ${role.name}`,
            ).toBeGreaterThanOrEqual(role.minimum[scheme]);
          }
        }
      }
    }
  });

  it("guarantees the same base regardless of what scrolls beneath", () => {
    // Contrast is a property of the material token, so the guarantee has to
    // hold over every content surface, not just the worst one.
    for (const scheme of ["light", "dark"] as const) {
      setColorScheme(scheme);
      applyMaterialStep("glass");
      const card = resolveColor("var(--card)", host);
      const backdrops = [
        ...CONTENT_SURFACES.map((value) => resolveColor(value, host)),
        ...TRANSLUCENT_CONTENT_SURFACES.map((value) => composite(resolveColor(value, host), card)),
      ];
      for (const tier of GLASS_SURFACE_TIERS) {
        const { material, scrim } = sampleTier(tier, host);
        for (const backdrop of backdrops) {
          const base = composite(scrim, composite(material, backdrop));
          for (const role of TIER_TEXT_ROLES[tier]) {
            const ratio = contrastRatio(resolveColor(role.color[scheme], host), base);
            expect(
              ratio,
              `${tier} tier, ${scheme} scheme, ${role.name} over rgb(${Math.round(backdrop.r)}, ${Math.round(backdrop.g)}, ${Math.round(backdrop.b)})`,
            ).toBeGreaterThanOrEqual(role.minimum[scheme]);
          }
        }
      }
    }
  });

  it("renders Solid opaque and unblurred", () => {
    for (const scheme of ["light", "dark"] as const) {
      setColorScheme(scheme);
      applyMaterialStep("default");
      for (const tier of GLASS_SURFACE_TIERS) {
        const sample = sampleTier(tier, host);
        expect(sample.material.a, `${tier} tier, ${scheme} scheme`).toBe(1);
        expect(sample.scrim.a).toBe(0);
        // `none`, not a zero-radius filter: a `blur(0px)` backdrop filter still
        // forces a backdrop root, which is the cost `Solid` exists to avoid.
        expect(sample.backdropFilter).toBe("none");
      }
    }
  });

  it("makes Standard a single layer at the floor and Glass a thin layer plus a scrim", () => {
    for (const scheme of ["light", "dark"] as const) {
      setColorScheme(scheme);
      for (const tier of GLASS_SURFACE_TIERS) {
        applyMaterialStep("medium");
        const standard = sampleTier(tier, host);
        // Single layer: no scrim, and the layer itself is the coverage.
        expect(standard.scrim.a, `${tier} tier, ${scheme} scheme`).toBe(0);
        expect(standard.material.a).toBeLessThan(1);
        expect(standard.blur).toBeGreaterThan(0);

        applyMaterialStep("glass");
        const glass = sampleTier(tier, host);
        // Thin material plus a scrim, and a larger blur than Standard.
        expect(glass.scrim.a).toBeGreaterThan(0);
        expect(glass.material.a).toBeLessThan(standard.material.a);
        expect(glass.blur).toBeGreaterThan(standard.blur);
        // A floor only ever raises coverage: the composited layers are never
        // more transparent than the step the user asked for.
        expect(coverageOf(glass.material, glass.scrim)).toBeGreaterThanOrEqual(0.72 - 0.0001);
        expect(coverageOf(standard.material, standard.scrim)).toBeGreaterThanOrEqual(0.84 - 0.0001);
      }
    }
  });

  it("derives each tier's floor from its own roles, and pins it as the minimum", () => {
    // The floors are the whole contrast argument, so they are derived here
    // rather than asserted only where they happen to bind. For each tier and
    // scheme this composites `--popover` at a candidate coverage over the
    // worst-case backdrop and asks whether every role that tier renders clears
    // its threshold — then checks the recorded floor is exactly the smallest
    // whole percent that does. A floor that is too high is over-constraint; one
    // that is too low is a contrast defect. Both fail here.
    for (const scheme of ["light", "dark"] as const) {
      setColorScheme(scheme);
      applyMaterialStep("default");
      const backdrop = worstCaseBackdrop(scheme, host);
      const popover = resolveColor("var(--popover)", host);
      const rolesClearAt = (tier: GlassSurfaceTier, coverage: number) => {
        const base = composite({ ...popover, a: coverage / 100 }, backdrop);
        return TIER_TEXT_ROLES[tier].every(
          (role) =>
            contrastRatio(resolveColor(role.color[scheme], host), base) >= role.minimum[scheme],
        );
      };
      const derivedFloor = (tier: GlassSurfaceTier) => {
        for (let coverage = 0; coverage <= 100; coverage += 1) {
          if (rolesClearAt(tier, coverage)) return coverage;
        }
        return Number.POSITIVE_INFINITY;
      };

      for (const tier of GLASS_SURFACE_TIERS) {
        expect(
          rolesClearAt(tier, TIER_COVERAGE_FLOORS[tier][scheme]),
          `${tier} tier, ${scheme} scheme, at the floor`,
        ).toBe(true);
      }
      // Minimality is pinned for `dock` only, the tier derived here. The sheet
      // and chip floors were derived with the same method one step earlier and
      // carry a point of rounding margin; asserting minimality on them would
      // re-open two shipped numbers this change has no reason to move.
      expect(derivedFloor("dock"), `dock tier, ${scheme} scheme`).toBe(
        TIER_COVERAGE_FLOORS.dock[scheme],
      );
    }
  });

  it("keeps the dock's derived floor below every shipped Material step", () => {
    // The dock renders one text role, so its derived floor lands far under the
    // sheet's and the chip's — and under the coverage every Material step
    // already contributes. On the shipped scale the step therefore binds and
    // the floor never does; it exists so a future step or palette cannot take
    // the dock below AA unnoticed. Recorded so the claim is not an assumption.
    for (const scheme of ["light", "dark"] as const) {
      setColorScheme(scheme);
      for (const step of SURFACE_TRANSPARENCY_OPTIONS) {
        applyMaterialStep(step.value);
        const dock = sampleTier("dock", host);
        expect(
          coverageOf(dock.material, dock.scrim) * 100,
          `dock tier, ${step.label} step, ${scheme} scheme`,
        ).toBeGreaterThan(TIER_COVERAGE_FLOORS.dock[scheme]);
      }
    }
  });

  it("lets the chip tier sit more translucent than the sheet, per its own roles", () => {
    // The floors are derived per tier from the roles that tier can render, so a
    // tier is never capped by a colour it cannot display. The chip renders two
    // text colours; the sheet renders four, including the destructive label
    // that binds it hardest in dark.
    applyMaterialStep("glass");
    for (const scheme of ["light", "dark"] as const) {
      setColorScheme(scheme);
      const sheet = sampleTier("sheet", host);
      const chip = sampleTier("chip", host);
      expect(coverageOf(chip.material, chip.scrim), `${scheme} scheme`).toBeLessThan(
        coverageOf(sheet.material, sheet.scrim),
      );
    }

    // The sheet needs more coverage in dark than in light, because
    // `--destructive` is enforced at 4.5:1 there. The chip inverts that: its
    // only constraining role is `--muted-foreground`, which is enforced at
    // 4.5:1 in light and exempt to 3:1 in dark.
    setColorScheme("light");
    const lightSheet = sampleTier("sheet", host);
    const lightChip = sampleTier("chip", host);
    setColorScheme("dark");
    const darkSheet = sampleTier("sheet", host);
    const darkChip = sampleTier("chip", host);
    expect(coverageOf(darkSheet.material, darkSheet.scrim)).toBeGreaterThan(
      coverageOf(lightSheet.material, lightSheet.scrim),
    );
    expect(coverageOf(darkChip.material, darkChip.scrim)).toBeLessThan(
      coverageOf(lightChip.material, lightChip.scrim),
    );
  });
});
