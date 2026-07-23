import type { SocketService } from "@ryco/client-runtime/platform";

export const webSocket: SocketService = {
  webSocketConstructor: (url, protocols) => {
    const normalizedProtocols =
      typeof protocols === "string" || protocols === undefined ? protocols : Array.from(protocols);
    return new globalThis.WebSocket(url, normalizedProtocols);
  },
};
