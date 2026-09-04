import type { ScopedThreadRef } from "@ryco/contracts";
import { useEffect, useRef } from "react";

import { retainThreadDetailSubscription } from "../../../environments/runtime/service";
import { scheduleIdleTask } from "../../../lib/idleTask";

export function useSidebarThreadPrewarm(
  enabled: boolean,
  threadRefs: ReadonlyArray<ScopedThreadRef>,
): void {
  const latestThreadRefs = useRef(threadRefs);
  latestThreadRefs.current = threadRefs;
  const threadRefKey = threadRefs
    .map((ref) => `${String(ref.environmentId)}\0${String(ref.threadId)}`)
    .join("\0");

  useEffect(() => {
    const refs = latestThreadRefs.current;
    if (!enabled || refs.length === 0) return;

    let releases: Array<ReturnType<typeof retainThreadDetailSubscription>> = [];
    const cancelIdleTask = scheduleIdleTask(() => {
      releases = refs.map((ref) => retainThreadDetailSubscription(ref.environmentId, ref.threadId));
    });

    return () => {
      cancelIdleTask();
      for (const release of releases) {
        release({ immediately: true });
      }
    };
  }, [enabled, threadRefKey]);
}
