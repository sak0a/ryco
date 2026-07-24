import type { AppLifecycleEvent, AppLifecycleService } from "@ryco/client-runtime/platform";
import * as Network from "expo-network";
import { AppState, type AppStateStatus } from "react-native";

// iOS suspends WebSockets on background and the runtime only models resume via
// AppLifecycle "resume" + the supervisor's reconnectAfterResume heartbeat. So
// the mobile adapter drives resume aggressively: every foreground transition
// emits BOTH "foreground" and "resume" so the supervisor re-checks and
// reconnects the socket the OS tore down while backgrounded.

// Cached connectivity so the synchronous `isOnline()` contract can be answered
// without awaiting a network probe. Optimistically online until proven offline.
let cachedOnline = true;

function isConnected(state: Network.NetworkState): boolean {
  // `undefined` (unknown) is treated as online: the runtime prefers attempting
  // a connection over refusing one on an ambiguous signal.
  return state.isConnected !== false;
}

export const mobileAppLifecycle: AppLifecycleService = {
  isForeground: () => AppState.currentState === "active",
  isOnline: () => cachedOnline,
  subscribe: (listener) => {
    let lastForeground = AppState.currentState === "active";

    const emit = (event: AppLifecycleEvent) => listener(event);

    const appStateSubscription = AppState.addEventListener("change", (next: AppStateStatus) => {
      const nowForeground = next === "active";
      if (nowForeground && !lastForeground) {
        emit("foreground");
        emit("resume");
      } else if (!nowForeground && lastForeground) {
        emit("background");
      }
      lastForeground = nowForeground;
    });

    const networkSubscription = Network.addNetworkStateListener((state) => {
      const online = isConnected(state);
      if (online !== cachedOnline) {
        cachedOnline = online;
        emit(online ? "online" : "offline");
      }
    });

    // Refresh the cached connectivity once on subscribe without blocking.
    void Network.getNetworkStateAsync()
      .then((state) => {
        cachedOnline = isConnected(state);
      })
      .catch(() => undefined);

    return () => {
      appStateSubscription.remove();
      networkSubscription.remove();
    };
  },
};
