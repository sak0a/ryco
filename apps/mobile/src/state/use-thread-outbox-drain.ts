import { useEffect, useRef } from "react";

import { getWsConnectionStatus, getWsConnectionUiState } from "@ryco/client-runtime/rpc";
import { scopeThreadRef } from "@ryco/client-runtime/scoped";
import {
  IMAGE_ONLY_BOOTSTRAP_PROMPT,
  commitSendTurnDispatch,
} from "@ryco/client-runtime/state/composer";

import { ensureEnvironmentApi } from "../connection/environmentApi";
import { newCommandId } from "../lib/ids";
import { drainThreadOutbox, hydrateThreadOutbox } from "./threadOutbox";
import { buildQueuedThreadMessageAttachments } from "./queuedThreadMessageAttachments";
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
  const turnAttachments = await buildQueuedThreadMessageAttachments(message);
  await commitSendTurnDispatch({
    api,
    threadId: message.threadId,
    isFirstMessage: false,
    isServerThread: true,
    title: "",
    messageId: message.messageId,
    outgoingMessageText: message.text.trim() || IMAGE_ONLY_BOOTSTRAP_PROMPT,
    turnAttachments,
    modelSelection: message.modelSelection,
    hasSelectedModel: true,
    runtimeMode: message.runtimeMode,
    interactionMode: message.interactionMode,
    tokenMode: message.tokenMode ?? "balanced",
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
  readonly alreadyDelivered: boolean;
  readonly deliveryReconciled: boolean;
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
    threadBusy: summary?.latestTurn?.state === "running" || thread?.latestTurn?.state === "running",
    alreadyDelivered: thread?.messages.some((entry) => entry.id === message.messageId) ?? false,
    deliveryReconciled: thread !== undefined,
  };
}

function runOutboxDrain(): void {
  void drainThreadOutbox({
    readThreadDeliveryState,
    sendQueuedMessage: sendQueuedThreadMessage,
  });
}

/**
 * Drain the outbox whenever the threads store changes — a message that waited
 * because its thread was mid-turn (§3-14) must be delivered when that thread
 * SETTLES (latestTurn no longer running / pending cleared), not only on the next
 * socket reconnect. Returns an unsubscribe. Exported for testing; the debounce
 * coalesces the store's per-event notifications.
 */
export function subscribeOutboxSettleDrain(runDrain: () => void, debounceMs = 50): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = useStore.subscribe(() => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      runDrain();
    }, debounceMs);
  });
  return () => {
    if (timer !== null) clearTimeout(timer);
    unsubscribe();
  };
}

/**
 * Mount point (RootStackLayout): hydrate the persisted outbox once, then drain it
 * whenever the socket reaches "connected" OR a thread settles — the offline outbox
 * drains on reconnect AND on turn-settle (spec §Bundling / §3-14). A bound wrapper;
 * no import-time side effects.
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
    runOutboxDrain();
  }, [wsStatus.phase]);

  // Settle-edge: drain when a thread's turn settles while queued messages wait.
  useEffect(() => subscribeOutboxSettleDrain(runOutboxDrain), []);
}
