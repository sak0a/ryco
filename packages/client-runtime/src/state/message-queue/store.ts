import { create } from "zustand";

import { moveQueuedMessage, removeQueuedMessage, type QueuedMessage } from "./logic.ts";

export interface MessageQueueState<Composer = unknown, Settings = unknown> {
  readonly queuesByThreadKey: Record<string, QueuedMessage<Composer, Settings>[]>;
  readonly steeringIdsByThreadKey: Record<string, string[]>;
  readonly enqueue: (threadKey: string, message: QueuedMessage<Composer, Settings>) => void;
  readonly remove: (threadKey: string, id: string) => void;
  readonly move: (threadKey: string, id: string, direction: "up" | "down") => void;
  readonly dequeue: (threadKey: string) => void;
  readonly clear: (threadKey: string) => void;
  readonly beginSteer: (threadKey: string, id: string) => void;
  readonly endSteer: (threadKey: string, id: string) => void;
}

export function createMessageQueueStore<Composer = unknown, Settings = unknown>() {
  return create<MessageQueueState<Composer, Settings>>((set) => ({
    queuesByThreadKey: {},
    steeringIdsByThreadKey: {},
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
        const steeringIds = state.steeringIdsByThreadKey[threadKey] ?? [];
        return {
          queuesByThreadKey: {
            ...state.queuesByThreadKey,
            [threadKey]: removeQueuedMessage(current, id),
          },
          steeringIdsByThreadKey: {
            ...state.steeringIdsByThreadKey,
            [threadKey]: steeringIds.filter((entry) => entry !== id),
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
        return { queuesByThreadKey: { ...state.queuesByThreadKey, [threadKey]: current.slice(1) } };
      }),
    clear: (threadKey) =>
      set((state) => {
        if (!(threadKey in state.queuesByThreadKey)) return state;
        const queuesByThreadKey = { ...state.queuesByThreadKey };
        const steeringIdsByThreadKey = { ...state.steeringIdsByThreadKey };
        delete queuesByThreadKey[threadKey];
        delete steeringIdsByThreadKey[threadKey];
        return { queuesByThreadKey, steeringIdsByThreadKey };
      }),
    beginSteer: (threadKey, id) =>
      set((state) => {
        const current = state.steeringIdsByThreadKey[threadKey] ?? [];
        if (current.includes(id)) return state;
        return {
          steeringIdsByThreadKey: {
            ...state.steeringIdsByThreadKey,
            [threadKey]: [...current, id],
          },
        };
      }),
    endSteer: (threadKey, id) =>
      set((state) => {
        const current = state.steeringIdsByThreadKey[threadKey];
        if (!current?.includes(id)) return state;
        return {
          steeringIdsByThreadKey: {
            ...state.steeringIdsByThreadKey,
            [threadKey]: current.filter((entry) => entry !== id),
          },
        };
      }),
  }));
}
