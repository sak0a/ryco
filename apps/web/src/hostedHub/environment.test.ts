import { EnvironmentId } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import { useCommandPaletteStore } from "../commandPaletteStore";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useMessageQueueStore } from "../messageQueueStore";
import { useSettingsDialogStore } from "../settingsDialogStore";
import { useStore } from "../store";
import { useTerminalStateStore } from "../terminalStateStore";
import { useUiStateStore } from "../uiStateStore";
import { clearWebHostedNodeScopedState } from "./environment";

/**
 * The browser/UI clearing catalog. The core transition queue owns the call
 * ordering (see the package `environment.test.ts`); this suite covers only the
 * web store sweep the catalog performs when the core asks it to clear
 * node-scoped state.
 */

const environmentId = EnvironmentId.make("env_aaaaaaaaaaaaaaaaaaaaaa");

describe("clearWebHostedNodeScopedState", () => {
  it("clears projections, queues, drafts, terminals, UI state, and pending dialogs", () => {
    useStore.setState({ activeEnvironmentId: environmentId });
    useComposerDraftStore.getState().setPrompt(DraftId.make("sensitiveThread"), "sensitive prompt");
    useTerminalStateStore.setState({
      terminalStateByThreadKey: { sensitiveThread: {} as never },
      terminalLaunchContextByThreadKey: { sensitiveThread: {} as never },
      terminalEventEntriesByKey: { sensitiveThread: [] },
    });
    useMessageQueueStore.setState({ queuesByThreadKey: { sensitiveThread: [] } });
    useUiStateStore.setState({
      projectOrder: ["sensitiveProject"],
      pinnedThreadKeys: { sensitiveThread: true },
    });
    useCommandPaletteStore.getState().openAddProject();
    useSettingsDialogStore.getState().openSettings("providers");

    clearWebHostedNodeScopedState(environmentId);

    expect(useStore.getState().activeEnvironmentId).toBeNull();
    expect(useComposerDraftStore.getState()).toMatchObject({
      draftsByThreadKey: {},
      draftThreadsByThreadKey: {},
      logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    });
    expect(useTerminalStateStore.getState()).toMatchObject({
      terminalStateByThreadKey: {},
      terminalLaunchContextByThreadKey: {},
      terminalEventEntriesByKey: {},
    });
    expect(useMessageQueueStore.getState().queuesByThreadKey).toEqual({});
    expect(useUiStateStore.getState()).toMatchObject({ projectOrder: [], pinnedThreadKeys: {} });
    expect(useCommandPaletteStore.getState()).toMatchObject({ open: false, openIntent: null });
    expect(useSettingsDialogStore.getState().open).toBe(false);
  });
});
