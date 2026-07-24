import type { SocketService } from "@ryco/client-runtime/platform";

// React Native provides a global WebSocket. Mirror the web adapter: normalize
// the protocols argument to what the constructor accepts.
export const mobileSocket: SocketService = {
  webSocketConstructor: (url, protocols) => {
    const normalizedProtocols =
      typeof protocols === "string" || protocols === undefined ? protocols : Array.from(protocols);
    return new globalThis.WebSocket(url, normalizedProtocols);
  },
};
