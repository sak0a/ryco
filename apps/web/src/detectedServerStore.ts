import { create } from "zustand";
import type { DetectedServer, DetectedServerEvent } from "@ryco/contracts";
import { LineBuffer } from "@ryco/shared/lineBuffer";

const MAX_LOG_LINES = 5000;

interface State {
  serversByThreadKey: Record<string, Map<string, DetectedServer>>;
  logBuffersByServerId: Map<string, LineBuffer>;
  activeServerIdByThreadKey: Record<string, string | null>;
  handleEvent: (threadKey: string, event: DetectedServerEvent) => void;
  setActive: (threadKey: string, serverId: string | null) => void;
  __reset: () => void;
}

export const useDetectedServerStore = create<State>((set, get) => ({
  serversByThreadKey: {},
  logBuffersByServerId: new Map(),
  activeServerIdByThreadKey: {},

  handleEvent: (threadKey, event) => {
    const next = { ...get().serversByThreadKey };
    const map = new Map(next[threadKey] ?? []);
    const logs = new Map(get().logBuffersByServerId);

    if (event.type === "registered") {
      map.set(event.server.id, event.server);
      if (!logs.has(event.server.id)) {
        logs.set(event.server.id, new LineBuffer({ maxLines: MAX_LOG_LINES }));
      }
    } else if (event.type === "updated") {
      const existing = map.get(event.serverId);
      if (existing) {
        const cleanPatch = Object.fromEntries(
          Object.entries(event.patch).filter(([, v]) => v !== undefined),
        ) as Partial<DetectedServer>;
        map.set(event.serverId, { ...existing, ...cleanPatch });
      }
    } else if (event.type === "log") {
      const buf = logs.get(event.serverId);
      buf?.write(event.data);
    } else if (event.type === "removed") {
      map.delete(event.serverId);
      logs.delete(event.serverId);
    }

    next[threadKey] = map;
    set({ serversByThreadKey: next, logBuffersByServerId: logs });
  },

  setActive: (threadKey, serverId) =>
    set({
      activeServerIdByThreadKey: { ...get().activeServerIdByThreadKey, [threadKey]: serverId },
    }),

  __reset: () =>
    set({
      serversByThreadKey: {},
      logBuffersByServerId: new Map(),
      activeServerIdByThreadKey: {},
    }),
}));
