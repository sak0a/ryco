import { useEffect } from "react";
import type { EnvironmentId } from "@ryco/contracts";

import { readEnvironmentApi } from "../connection/environmentApi";
import { useWsConnectionStatusForEnvironment } from "../rpc/wsConnectionState";
import { startAgentControlProposalSync, useAgentControlStore } from "./agentControlRuntime";

/**
 * Keep one environment's Agent Control queue synced into the shared store
 * while mounted and the server-side Agent Control setting is enabled. The
 * same shared runtime the web app uses — mobile adds no policy or
 * transport of its own.
 */
export function useAgentControlSync(environmentId: EnvironmentId, enabled: boolean): void {
  // Wave 3a: `readEnvironmentApi` is snapshotted once per effect run and
  // returns null while the environment has no connection. A thread opened from
  // cache has none — the retarget lands one a moment later — so without this
  // dep the queue would stay dead for the whole life of the screen. The
  // environment's own socket phase is the arrival signal; it flips to
  // "connected" exactly when there is an api to read.
  const connectionPhase = useWsConnectionStatusForEnvironment(environmentId).phase;

  useEffect(() => {
    if (!enabled) return undefined;
    const source = readEnvironmentApi(environmentId)?.agentControl;
    if (!source) return undefined;
    const store = useAgentControlStore.getState();
    return startAgentControlProposalSync({
      environmentId,
      source,
      sink: {
        applyStreamEvent: store.applyStreamEvent,
        clearEnvironment: store.clearEnvironment,
      },
    });
  }, [connectionPhase, enabled, environmentId]);
}
