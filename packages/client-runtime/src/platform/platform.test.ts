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
  type NativeE2eePlatformService,
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
      set: async (key, value) => {
        values.set(key, value);
        return true;
      },
      remove: async (key) => void values.delete(key),
    };
    const endpoint: EndpointService = {
      origin: () => "https://example.test",
      readPrimaryTarget: () => ({
        source: "configured",
        target: {
          httpBaseUrl: "https://example.test",
          wsBaseUrl: "wss://example.test",
        },
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
    const nativeE2ee: NativeE2eePlatformService = {
      platform: "ios",
      appVersion: "1.0.0",
      deviceLabel: () => "Phone",
      randomBytes: async (length) => new Uint8Array(length),
      ensureIdentity: async () => ({
        publicKey: new Uint8Array(65),
        fingerprint: new Uint8Array(32),
        backing: "secure-enclave",
      }),
      ensureClientPrekey: async () => ({
        agreementPublicKey: new Uint8Array(32),
        agreementFingerprint: new Uint8Array(32),
        transcript: new Uint8Array([1]),
        signature: new Uint8Array(64),
        certificate: new Uint8Array([2]),
        certificateDigest: new Uint8Array(32),
        expiresAt: 2,
      }),
      getOrCreateEnrollmentId: async () => "enr_aaaaaaaaaaaaaaaaaaaaaa",
      clearEnrollment: async () => undefined,
      withAgreementSecret: async (use) => use(new Uint8Array(32)),
      readAccountTrustedNode: async () => null,
      writeAccountTrustedNode: async () => undefined,
    };

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
    expect(nativeE2ee.deviceLabel()).toBe("Phone");
    expect((await nativeE2ee.ensureIdentity()).backing).toBe("secure-enclave");
    expect(await nativeE2ee.randomBytes(32)).toHaveLength(32);
  });

  it("uses the no-op observability default", () => {
    expect(Context.get(Context.empty(), Observability)).toBe(NOOP_OBSERVABILITY);
    expect(
      NOOP_OBSERVABILITY.recordPerformance("platform.test", { ignored: true }),
    ).toBeUndefined();
  });
});
