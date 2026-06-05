import { useEffect, useState } from "react";

export function useDelayedUnmount(visible: boolean, exitDurationMs: number): boolean {
  const [shouldRender, setShouldRender] = useState(visible);

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      return;
    }

    if (exitDurationMs <= 0) {
      setShouldRender(false);
      return;
    }

    const timeoutId = window.setTimeout(() => setShouldRender(false), exitDurationMs);
    return () => window.clearTimeout(timeoutId);
  }, [exitDurationMs, visible]);

  return shouldRender;
}
