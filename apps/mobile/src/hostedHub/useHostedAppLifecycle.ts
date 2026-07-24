import { useEffect } from "react";

import { mobileAppLifecycle } from "../platform/appLifecycle";
import { hostedHubController, useHostedHubStore } from "./state";

/**
 * Drives the hosted browser lifecycle from app foreground/background and
 * connectivity — the mobile analogue of the web hosted lifecycle.
 *
 * iOS tears down sockets on background, so the runtime must be told to suspend
 * rather than discovering a dead socket later. Mount this ONCE, above the
 * hosted surfaces.
 */
export function useHostedAppLifecycle(): void {
  const authenticated = useHostedHubStore((state) => state.accountStatus === "authenticated");

  useEffect(() => {
    if (!authenticated) return;
    return mobileAppLifecycle.subscribe((event) => {
      switch (event) {
        case "background":
          hostedHubController.suspendBrowser("hidden");
          return;
        case "offline":
          hostedHubController.suspendBrowser("offline");
          return;
        case "foreground":
        case "online":
          void hostedHubController.resumeBrowser();
          return;
        default:
          // "resume" is emitted alongside "foreground"; the resume above covers it.
          return;
      }
    });
  }, [authenticated]);
}
