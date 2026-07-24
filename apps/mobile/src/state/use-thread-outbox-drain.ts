import { useEffect, useRef } from "react";

import { getWsConnectionStatus, getWsConnectionUiState } from "@ryco/client-runtime/rpc";
import { scopeThreadRef } from "@ryco/client-runtime/scoped";
import {
  buildSendTurnDispatchAttachment,
  commitSendTurnDispatch,
} from "@ryco/client-runtime/state/composer";

import { ensureEnvironmentApi } from "../connection/environmentApi";
import { newCommandId } from "../lib/ids";
import { mobileAttachmentCodec } from "../platform/attachmentCodec";
import { drainThreadOutbox, hydrateThreadOutbox } from "./threadOutbox";
import type { EnvironmentShellStatus, QueuedThreadMessage } from "./threadOutboxModel";
import {
  selectBootstrapCompleteForActiveEnvironment,
  selectSidebarThreadSummaryByRef,
  selectThreadByRef,
  useStore,
} from "./threadsRuntime";
import { useWsConnectionStatus } from "../rpc/wsConnectionState";

// §3-14: dispatch a queued turn for an EXISTING thread through the runtime send
// path. The queued item carries its own composer settings (captured at enqueue);
// a message missing them cannot be sent and is dropped by the drain caller.
async function sendQueuedThreadMessage(message: QueuedThreadMessage): Promise<void> {
  if (!message.modelSelection || !message.runtimeMode || !message.interactionMode) {
    throw new Error("Queued message is missing composer settings.");
  }
  const api = ensureEnvironmentApi(message.environmentId);
  const turnAttachments = await Promise.all(
    message.attachments.map(async (attachment) =>
      buildSendTurnDispatchAttachment({
        attachment: await mobileAttachmentCodec.encode({
          id: attachment.id,
          mime: attachment.mimeType,
          size: attachment.sizeBytes,
          uri: attachment.previewUri,
        }),
        name: attachment.name,
      }),
    ),
  );
  await commitSendTurnDispatch({
    api,
    threadId: message.threadId,
    isFirstMessage: false,
    isServerThread: true,
    title: "",
    messageId: message.messageId,
    outgoingMessageText: message.text,
    turnAttachments,
    modelSelection: message.modelSelection,
    hasSelectedModel: true,
    runtimeMode: message.runtimeMode,
    interactionMode: message.interactionMode,
    tokenMode: "balanced",
    bootstrap: undefined,
    sourceControlContexts: [],
    createdAt: message.createdAt,
    newCommandId,
    beginLocalDispatch: () => {},
    persistThreadSettingsForNextTurn: () => Promise.resolve(),
  });
}

function readThreadDeliveryState(message: QueuedThreadMessage): {
  readonly threadExists: boolean;
  readonly shellStatus: EnvironmentShellStatus;
  readonly environmentConnected: boolean;
  readonly threadBusy: boolean;
} {
  const state = useStore.getState();
  const ref = scopeThreadRef(message.environmentId, message.threadId);
  const summary = selectSidebarThreadSummaryByRef(state, ref);
  const thread = selectThreadByRef(state, ref);
  const connected = getWsConnectionUiState(getWsConnectionStatus()) === "connected";
  return {
    threadExists: Boolean(summary ?? thread),
    shellStatus: selectBootstrapCompleteForActiveEnvironment(state) ? "live" : "loading",
    environmentConnected: connected,
    threadBusy:
      summary?.latestTurn?.state === "running" || thread?.latestTurn?.state === "running",
  };
}

/**
 * Mount point (RootStackLayout): hydrate the persisted outbox once, then drain it
 * whenever the socket reaches "connected" — the offline outbox drains on reconnect
 * (spec §Bundling). A bound wrapper; no import-time side effects.
 */
export function useThreadOutboxDrain(): void {
  const wsStatus = useWsConnectionStatus();
  const previousPhaseRef = useRef<string | null>(null);

  useEffect(() => {
    void hydrateThreadOutbox();
  }, []);

  useEffect(() => {
    const wasConnected = previousPhaseRef.current === "connected";
    previousPhaseRef.current = wsStatus.phase;
    if (wsStatus.phase !== "connected" || wasConnected) return;
    void drainThreadOutbox({
      readThreadDeliveryState,
      sendQueuedMessage: sendQueuedThreadMessage,
    });
  }, [wsStatus.phase]);
}
