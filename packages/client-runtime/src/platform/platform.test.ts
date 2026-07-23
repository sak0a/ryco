import { describe, expect, it } from "vite-plus/test";
import { Context } from "effect";

import {
  NOOP_OBSERVABILITY,
  Observability,
  type AppLifecycleService,
  type AttachmentCodecService,
  type ClockService,
  type ClientRuntimeConfigService,
  type ComposerAttachment,
  type EndpointService,
  type FrameSchedulerService,
  type KVService,
  type PairingCredentialSourceService,
  type PasskeyCeremonyService,
  type SecretKVService,
  type SessionCredentialsService,
  type SocketService,
} from "./index.ts";

describe("platform contracts", () => {
  it("accepts in-memory implementations for each platform seam", async () => {
    const values = new Map<string, string>();
    const kv: KVService = {
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => void values.set(key, value),
      removeItem: async (key) => void values.delete(key),
    };
    const secretKv: SecretKVService = {
      get: async (key) => values.get(key) ?? null,
      set: async (key, value) => void values.set(key, value),
      remove: async (key) => void values.delete(key),
    };
    const endpoint: EndpointService = {
      origin: () => "https://example.test",
      readPrimaryTarget: () => ({
        httpBaseUrl: "https://example.test",
        wsBaseUrl: "wss://example.test",
      }),
      resolveHttpUrl: (pathname) => `https://example.test${pathname}`,
      resolveWsUrl: (url) => url,
    };
    const socket: SocketService = { webSocketConstructor: () => ({}) };
    const lifecycle: AppLifecycleService = {
      isForeground: () => true,
      isOnline: () => true,
      subscribe: () => () => undefined,
    };
    const passkeys: PasskeyCeremonyService = {
      authenticate: async () => ({
        id: "id",
        rawId: "id",
        response: { clientDataJSON: "", authenticatorData: "", signature: "" },
        type: "public-key",
        clientExtensionResults: {},
      }),
      register: async () => ({
        id: "id",
        rawId: "id",
        response: { clientDataJSON: "", attestationObject: "" },
        type: "public-key",
        clientExtensionResults: {},
      }),
    };
    let csrfToken: string | null = null;
    const credentials: SessionCredentialsService = {
      mode: "bearer",
      readCsrfToken: () => csrfToken,
      writeCsrfToken: (token) => {
        csrfToken = token;
      },
    };
    let pairingToken: string | null = "pairing-token";
    const pairing: PairingCredentialSourceService = {
      take: async () => {
        const next = pairingToken;
        pairingToken = null;
        return next;
      },
    };
    const attachment: ComposerAttachment = {
      id: "attachment",
      mime: "text/plain",
      size: 1,
      bytes: new Uint8Array([1]),
    };
    const attachments: AttachmentCodecService = {
      encode: async () => attachment,
      decode: async (value) => value,
    };
    const clock: ClockService = { now: () => 1 };
    const frames: FrameSchedulerService = { scheduleFrame: (callback) => callback() };
    const config: ClientRuntimeConfigService = { clientMode: "standard" };

    await kv.setItem("plain", "value");
    await secretKv.set("secret", "value");
    credentials.writeCsrfToken("csrf");

    expect(await kv.getItem("plain")).toBe("value");
    expect(await secretKv.get("secret")).toBe("value");
    expect(await pairing.take()).toBe("pairing-token");
    expect(await pairing.take()).toBeNull();
    expect(await attachments.decode(await attachments.encode({}))).toEqual(attachment);
    expect(endpoint.resolveHttpUrl("/health")).toBe("https://example.test/health");
    expect(socket.webSocketConstructor("wss://example.test")).toEqual({});
    expect(lifecycle.isOnline()).toBe(true);
    expect((await passkeys.authenticate({})).type).toBe("public-key");
    expect(credentials.readCsrfToken()).toBe("csrf");
    expect(clock.now()).toBe(1);
    let framed = false;
    frames.scheduleFrame(() => {
      framed = true;
    });
    expect(framed).toBe(true);
    expect(config.clientMode).toBe("standard");
  });

  it("uses the no-op observability default", () => {
    expect(Context.get(Context.empty(), Observability)).toBe(NOOP_OBSERVABILITY);
    expect(
      NOOP_OBSERVABILITY.recordPerformance("platform.test", { ignored: true }),
    ).toBeUndefined();
  });
});
