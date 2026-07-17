import { EnvironmentId } from "@ryco/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { useCommandPaletteStore } from "../commandPaletteStore";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useMessageQueueStore } from "../messageQueueStore";
import { useSettingsDialogStore } from "../settingsDialogStore";
import { useStore } from "../store";
import { useTerminalStateStore } from "../terminalStateStore";
import { useUiStateStore } from "../uiStateStore";
import { clearHostedNodeScopedState } from "./environment";

const environmentId = EnvironmentId.make("env_aaaaaaaaaaaaaaaaaaaaaa");

afterEach(() => {
  clearHostedNodeScopedState(environmentId);
});

describe("hosted node cleanup", () => {
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

    clearHostedNodeScopedState(environmentId);

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
