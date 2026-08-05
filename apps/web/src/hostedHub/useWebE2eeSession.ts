import { useSyncExternalStore } from "react";

import type { WebHostedE2eeChannelStatus } from "./connectionStatus";
import { subscribeWebE2eeSession, webE2eeSessionState } from "./e2eeSession";

/**
 * React binding for this tier's §13 channel projection.
 *
 * `useSyncExternalStore` rather than a store library, for the reason the
 * projection is a plain subscribable module: every decision in it is assertable
 * from a node test without React, and `e2eeSession.test.ts` is where they are
 * asserted.
 */
const channelStatus = (): WebHostedE2eeChannelStatus => webE2eeSessionState().status;

/**
 * What `docs/relay-e2ee-protocol.md` §4.4 locked on the channel behind this
 * session, for the hosted status derivation.
 *
 * EVERY HOSTED STATUS SURFACE TAKES IT, and §12.2 is why: "A client that falls
 * back MUST label the channel **legacy** in every user-facing surface and
 * diagnostic." A surface that reads its state from the transport alone renders a
 * plaintext downgrade and a locked NX channel identically — both `Online`, both
 * with the connected glyph — which is precisely the retained downgrade exposure
 * of the compatibility window going unlabeled.
 *
 * The return type is the tier-fenced union (`connectionStatus.ts`), so the two
 * native rows are not merely unused here but unrepresentable: §2.2's bottom row
 * may never be spelled by a client whose JavaScript the Hub serves.
 *
 * Narrowed to the one field so a change to any other part of the projection —
 * §13.5's code in particular — does not re-render a connection pill.
 */
export function useWebE2eeChannelStatus(): WebHostedE2eeChannelStatus {
  return useSyncExternalStore(subscribeWebE2eeSession, channelStatus, channelStatus);
}
