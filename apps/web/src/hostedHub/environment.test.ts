import { EnvironmentId } from "@ryco/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { useCommandPaletteStore } from "../commandPaletteStore";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useMessageQueueStore } from "../messageQueueStore";
import { useSettingsDialogStore } from "../settingsDialogStore";
import { useStore } from "../store";
import { useTerminalStateStore } from "../terminalStateStore";
import { useUiStateStore } from "../uiStateStore";
import type { HostedHubNode } from "./types";

const {
  connectPrimaryEnvironment,
  disconnectPrimaryEnvironment,
  resetHostedRelayAttemptFactory,
  writePrimaryEnvironmentDescriptor,
} = vi.hoisted(() => ({
  connectPrimaryEnvironment: vi.fn(),
  disconnectPrimaryEnvironment: vi.fn(async () => undefined),
  resetHostedRelayAttemptFactory: vi.fn(),
  writePrimaryEnvironmentDescriptor: vi.fn(),
}));

vi.mock("../environments/runtime/service", () => ({
  connectPrimaryEnvironment,
  disconnectPrimaryEnvironment,
}));
vi.mock("../environments/primary", () => ({ writePrimaryEnvironmentDescriptor }));
vi.mock("./transport", () => ({ resetHostedRelayAttemptFactory }));

import {
  activateHostedNode,
  clearHostedNodeScopedState,
  deactivateHostedNode,
  suspendHostedNode,
} from "./environment";

const environmentId = EnvironmentId.make("env_aaaaaaaaaaaaaaaaaaaaaa");

afterEach(async () => {
  await deactivateHostedNode(environmentId);
  clearHostedNodeScopedState(environmentId);
  vi.clearAllMocks();
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

  it("preserves node-scoped UI state during same-node relay recovery", async () => {
    const selectedNode: HostedHubNode = {
      id: "node_aaaaaaaaaaaaaaaaaaaaaa",
      environmentId,
      label: "Node",
      platformOs: "linux",
      platformArch: "x64",
      clientVersion: "0.9.0",
      createdAt: 1,
      updatedAt: 1,
      lastAuthenticatedAt: 1,
      revokedAt: null,
      revocationReasonCode: null,
      grant: { id: "grant_aaaaaaaaaaaaaaaaaaaaaa", role: "operator" },
      effectiveRole: "operator",
      presence: { online: true, lastHeartbeatAt: 1 },
    };
    await activateHostedNode(selectedNode, null);
    useComposerDraftStore.getState().setPrompt(DraftId.make("draft-thread"), "unsent prompt");
    useTerminalStateStore.setState({
      terminalStateByThreadKey: { retainedThread: {} as never },
      terminalLaunchContextByThreadKey: {},
      terminalEventEntriesByKey: { retainedThread: [] },
    });
    useMessageQueueStore.setState({ queuesByThreadKey: { retainedThread: [] } });
    useUiStateStore.setState({ pinnedThreadKeys: { retainedThread: true } });

    await activateHostedNode(selectedNode, environmentId);

    expect(Object.values(useComposerDraftStore.getState().draftsByThreadKey)).toContainEqual(
      expect.objectContaining({ prompt: "unsent prompt" }),
    );
    expect(useTerminalStateStore.getState().terminalStateByThreadKey).toHaveProperty(
      "retainedThread",
    );
    expect(useMessageQueueStore.getState().queuesByThreadKey).toHaveProperty("retainedThread");
    expect(useUiStateStore.getState().pinnedThreadKeys).toHaveProperty("retainedThread", true);
    expect(resetHostedRelayAttemptFactory).toHaveBeenCalledOnce();
    expect(disconnectPrimaryEnvironment).toHaveBeenCalledOnce();
    expect(connectPrimaryEnvironment).toHaveBeenCalledTimes(2);
  });

  it("suspends hosted transport idempotently without clearing same-node presentation state", async () => {
    const selectedNode: HostedHubNode = {
      id: "node_aaaaaaaaaaaaaaaaaaaaaa",
      environmentId,
      label: "Node",
      platformOs: "linux",
      platformArch: "x64",
      clientVersion: "0.9.0",
      createdAt: 1,
      updatedAt: 1,
      lastAuthenticatedAt: 1,
      revokedAt: null,
      revocationReasonCode: null,
      grant: { id: "grant_aaaaaaaaaaaaaaaaaaaaaa", role: "operator" },
      effectiveRole: "operator",
      presence: { online: true, lastHeartbeatAt: 1 },
    };
    await activateHostedNode(selectedNode, null);
    useComposerDraftStore.getState().setPrompt(DraftId.make("draft-thread"), "unsent prompt");
    vi.clearAllMocks();

    await Promise.all([
      suspendHostedNode(environmentId),
      suspendHostedNode(environmentId),
      suspendHostedNode(environmentId),
    ]);

    expect(resetHostedRelayAttemptFactory).toHaveBeenCalledOnce();
    expect(disconnectPrimaryEnvironment).toHaveBeenCalledOnce();
    expect(writePrimaryEnvironmentDescriptor).not.toHaveBeenCalled();
    expect(Object.values(useComposerDraftStore.getState().draftsByThreadKey)).toContainEqual(
      expect.objectContaining({ prompt: "unsent prompt" }),
    );

    await activateHostedNode(selectedNode, environmentId);
    expect(resetHostedRelayAttemptFactory).toHaveBeenCalledOnce();
    expect(disconnectPrimaryEnvironment).toHaveBeenCalledOnce();
    expect(connectPrimaryEnvironment).toHaveBeenCalledOnce();
  });
});
