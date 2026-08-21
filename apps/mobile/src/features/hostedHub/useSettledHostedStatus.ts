import { useEffect, useRef, useSyncExternalStore } from "react";

import {
  createSettledHostedStatusTracker,
  type SettledHostedStatus,
  type SettledHostedStatusInput,
  type SettledHostedStatusTracker,
} from "./settledHostedStatus";

/**
 * The React binding for `settledHostedStatus`, deliberately its own module.
 *
 * It imports `react` and nothing else — no `react-native`, no runtime, no
 * store — so the step machine stays testable as a pure module (this suite has
 * no React renderer at all) and the surfaces that render the chip stay layout
 * only.
 *
 * The tracker instance is per-component and lives for the component's lifetime:
 * it is the memory of what is currently ON SCREEN, which is exactly the thing a
 * remount is supposed to forget.
 */
export function useSettledHostedStatus(input: SettledHostedStatusInput): SettledHostedStatus {
  const trackerRef = useRef<SettledHostedStatusTracker | null>(null);
  trackerRef.current ??= createSettledHostedStatusTracker();
  const tracker = trackerRef.current;

  // Fed during render, so the pair this render returns already accounts for the
  // observation this render was triggered by. The tracker does not call back
  // into React for `update`-driven changes precisely so this is safe; the
  // subscription below exists for the threshold promotions, which have no
  // render of their own.
  tracker.update(input);

  useEffect(() => () => tracker.dispose(), [tracker]);

  return useSyncExternalStore(tracker.subscribe, tracker.read);
}
