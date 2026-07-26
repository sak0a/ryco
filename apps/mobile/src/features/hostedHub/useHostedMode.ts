import { useEffect, useState } from "react";

import {
  ensureMobileHostedSession,
  isMobileHostedModeAvailable,
  subscribeMobileHostedModeAvailability,
} from "../../hostedHub/state";

/**
 * Whether this build can run the hosted plane at all.
 *
 * `isMobileHostedModeAvailable()` is false until the runtime has been
 * configured, and configuration is async because it must resolve a hardware
 * key first — so a plain call at render time would report "unavailable" for
 * every hosted build on first paint. `ensureMobileHostedSession()` is the
 * single, memoized entry point that hydrates the session token, configures the
 * runtime, and bootstraps the controller in that order; it resolves without
 * configuring anything on a direct-only build or on a device with no usable
 * enclave key, which is exactly the "unavailable" answer this hook needs.
 *
 * Every hosted surface gates on this: with hosted mode unavailable, no hosted
 * affordance renders at all, rather than rendering a tappable-but-broken one.
 */
export function useHostedModeAvailable(): boolean {
  const [available, setAvailable] = useState(isMobileHostedModeAvailable);

  useEffect(() => {
    let active = true;
    const settle = () => {
      if (active) setAvailable(isMobileHostedModeAvailable());
    };
    const unsubscribe = subscribeMobileHostedModeAvailability(settle);
    void ensureMobileHostedSession().then(settle, settle);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return available;
}
