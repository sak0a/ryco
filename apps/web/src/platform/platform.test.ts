import { describe, expect, it } from "vite-plus/test";
import type {
  AppLifecycleService,
  AttachmentCodecService,
  ClientRuntimeConfigService,
  ClockService,
  EndpointService,
  FrameSchedulerService,
  KVService,
  ObservabilityService,
  PairingCredentialSourceService,
  PasskeyCeremonyService,
  SecretKVService,
  SocketService,
} from "@ryco/client-runtime/platform";

import { createMemoryStorage } from "../lib/storage";
import { webAppLifecycle } from "./appLifecycle";
import { webAttachmentCodec } from "./attachmentCodec";
import { readWebClientRuntimeConfig } from "./config";
import { webEndpoint } from "./endpoint";
import { webClock, webFrameScheduler } from "./frame";
import { createWebKV, webKV } from "./kv";
import { webObservability } from "./observability";
import { webPairingCredentialSource } from "./pairingCredentialSource";
import { webPasskeyCeremony } from "./passkeyCeremony";
import { createWebSessionCredentials, webSessionCredentials } from "./sessionCredentials";
import { webSecretKV } from "./secretKv";
import { webSocket } from "./socket";

describe("web platform adapters", () => {
  it("implements each platform contract without moving a web seam", () => {
    const adapters = [
      webAppLifecycle satisfies AppLifecycleService,
      webAttachmentCodec satisfies AttachmentCodecService,
      webClock satisfies ClockService,
      webEndpoint satisfies EndpointService,
      webFrameScheduler satisfies FrameSchedulerService,
      webKV satisfies KVService,
      webObservability satisfies ObservabilityService,
      webPairingCredentialSource satisfies PairingCredentialSourceService,
      webPasskeyCeremony satisfies PasskeyCeremonyService,
      webSecretKV satisfies SecretKVService,
      webSocket satisfies SocketService,
      webSessionCredentials,
      readWebClientRuntimeConfig() satisfies ClientRuntimeConfigService,
    ];

    expect(adapters).toHaveLength(13);
  });

  it("adapts StateStorage to the asynchronous KV contract", async () => {
    const kv = createWebKV(createMemoryStorage());

    await kv.setItem("draft", "value");
    expect(await kv.getItem("draft")).toBe("value");

    await kv.removeItem("draft");
    expect(await kv.getItem("draft")).toBeNull();
  });

  it("keeps the cookie credential mode and CSRF holder in memory", () => {
    const credentials = createWebSessionCredentials();

    expect(credentials.mode).toBe("cookie");
    expect(credentials.readCsrfToken()).toBeNull();

    credentials.writeCsrfToken("csrf-token");
    expect(credentials.readCsrfToken()).toBe("csrf-token");

    credentials.writeCsrfToken(null);
    expect(credentials.readCsrfToken()).toBeNull();
  });

  it("adapts the web clock and frame scheduler", async () => {
    expect(Number.isFinite(webClock.now())).toBe(true);

    await new Promise<void>((resolve) => webFrameScheduler.scheduleFrame(resolve));
  });
});
