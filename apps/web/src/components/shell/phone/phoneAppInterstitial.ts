import { isHostedHubMode } from "../../../env";
import type { PresentationTier } from "../../../lib/presentationTier";

const DISMISSAL_STORAGE_KEY = "ryco:phone-app-interstitial-dismissed:v1";

let dismissedInMemory = false;

export interface PhoneAppInterstitialVisibility {
  readonly enabled: boolean;
  readonly isElectron: boolean;
  readonly tier: PresentationTier;
  readonly dismissed: boolean;
}

export function shouldShowPhoneAppInterstitial({
  enabled,
  isElectron,
  tier,
  dismissed,
}: PhoneAppInterstitialVisibility): boolean {
  return enabled && !isElectron && tier === "phone" && !dismissed;
}

export function readInterstitialDismissed(): boolean {
  if (dismissedInMemory) {
    return true;
  }
  if (isHostedHubMode()) {
    return false;
  }

  try {
    return window.sessionStorage.getItem(DISMISSAL_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markInterstitialDismissed(): void {
  dismissedInMemory = true;
  if (isHostedHubMode()) {
    return;
  }

  try {
    window.sessionStorage.setItem(DISMISSAL_STORAGE_KEY, "1");
  } catch {
    return;
  }
}

export function resetPhoneAppInterstitialForTests(): void {
  dismissedInMemory = false;
}
