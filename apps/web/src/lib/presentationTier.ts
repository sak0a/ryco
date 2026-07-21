import { useTierOverrideStore } from "../tierOverrideStore";

export type PresentationTier = "phone" | "desktop";

/**
 * The single phone/desktop classification (delivery step 4 of the focused
 * mobile workspace design): `phone` when the viewport is narrower than 768 px
 * OR when a coarse primary pointer meets a sub-500 px viewport height (phone
 * landscape), else `desktop`. The second clause captures landscape phones
 * without reclassifying tablets at or above 768 px width.
 */
export const PHONE_TIER_MEDIA_QUERY =
  "(max-width: 767px), (pointer: coarse) and (max-height: 499px)";

/**
 * The root attribute mirroring the tier for CSS. `src/index.css` defines the
 * matching `phone` / `not-phone` Tailwind custom variants.
 */
export const PRESENTATION_TIER_ATTRIBUTE = "data-tier";

const subscribers = new Set<() => void>();

function matchesPhoneMedia(): boolean {
  // The matchMedia probe also guards non-browser unit-test environments that
  // stub `window` without a media-query implementation; they classify as
  // desktop, matching the SSR snapshot.
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(PHONE_TIER_MEDIA_QUERY).matches
  );
}

function computeTier(): PresentationTier {
  // Dev/QA preview override only: production builds compile this block away,
  // so the media classification is the only production source.
  if (import.meta.env.DEV) {
    const { override } = useTierOverrideStore.getState();
    if (override !== null) {
      return override;
    }
  }
  return matchesPhoneMedia() ? "phone" : "desktop";
}

let currentTier: PresentationTier = computeTier();

function applyTier(): void {
  const nextTier = computeTier();
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    if (root.getAttribute(PRESENTATION_TIER_ATTRIBUTE) !== nextTier) {
      root.setAttribute(PRESENTATION_TIER_ATTRIBUTE, nextTier);
    }
  }
  if (nextTier === currentTier) {
    return;
  }
  currentTier = nextTier;
  for (const subscriber of subscribers) {
    subscriber();
  }
}

let activeTeardown: (() => void) | null = null;

/**
 * The single presentation-tier subscription for the app. Stamps
 * `data-tier="phone" | "desktop"` on `document.documentElement` — covering
 * every subtree, including the hosted root and /pair surfaces — at activation
 * and on every classification or override change. The subscription is a
 * singleton: while one activation is live, further calls return its teardown
 * instead of double-subscribing.
 */
export function syncDocumentPresentationTier(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }
  if (activeTeardown) {
    return activeTeardown;
  }

  const mediaQueryList = window.matchMedia(PHONE_TIER_MEDIA_QUERY);
  const onChange = () => applyTier();
  mediaQueryList.addEventListener("change", onChange);
  const unsubscribeOverride = import.meta.env.DEV ? useTierOverrideStore.subscribe(onChange) : null;
  applyTier();

  const teardown = () => {
    mediaQueryList.removeEventListener("change", onChange);
    unsubscribeOverride?.();
    if (activeTeardown === teardown) {
      activeTeardown = null;
    }
  };
  activeTeardown = teardown;
  return teardown;
}

export function getPresentationTier(): PresentationTier {
  return currentTier;
}

/**
 * Subscribe to tier changes. Consumers (see `usePresentationTier`) keep the
 * document-level sync active so the tier value, the root attribute, and the
 * CSS variants always agree.
 */
export function subscribeToPresentationTier(subscriber: () => void): () => void {
  syncDocumentPresentationTier();
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}
