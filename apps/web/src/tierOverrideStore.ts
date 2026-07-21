import { create } from "zustand";

export type PresentationTierOverride = "phone" | "desktop";

/**
 * Development/QA-only presentation-tier preview override (delivery step 4 of
 * the focused mobile workspace design). The override forces the tier signal
 * and the root `data-tier` attribute so layout-critical CSS renders a faithful
 * phone/desktop preview. All UI and effects that consume this store are gated
 * behind `import.meta.env.DEV`; in production builds the override is inert and
 * unreachable. It never touches `prefers-color-scheme`, `display-mode`,
 * reduced-motion queries, PWA lifecycle, or capability logic.
 */
interface TierOverrideStore {
  override: PresentationTierOverride | null;
  setOverride: (override: PresentationTierOverride | null) => void;
}

// PURE lets production builds drop the store entirely: every consumer is
// gated behind `import.meta.env.DEV`, so the creation is dead code there.
export const useTierOverrideStore = /* @__PURE__ */ create<TierOverrideStore>((set) => ({
  override: null,
  setOverride: (override) => set({ override }),
}));
