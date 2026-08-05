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
import { resetWebE2eeSession } from "./e2eeSession";

/** Browser/UI clearing catalog only. Core lifecycle owns the call ordering. */
export function clearWebHostedNodeScopedState(environmentId: EnvironmentId): void {
  // docs/relay-e2ee-protocol.md §13's per-channel projection is node-scoped and
  // belongs here: a status that outlives the channel that earned it describes a
  // connection that no longer exists.
  //
  // §12.1'S LATCH DELIBERATELY DOES NOT. It is APPLICATION-SESSION state, and
  // this catalog runs on every node teardown — `deactivateCurrentHostedNode`
  // calls it on the node being left, including on the A→B switch that
  // `activateHostedNode` performs. Clearing here therefore returned every
  // already-latched selection to `legacy-eligible`, which RELAXES §12.1.1's
  // classification rather than tightening it: a Hub that then withholds the §5.3
  // carrier past `T_ADV` takes row K13 instead of row K14, and the buffered
  // application sends go onto the relay as plaintext on a selection that had
  // already proven the node speaks §4 in this same session. The latch ends where
  // §12.1 says it ends — with the application session — and
  // `watchWebHostedSessionForE2ee` is what ends it, on sign-out.
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
