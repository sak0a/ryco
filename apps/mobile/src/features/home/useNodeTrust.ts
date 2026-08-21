import { useMemo, useSyncExternalStore } from "react";

import { getMobileHostedConfig } from "../../hostedHub/runtimeConfig";
import { useHostedHubStore } from "../../hostedHub/state";
import { mobileE2eeTrustStore } from "../../platform/e2eeTrustStore";
import { deriveNodeTrustByEnvironment, type NodeTrust } from "./nodeTrustModel";

/**
 * The store binding for {@link deriveNodeTrustByEnvironment}. All judgement
 * lives in `nodeTrustModel.ts`; this file exists only because that module may
 * not import react or a platform adapter.
 *
 * It reads the trust store through its two DISPLAY-ONLY accessors (`marker` and
 * `verifiedRecordsForAccount`) and never through `classify` — a hook cannot
 * await §13.1's marker reconciliation, and a synchronous classification path is
 * precisely what the store's own docs forbid. Nothing here may gate a connect,
 * send or retarget.
 *
 * `revision` is the store's change token: it moves on every commit and on the
 * hydration that first produces a document, so subscribing to it is what makes
 * a freshly completed pairing ceremony repaint the list. It is deliberately not
 * read in the body — the accessors are — only depended on.
 *
 * Returns `null` (no claims) whenever this device has no hosted scope to make a
 * claim within: hosted mode unconfigured, or no authenticated account. On a
 * direct-only build the store never hydrates, so the marker is `unobtainable`
 * and the model returns `null` for that reason too.
 */
export function useNodeTrust(
  rosterNodes: ReadonlyArray<{ readonly environmentId: string; readonly nodeId: string }>,
): ReadonlyMap<string, NodeTrust> | null {
  const revision = useSyncExternalStore(
    mobileE2eeTrustStore.subscribe,
    mobileE2eeTrustStore.revision,
  );
  const accountId = useHostedHubStore((state) => state.account?.id ?? null);

  return useMemo(() => {
    const config = getMobileHostedConfig();
    if (config === null || accountId === null) return null;
    return deriveNodeTrustByEnvironment({
      markerKind: mobileE2eeTrustStore.marker(config.hubOrigin).kind,
      verifiedRecords: mobileE2eeTrustStore.verifiedRecordsForAccount(config.hubOrigin, accountId),
      rosterNodes,
    });
  }, [accountId, revision, rosterNodes]);
}
