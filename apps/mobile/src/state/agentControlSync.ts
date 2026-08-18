import { useEffect } from "react";
import type { EnvironmentId } from "@ryco/contracts";

import { readEnvironmentApi } from "../connection/environmentApi";
import { startAgentControlProposalSync, useAgentControlStore } from "./agentControlRuntime";

/**
 * Keep one environment's Agent Control queue synced into the shared store
 * while mounted and the server-side Agent Control setting is enabled. The
 * same shared runtime the web app uses — mobile adds no policy or
 * transport of its own.
 */
export function useAgentControlSync(environmentId: EnvironmentId, enabled: boolean): void {
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
  }, [enabled, environmentId]);
}
