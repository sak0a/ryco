import {
  activateHostedNode,
  clearHostedNodeScopedState as clearCoreHostedNodeScopedState,
  deactivateHostedNode,
  suspendHostedNode,
} from "@ryco/client-runtime/authorization";
import type { EnvironmentId } from "@ryco/contracts";

import { useComposerDraftStore } from "../composerDraftStore";
import { useCommandPaletteStore } from "../commandPaletteStore";
import { useMessageQueueStore } from "../messageQueueStore";
import { setModelPickerOpen } from "../modelPickerOpenState";
import { clearKeyedQueriesForEnvironment } from "../rpc/keyedQuery";
import { clearProjectAtomState } from "../rpc/projectAtoms";
import { clearGitAtomState } from "../rpc/gitAtoms";
import { clearOverviewAtomState } from "../rpc/overviewAtoms";
import { clearCheckpointDiffState } from "../rpc/providerAtoms";
import { defaultQueryClient } from "../rpc/queryClient";
import { clearServerState } from "../rpc/serverState";
import { useSettingsDialogStore } from "../settingsDialogStore";
import { clearShortcutModifierState } from "../shortcutModifierState";
import { useStore } from "../store";
import { useTerminalStateStore } from "../terminalStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { useUiStateStore } from "../uiStateStore";

/** Browser/UI clearing catalog only. Core lifecycle owns the call ordering. */
export function clearWebHostedNodeScopedState(environmentId: EnvironmentId): void {
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

export {
  activateHostedNode,
  deactivateHostedNode,
  suspendHostedNode,
  clearCoreHostedNodeScopedState as clearHostedNodeScopedState,
};
