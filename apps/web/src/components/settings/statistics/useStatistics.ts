import { useCallback, useEffect, useState } from "react";
import type { StatisticsSnapshot } from "@ryco/contracts";

import { ensureLocalApi } from "~/localApi";

export interface UseStatisticsResult {
  readonly snapshot: StatisticsSnapshot | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
  readonly refreshing: boolean;
}

/**
 * Fetch the statistics snapshot once on mount, with a manual refresh. Unlike the
 * diagnostics panel we avoid tight polling — stats change slowly and the query
 * scans projection tables, so an explicit refresh is friendlier.
 */
export function useStatistics(): UseStatisticsResult {
  const [snapshot, setSnapshot] = useState<StatisticsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (refreshKey === 0) {
      setLoading(true);
    }
    void ensureLocalApi()
      .server.getStatistics()
      .then((next) => {
        if (!cancelled) {
          setSnapshot(next);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const refresh = useCallback(() => {
    setRefreshKey((key) => key + 1);
  }, []);

  return {
    snapshot,
    loading,
    error,
    refresh,
    refreshing: loading && snapshot !== null,
  };
}
