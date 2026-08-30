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
  SessionCredentialsService,
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
      webSessionCredentials satisfies SessionCredentialsService,
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

  it("converts a File through the neutral flat attachment value", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
    const attachment = await webAttachmentCodec.encode({ id: "image-1", file });

    expect(attachment).toEqual({
      id: "image-1",
      mime: "image/png",
      size: 3,
      bytes: new Uint8Array([1, 2, 3]),
    });
    await expect(webAttachmentCodec.decode(attachment)).resolves.toBeInstanceOf(File);
  });

  it("preserves general file MIME data and uses a safe fallback when absent", async () => {
    const textFile = new File(["abc"], "notes.txt", { type: "text/plain" });
    const textAttachment = await webAttachmentCodec.encode({ id: "file-1", file: textFile });
    expect(textAttachment.mime).toBe("text/plain");

    const unknownFile = new File(["abc"], "payload.bin");
    const unknownAttachment = await webAttachmentCodec.encode({ id: "file-2", file: unknownFile });
    expect(unknownAttachment.mime).toBe("application/octet-stream");
  });
});
