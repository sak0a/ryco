import type { EnvironmentId, ExecutionEnvironmentDescriptor } from "@ryco/contracts";

import { useComposerDraftStore } from "../composerDraftStore";
import { useCommandPaletteStore } from "../commandPaletteStore";
import {
  connectPrimaryEnvironment,
  disconnectPrimaryEnvironment,
} from "../environments/runtime/service";
import { writePrimaryEnvironmentDescriptor } from "../environments/primary";
import { useMessageQueueStore } from "../messageQueueStore";
import { setModelPickerOpen } from "../modelPickerOpenState";
import { clearKeyedQueriesForEnvironment } from "../rpc/keyedQuery";
import { clearProjectAtomState } from "../rpc/projectAtoms";
import { clearGitAtomState } from "../rpc/gitAtoms";
import { clearOverviewAtomState } from "../rpc/overviewAtoms";
import { clearCheckpointDiffState } from "../rpc/providerAtoms";
import { defaultQueryClient } from "../rpc/queryClient";
import { clearServerState } from "../rpc/serverState";
import { useStore } from "../store";
import { useSettingsDialogStore } from "../settingsDialogStore";
import { clearShortcutModifierState } from "../shortcutModifierState";
import { useTerminalStateStore } from "../terminalStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { useUiStateStore } from "../uiStateStore";
import { resetHostedRelayAttemptFactory } from "./transport";
import type { HostedHubNode } from "./types";

function descriptorForNode(node: HostedHubNode): ExecutionEnvironmentDescriptor {
  return {
    environmentId: node.environmentId,
    label: node.label,
    platform: { os: node.platformOs, arch: node.platformArch },
    serverVersion: node.clientVersion,
    capabilities: { repositoryIdentity: false },
  };
}

export function clearHostedNodeScopedState(environmentId: EnvironmentId): void {
  clearKeyedQueriesForEnvironment(environmentId);
  clearProjectAtomState();
  clearGitAtomState();
  clearOverviewAtomState();
  clearCheckpointDiffState();
  useStore.getState().removeEnvironmentState(environmentId);
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    stickyModelSelectionByProvider: {},
    stickyActiveProvider: null,
  });
  useTerminalStateStore.setState({
    terminalStateByThreadKey: {},
    terminalLaunchContextByThreadKey: {},
    terminalEventEntriesByKey: {},
    nextTerminalEventId: 1,
  });
  useMessageQueueStore.setState({ queuesByThreadKey: {} });
  useCommandPaletteStore.getState().setOpen(false);
  useSettingsDialogStore.getState().closeSettings();
  setModelPickerOpen(false);
  clearShortcutModifierState();
  useThreadSelectionStore.getState().clearSelection();
  useUiStateStore.setState({
    projectExpandedById: {},
    projectOrder: [],
    projectFoldersById: {},
    projectFolderOrder: [],
    projectTreeOrder: [],
    pinnedThreadKeys: {},
    threadLastVisitedAtById: {},
    threadChangedFilesExpandedById: {},
    threadWorkEntryExpandedById: {},
    defaultAdvertisedEndpointKey: null,
  });
  defaultQueryClient.clear();
  clearServerState();
}

let activeHostedEnvironmentId: EnvironmentId | null = null;
let transition: Promise<void> = Promise.resolve();

function enqueueTransition(work: () => Promise<void>): Promise<void> {
  const next = transition.catch(() => undefined).then(work);
  transition = next.catch(() => undefined);
  return next;
}

async function deactivateCurrentHostedNode(environmentId: EnvironmentId): Promise<void> {
  resetHostedRelayAttemptFactory();
  await disconnectPrimaryEnvironment();
  clearHostedNodeScopedState(environmentId);
  writePrimaryEnvironmentDescriptor(null);
  if (activeHostedEnvironmentId === environmentId) activeHostedEnvironmentId = null;
}

export async function deactivateHostedNode(environmentId: EnvironmentId): Promise<void> {
  await enqueueTransition(async () => {
    await deactivateCurrentHostedNode(activeHostedEnvironmentId ?? environmentId);
  });
}

export async function activateHostedNode(
  node: HostedHubNode,
  previousEnvironmentId: EnvironmentId | null,
): Promise<void> {
  await enqueueTransition(async () => {
    const previous = activeHostedEnvironmentId ?? previousEnvironmentId;
    if (previous) {
      await deactivateCurrentHostedNode(previous);
    }
    writePrimaryEnvironmentDescriptor(descriptorForNode(node));
    useStore.getState().setActiveEnvironmentId(node.environmentId);
    activeHostedEnvironmentId = node.environmentId;
    connectPrimaryEnvironment();
  });
}
