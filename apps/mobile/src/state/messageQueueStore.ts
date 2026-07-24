import { createMessageQueueStore } from "@ryco/client-runtime/state/message-queue";

export * from "@ryco/client-runtime/state/message-queue";

// Per-thread message queue (in-memory; survives thread switches within a session,
// drains on reconnect). Not persisted — queued items reference live attachments.
export const useMessageQueueStore = createMessageQueueStore();
