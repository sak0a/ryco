import { useSyncExternalStore } from "react";

import {
  getMobileE2eeSessionState,
  subscribeMobileE2eeSession,
  type MobileE2eeSessionState,
} from "../../hostedHub/e2eeSession";

/**
 * React binding for the §13 session projection.
 *
 * `useSyncExternalStore` rather than a store library: the projection is a plain
 * subscribable module so it can be asserted by a node test without React, which
 * is the whole reason the decisions do not live in a `.tsx`.
 */
export function useMobileE2eeSession(): MobileE2eeSessionState {
  return useSyncExternalStore(
    subscribeMobileE2eeSession,
    getMobileE2eeSessionState,
    getMobileE2eeSessionState,
  );
}
