import type { HostedE2eeChannelStatus } from "@ryco/client-runtime/authorization";
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
export function useMobileE2eeSession(environmentId?: string): MobileE2eeSessionState {
  const subscribe = (listener: () => void) =>
    environmentId
      ? subscribeMobileE2eeSession(environmentId, listener)
      : subscribeMobileE2eeSession(listener);
  const snapshot = () => getMobileE2eeSessionState(environmentId);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

const channelStatus = (): HostedE2eeChannelStatus => getMobileE2eeSessionState().channel;

/**
 * What §4.4 locked on the channel behind this session, for the hosted status
 * derivation.
 *
 * Every hosted pill takes it: §12.2 requires a fallen-back channel to be labeled
 * legacy "in every user-facing surface", and a pill that reads its state from the
 * transport alone renders a fallback and a verified session identically. It is
 * narrowed to the one field so a change to any other part of the projection does
 * not re-render a connection pill.
 */
export function useMobileE2eeChannelStatus(environmentId?: string | null): HostedE2eeChannelStatus {
  const subscribe = (listener: () => void) =>
    typeof environmentId === "string"
      ? subscribeMobileE2eeSession(environmentId, listener)
      : subscribeMobileE2eeSession(listener);
  const snapshot = () =>
    environmentId === undefined
      ? channelStatus()
      : getMobileE2eeSessionState(environmentId).channel;
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
