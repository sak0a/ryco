import { create } from "zustand";

import { moveQueuedMessage, removeQueuedMessage, type QueuedMessage } from "./messageQueue.logic";

// ---------------------------------------------------------------------------
// Per-thread message queue store (in-memory, keyed by scoped thread key).
//
// Intentionally NOT persisted: queued items hold live `File`/blob references
// that can't survive a reload. It does survive thread switches within a session
// (module-level store), which is the required behavior.
// ---------------------------------------------------------------------------

interface MessageQueueState {
  queuesByThreadKey: Record<string, QueuedMessage[]>;
  enqueue: (threadKey: string, message: QueuedMessage) => void;
  remove: (threadKey: string, id: string) => void;
  move: (threadKey: string, id: string, direction: "up" | "down") => void;
  /** Remove and forget the head of the queue (its content is being dispatched). */
  dequeue: (threadKey: string) => void;
  clear: (threadKey: string) => void;
}

export const useMessageQueueStore = create<MessageQueueState>((set) => ({
  queuesByThreadKey: {},
  enqueue: (threadKey, message) =>
    set((state) => ({
      queuesByThreadKey: {
        ...state.queuesByThreadKey,
        [threadKey]: [...(state.queuesByThreadKey[threadKey] ?? []), message],
      },
    })),
  remove: (threadKey, id) =>
    set((state) => {
      const current = state.queuesByThreadKey[threadKey];
      if (!current) return state;
      return {
        queuesByThreadKey: {
          ...state.queuesByThreadKey,
          [threadKey]: removeQueuedMessage(current, id),
        },
      };
    }),
  move: (threadKey, id, direction) =>
    set((state) => {
      const current = state.queuesByThreadKey[threadKey];
      if (!current) return state;
      return {
        queuesByThreadKey: {
          ...state.queuesByThreadKey,
          [threadKey]: moveQueuedMessage(current, id, direction),
        },
      };
    }),
  dequeue: (threadKey) =>
    set((state) => {
      const current = state.queuesByThreadKey[threadKey];
      if (!current || current.length === 0) return state;
      return {
        queuesByThreadKey: {
          ...state.queuesByThreadKey,
          [threadKey]: current.slice(1),
        },
      };
    }),
  clear: (threadKey) =>
    set((state) => {
      if (!(threadKey in state.queuesByThreadKey)) return state;
      const next = { ...state.queuesByThreadKey };
      delete next[threadKey];
      return { queuesByThreadKey: next };
    }),
}));
