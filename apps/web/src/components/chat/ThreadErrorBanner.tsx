import type { ScopedThreadRef } from "@ryco/contracts";
import { memo, useEffect, useRef } from "react";

import { toastManager } from "../ui/toast";

export const ThreadErrorBanner = memo(function ThreadErrorBanner({
  error,
  threadRef,
  onDismiss,
}: {
  error: string | null;
  threadRef: ScopedThreadRef | null;
  onDismiss?: () => void;
}) {
  const environmentId = threadRef?.environmentId ?? null;
  const threadId = threadRef?.threadId ?? null;
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!error) return;
    let live = true;
    const toastId = toastManager.add({
      type: "error",
      title: "Thread error",
      description: error,
      priority: "high",
      timeout: 0,
      onClose: () => {
        if (live) onDismissRef.current?.();
      },
      data: {
        threadRef: environmentId !== null && threadId !== null ? { environmentId, threadId } : null,
      },
    });
    return () => {
      live = false;
      toastManager.close(toastId);
    };
  }, [environmentId, error, threadId]);

  return null;
});
