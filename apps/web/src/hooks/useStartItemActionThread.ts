import { scopedProjectKey, scopeProjectRef } from "@ryco/client-runtime";
import type {
  ComposerSourceControlContext,
  ComposerWorkItemContext,
  CreateWorktreeIntent,
  EnvironmentId,
  ItemActionWorkspacePlan,
  ProjectId,
  SourceControlChangeRequestDetail,
  SourceControlIssueDetail,
  WorkItemDetail,
} from "@ryco/contracts";
import { DateTime } from "effect";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";

import { toastManager } from "../components/ui/toast";
import type { ItemAction } from "../components/projectExplorer/itemActions";
import { getPrCheckStatusFromChangeRequest } from "../components/projectExplorer/prCheckStatus";
import { useComposerDraftStore } from "../composerDraftStore";
import { readEnvironmentApi } from "../environmentApi";
import { buildItemActionPrompt } from "../itemActionPrompts";
import { randomUUID } from "../lib/utils";
import { deriveLogicalProjectKeyFromSettings } from "../logicalProject";
import { selectProjectsAcrossEnvironments, useStore } from "../store";
import { useNewThreadHandler } from "./useHandleNewThread";
import { useSettings } from "./useSettings";

export type StartItemActionInput =
  | {
      kind: "pull-request";
      action: ItemAction;
      detail: SourceControlChangeRequestDetail;
    }
  | {
      kind: "issue";
      action: ItemAction;
      detail: SourceControlIssueDetail;
    }
  | {
      kind: "work-item";
      action: ItemAction;
      detail: WorkItemDetail;
    };

function buildIntent(input: StartItemActionInput): CreateWorktreeIntent {
  switch (input.kind) {
    case "pull-request":
      return { kind: "pr", number: input.detail.number };
    case "issue":
      return {
        kind: "issue",
        number: input.detail.number,
        title: input.detail.title,
        body: input.detail.body,
      };
    case "work-item":
      return {
        kind: "workItem",
        provider: input.detail.provider,
        key: input.detail.key,
        title: input.detail.title,
        ...(input.detail.state !== undefined ? { state: input.detail.state } : {}),
        ...(input.detail.stateName !== undefined ? { stateName: input.detail.stateName } : {}),
        url: input.detail.url,
        body: input.detail.description,
      };
  }
}

function contextTimestamps() {
  return {
    fetchedAt: DateTime.fromDateUnsafe(new Date()),
    staleAfter: DateTime.fromDateUnsafe(new Date(Date.now() + 5 * 60 * 1000)),
  };
}

function workspaceOptionsForPlan(plan: ItemActionWorkspacePlan): {
  branch: string | null;
  worktreePath: string | null;
  envMode: "local" | "worktree";
} {
  switch (plan.kind) {
    case "reuse-worktree":
      return { branch: plan.branch, worktreePath: plan.worktreePath, envMode: "worktree" };
    case "local-main-checkout":
      return { branch: plan.branch, worktreePath: null, envMode: "local" };
    case "create-worktree":
      // The bootstrap's prepareWorkspace performs the real creation on
      // first send; the draft stays "local" so the standard worktree-mode
      // send path stays out of the way.
      return { branch: plan.plannedBranch ?? null, worktreePath: null, envMode: "local" };
  }
}

/**
 * Click handler for the needs-attention banner: resolves the workspace plan
 * (read-only), opens/reuses the project draft with a preset prompt, the item
 * attached as chat context, and the pending workspace intent that the send
 * bootstrap executes. Returns true when the draft was opened.
 */
export function useStartItemActionThread(scope: {
  environmentId: EnvironmentId | null;
  projectId: ProjectId | null;
}) {
  const { environmentId, projectId } = scope;
  const { handleNewThread } = useNewThreadHandler();
  const projects = useStore(useShallow((store) => selectProjectsAcrossEnvironments(store)));
  const projectGroupingSettings = useSettings((settings) => ({
    sidebarProjectGroupingMode: settings.sidebarProjectGroupingMode,
    sidebarProjectGroupingOverrides: settings.sidebarProjectGroupingOverrides,
    defaultAgentTokenMode: settings.defaultAgentTokenMode,
  }));

  return useCallback(
    async (input: StartItemActionInput): Promise<boolean> => {
      if (!projectId || !environmentId) {
        toastManager.add({ type: "error", title: "No project selected for this item." });
        return false;
      }
      const api = readEnvironmentApi(environmentId);
      const resolveActionWorkspace = api?.git.resolveActionWorkspace;
      if (!api || !resolveActionWorkspace) {
        toastManager.add({ type: "error", title: "Environment is not connected." });
        return false;
      }
      const intent = buildIntent(input);

      let plan: ItemActionWorkspacePlan;
      try {
        const resolved = await resolveActionWorkspace({ projectId, intent });
        plan = resolved.plan;
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        toastManager.add({ type: "error", title: `Couldn't resolve a workspace: ${message}` });
        return false;
      }

      const projectRef = scopeProjectRef(environmentId, projectId);
      const workspaceOptions = workspaceOptionsForPlan(plan);
      await handleNewThread(projectRef, workspaceOptions);

      const project = projects.find(
        (candidate) => candidate.id === projectId && candidate.environmentId === environmentId,
      );
      const logicalProjectKey = project
        ? deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings)
        : scopedProjectKey(projectRef);
      const store = useComposerDraftStore.getState();
      const draftSession = store.getDraftSessionByLogicalProjectKey(logicalProjectKey);
      if (!draftSession) {
        toastManager.add({ type: "error", title: "Couldn't open a draft thread." });
        return false;
      }
      const target = draftSession.draftId;

      store.setPrompt(
        target,
        buildItemActionPrompt({
          kind: input.action.kind,
          ...(input.kind === "pull-request" ? { baseBranch: input.detail.baseRefName } : {}),
          ...(input.kind === "pull-request" && input.action.kind === "pr-checks"
            ? {
                failingChecks: getPrCheckStatusFromChangeRequest(input.detail).failedChecks.map(
                  (check) => check.name,
                ),
              }
            : {}),
          reusesExistingCheckout: plan.kind !== "create-worktree",
        }),
      );

      if (input.kind === "work-item") {
        const context: ComposerWorkItemContext = {
          id: randomUUID(),
          provider: input.detail.provider,
          key: input.detail.key,
          detail: input.detail,
          ...contextTimestamps(),
        };
        store.addWorkItemContext(target, context);
      } else {
        const context: ComposerSourceControlContext = {
          id: randomUUID(),
          kind: input.kind === "pull-request" ? "change-request" : "issue",
          provider: input.detail.provider,
          reference: `${input.detail.provider}#${input.detail.number}`,
          detail: input.detail,
          ...contextTimestamps(),
        };
        store.addSourceControlContext(target, context);
      }

      store.setDraftThreadContext(target, {
        ...workspaceOptions,
        pendingWorkspace: { intent, plan },
      });

      return true;
    },
    [environmentId, projectId, handleNewThread, projects, projectGroupingSettings],
  );
}
