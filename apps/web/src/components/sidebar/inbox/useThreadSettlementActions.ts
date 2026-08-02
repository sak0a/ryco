import type { ThreadInboxEntry } from "@ryco/client-runtime/state/threads";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useRef } from "react";

import { readEnvironmentApi } from "../../../environmentApi";
import { newCommandId } from "../../../lib/utils";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../../../threadRoutes";
import { stackedThreadToast, toastManager } from "../../ui/toast";

function errorDescription(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

export function useThreadSettlementActions() {
  const router = useRouter();
  const pendingKeysRef = useRef(new Set<string>());

  const settleThread = useCallback(
    async (entry: ThreadInboxEntry): Promise<boolean> => {
      if (!entry.mutationEnabled || !entry.lifecycle.eligibility.canSettle || entry.isDraft) {
        return false;
      }
      if (pendingKeysRef.current.has(entry.key)) return false;
      pendingKeysRef.current.add(entry.key);

      const currentParams = router.state.matches[router.state.matches.length - 1]?.params ?? {};
      const currentRef = resolveThreadRouteRef(currentParams);
      const isCurrent =
        currentRef?.environmentId === entry.ref.environmentId &&
        currentRef.threadId === entry.ref.threadId;
      let navigatedAway = false;

      try {
        if (isCurrent) {
          await router.navigate({ to: "/", replace: true });
          navigatedAway = true;
        }
        const api = readEnvironmentApi(entry.ref.environmentId);
        if (!api) {
          throw new Error("The environment disconnected before the thread could be settled.");
        }
        await api.orchestration.dispatchCommand({
          type: "thread.settle",
          commandId: newCommandId(),
          threadId: entry.ref.threadId,
        });
        return true;
      } catch (error) {
        if (navigatedAway) {
          try {
            await router.navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(entry.ref),
              replace: true,
            });
          } catch {
            // The command error is the useful failure; route restoration is best-effort.
          }
        }
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not settle thread",
            description: errorDescription(error),
          }),
        );
        return false;
      } finally {
        pendingKeysRef.current.delete(entry.key);
      }
    },
    [router],
  );

  const unsettleThread = useCallback(async (entry: ThreadInboxEntry): Promise<boolean> => {
    if (!entry.mutationEnabled || entry.isDraft) return false;
    if (pendingKeysRef.current.has(entry.key)) return false;
    pendingKeysRef.current.add(entry.key);
    try {
      const api = readEnvironmentApi(entry.ref.environmentId);
      if (!api) {
        throw new Error("The environment disconnected before the thread could be moved.");
      }
      await api.orchestration.dispatchCommand({
        type: "thread.unsettle",
        commandId: newCommandId(),
        threadId: entry.ref.threadId,
        reason: "user",
      });
      return true;
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not move thread to Active",
          description: errorDescription(error),
        }),
      );
      return false;
    } finally {
      pendingKeysRef.current.delete(entry.key);
    }
  }, []);

  return { settleThread, unsettleThread };
}
