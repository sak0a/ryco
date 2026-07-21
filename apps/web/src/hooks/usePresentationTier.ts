import { useSyncExternalStore } from "react";

import {
  getPresentationTier,
  subscribeToPresentationTier,
  type PresentationTier,
} from "../lib/presentationTier";

function getServerSnapshot(): PresentationTier {
  return "desktop";
}

/**
 * The only JS consumer API for the presentation tier. Components must derive
 * phone/desktop decisions from this hook (or the `phone:` CSS variant), never
 * from raw viewport width. `useMediaQuery` remains for cosmetic cases.
 */
export function usePresentationTier(): PresentationTier {
  return useSyncExternalStore(subscribeToPresentationTier, getPresentationTier, getServerSnapshot);
}
