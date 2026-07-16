export interface HubRelaySocketEventMap {
  readonly open: Event;
  readonly message: MessageEvent<unknown>;
  readonly error: Event;
  readonly close: CloseEvent;
}

export interface HubRelaySocket {
  readonly bufferedAmount: number;
  readonly readyState: number;
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
  addEventListener<K extends keyof HubRelaySocketEventMap>(
    type: K,
    listener: (event: HubRelaySocketEventMap[K]) => void,
  ): void;
  removeEventListener<K extends keyof HubRelaySocketEventMap>(
    type: K,
    listener: (event: HubRelaySocketEventMap[K]) => void,
  ): void;
}

export interface HubRelayTransport {
  readonly open: (url: string) => HubRelaySocket;
}

export const makeHubRelayTransport = (
  createSocket: (url: string) => WebSocket = (url) => new WebSocket(url),
): HubRelayTransport => ({
  open: (url) => {
    const socket = createSocket(url);
    socket.binaryType = "arraybuffer";
    return socket;
  },
});

export function relayWebSocketUrl(hubOrigin: string): string {
  const origin = new URL(hubOrigin);
  if (
    origin.origin !== hubOrigin ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) {
    throw new Error("Hub relay URL is invalid.");
  }
  if (origin.protocol === "https:") origin.protocol = "wss:";
  else if (
    origin.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
  ) {
    origin.protocol = "ws:";
  } else {
    throw new Error("Hub relay URL is invalid.");
  }
  origin.pathname = "/v1/relay/node";
  return origin.toString();
}
