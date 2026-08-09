import {
  applyPullRequestAiSnapshot,
  applyPullRequestSnapshot,
  markPullRequestAiEnvironmentStale,
  markPullRequestEnvironmentStale,
  selectFederatedPullRequests,
  isPullRequestAiScheduleDue,
  selectScheduledPullRequestCandidates,
  usePullRequestStore,
} from "@ryco/client-runtime/state/pullRequests";
import { Option } from "effect";
import { useEffect, useRef } from "react";

import { useSettings } from "~/hooks/useSettings";
import {
  listEnvironmentConnections,
  subscribeEnvironmentConnections,
} from "~/environments/runtime";

/**
 * Keeps the repository-aware PR projection warm for contextual badges even
 * when the dedicated inbox route has never been opened.
 */
export function PullRequestInboxBootstrap() {
  const pullRequestState = usePullRequestStore();
  const aiConfiguration = useSettings((settings) => settings.pullRequestAi);
  const scheduledEnvironmentIdsRef = useRef(new Set<string>());
  const scheduledAttemptAtByEnvironmentRef = useRef(new Map<string, number>());
  useEffect(() => {
    const active = new Map<
      string,
      {
        readonly connection: ReturnType<typeof listEnvironmentConnections>[number];
        readonly unsubscribe: () => void;
        readonly unsubscribeAi: () => void;
      }
    >();

    const sync = () => {
      const connections = listEnvironmentConnections();

      for (const [environmentId, subscription] of active) {
        const connection = connections.find(
          (candidate) => candidate.environmentId === environmentId,
        );
        if (connection === subscription.connection) continue;
        subscription.unsubscribe();
        subscription.unsubscribeAi();
        active.delete(environmentId);
        markPullRequestEnvironmentStale(subscription.connection.environmentId);
        markPullRequestAiEnvironmentStale(subscription.connection.environmentId);
      }

      for (const connection of connections) {
        if (active.has(connection.environmentId)) continue;
        const environmentId = connection.environmentId;
        const unsubscribe = connection.client.pullRequests.subscribeInbox(
          (snapshot) => applyPullRequestSnapshot(environmentId, snapshot),
          {
            onResubscribe: () => markPullRequestEnvironmentStale(environmentId),
            onError: () => markPullRequestEnvironmentStale(environmentId),
          },
        );
        const unsubscribeAi = connection.client.pullRequests.subscribeAi(
          (snapshot) => applyPullRequestAiSnapshot(environmentId, snapshot),
          {
            onResubscribe: () => markPullRequestAiEnvironmentStale(environmentId),
            onError: () => markPullRequestAiEnvironmentStale(environmentId),
          },
        );
        active.set(environmentId, { connection, unsubscribe, unsubscribeAi });
      }
    };

    sync();
    const unsubscribeConnections = subscribeEnvironmentConnections(sync);
    return () => {
      unsubscribeConnections();
      for (const subscription of active.values()) {
        subscription.unsubscribe();
        subscription.unsubscribeAi();
      }
      active.clear();
    };
  }, []);

  useEffect(() => {
    if (!aiConfiguration.backgroundEnabled) return;

    const runDueAnalysis = () => {
      const now = Date.now();
      const items = selectFederatedPullRequests(pullRequestState);

      for (const connection of listEnvironmentConnections()) {
        const environmentId = connection.environmentId;
        if (scheduledEnvironmentIdsRef.current.has(environmentId)) continue;
        const lastAttemptAt = scheduledAttemptAtByEnvironmentRef.current.get(environmentId);
        const aiEnvironment = pullRequestState.aiEnvironmentById[environmentId];
        if (aiEnvironment && Option.isSome(aiEnvironment.currentRun)) continue;
        if (
          !isPullRequestAiScheduleDue({
            configuration: aiConfiguration,
            lastSuccessAt: aiEnvironment?.lastSuccessAt,
            lastAttemptAt,
            now,
          })
        ) {
          continue;
        }

        const candidates = selectScheduledPullRequestCandidates({
          environmentId,
          items,
          configuration: aiConfiguration,
          now,
        });
        if (candidates.length === 0) continue;

        scheduledEnvironmentIdsRef.current.add(environmentId);
        scheduledAttemptAtByEnvironmentRef.current.set(environmentId, now);
        void connection.client.pullRequests
          .analyze({
            pullRequestIds: candidates.map((item) => item.pullRequest.identity.id),
            modelSelection: aiConfiguration.modelSelection,
            scope: "scheduled",
            resourceMode: aiConfiguration.resourceMode,
            maxDeepAnalyses: aiConfiguration.maxDeepAnalyses,
          })
          .catch((error: unknown) => {
            console.warn("[PULL_REQUEST_AI] Scheduled analysis failed", error);
          })
          .finally(() => {
            scheduledEnvironmentIdsRef.current.delete(environmentId);
          });
      }
    };

    runDueAnalysis();
    const interval = window.setInterval(runDueAnalysis, 60_000);
    return () => window.clearInterval(interval);
  }, [aiConfiguration, pullRequestState]);

  return null;
}
