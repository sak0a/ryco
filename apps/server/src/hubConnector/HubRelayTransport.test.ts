import { describe, expect, it } from "vite-plus/test";

import { makeHubRelayTransport, relayWebSocketUrl } from "./HubRelayTransport.ts";

describe("HubRelayTransport", () => {
  it("derives only the fixed credential-free WebSocket route", () => {
    expect(relayWebSocketUrl("https://relay.example")).toBe("wss://relay.example/v1/relay/node");
    expect(relayWebSocketUrl("http://127.0.0.1:3000")).toBe("ws://127.0.0.1:3000/v1/relay/node");
    for (const invalid of [
      "https://user:secret@relay.example",
      "https://relay.example/path",
      "https://relay.example?token=secret",
      "http://relay.example",
    ]) {
      expect(() => relayWebSocketUrl(invalid)).toThrow("Hub relay URL is invalid.");
    }
  });

  it("constructs the client without protocols, cookies, authorization, origin, or options", () => {
    const calls: unknown[][] = [];
    const socket = {
      binaryType: "blob",
      bufferedAmount: 0,
      readyState: 0,
      send: () => undefined,
      close: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as WebSocket;
    const transport = makeHubRelayTransport((...args: unknown[]) => {
      calls.push(args);
      return socket;
    });
    expect(transport.open("wss://relay.example/v1/relay/node")).toBe(socket);
    expect(calls).toEqual([["wss://relay.example/v1/relay/node"]]);
    expect(socket.binaryType).toBe("arraybuffer");
  });
});
