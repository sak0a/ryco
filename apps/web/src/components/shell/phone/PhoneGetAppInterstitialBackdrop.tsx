import { useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * Marks #root inert for as long as the caller is mounted so the covered app
 * shell cannot receive focus or input. Skipped when #root is absent.
 */
export function useRootInertWhileMounted(): void {
  useEffect(() => {
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");

    return () => root?.removeAttribute("inert");
  }, []);
}

/**
 * Blocking fallback shown while the lazy interstitial chunk loads: the gate
 * must hold from the very first paint, so the backdrop covers the shell and
 * keeps it inert until the dialog takes over.
 */
export function PhoneGetAppInterstitialBackdrop() {
  useRootInertWhileMounted();

  return createPortal(
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[120] bg-background/72 backdrop-blur-sm"
      data-testid="phone-get-app-interstitial-backdrop"
    />,
    document.body,
  );
}
