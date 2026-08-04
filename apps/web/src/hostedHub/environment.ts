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
import { clearWebE2eeLatches } from "./e2eeLatch";
import { resetWebE2eeSession } from "./e2eeSession";

/** Browser/UI clearing catalog only. Core lifecycle owns the call ordering. */
export function clearWebHostedNodeScopedState(environmentId: EnvironmentId): void {
  // docs/relay-e2ee-protocol.md §12.1: the web latch is in-memory application-
  // session state and nothing more, so it is cleared with the rest of the
  // node-scoped state rather than kept alive across a teardown — and §13's
  // per-channel projection goes with it, because a status that outlives the
  // channel that earned it describes a connection that no longer exists.
  clearWebE2eeLatches();
  resetWebE2eeSession();
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
