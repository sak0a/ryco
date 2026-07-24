import { describe, expect, it, vi } from "vite-plus/test";
import type {
  AppLifecycleService,
  AttachmentCodecService,
  ClientRuntimeConfigService,
  ClockService,
  EndpointService,
  FrameSchedulerService,
  HttpClientService,
  KVService,
  ObservabilityService,
  PairingCredentialSourceService,
  PasskeyCeremonyService,
  SecretKVService,
  SessionCredentialsService,
  SocketService,
} from "@ryco/client-runtime/platform";

// Native modules are stubbed so the adapters load under the Node test runner,
// matching the upstream mobile test pattern.
vi.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove: () => {} }) },
}));
vi.mock("expo-network", () => ({
  addNetworkStateListener: () => ({ remove: () => {} }),
  getNetworkStateAsync: async () => ({ isConnected: true }),
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
vi.mock("expo-sqlite/kv-store", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
vi.mock("expo-linking", () => ({ getInitialURL: async () => null }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));

import { mobileAppLifecycle } from "./appLifecycle";
import { mobileAttachmentCodec } from "./attachmentCodec";
import { readMobileClientRuntimeConfig } from "./config";
import { createMobileEndpoint } from "./endpoint";
import { mobileClock, mobileFrameScheduler } from "./frame";
import { createMobileHttpClient } from "./httpClient";
import { createMobileKV } from "./kv";
import { mobileObservability } from "./observability";
import {
  createMobilePairingCredentialSource,
  extractPairingToken,
  mobilePairingCredentialSource,
} from "./pairingCredentialSource";
import { mobilePasskeyCeremony } from "./passkeyCeremony";
import { createMobileSecretKV, sanitizeSecretKey } from "./secretKv";
import { createMobileSessionCredentials } from "./sessionCredentials";
import { mobileSocket } from "./socket";

const nodeConfig: ClientRuntimeConfigService = {
  clientMode: "standard",
  httpBaseUrl: "http://node.local:44342",
  wsBaseUrl: "ws://node.local:44342",
};

describe("mobile platform adapters", () => {
  it("implements each platform contract with an RN primitive", () => {
    const adapters = [
      mobileAppLifecycle satisfies AppLifecycleService,
      mobileAttachmentCodec satisfies AttachmentCodecService,
      mobileClock satisfies ClockService,
      createMobileEndpoint(nodeConfig) satisfies EndpointService,
      mobileFrameScheduler satisfies FrameSchedulerService,
      createMobileHttpClient(() => null) satisfies HttpClientService,
      createMobileKV() satisfies KVService,
      mobileObservability satisfies ObservabilityService,
      mobilePairingCredentialSource satisfies PairingCredentialSourceService,
      mobilePasskeyCeremony satisfies PasskeyCeremonyService,
      createMobileSecretKV() satisfies SecretKVService,
      mobileSocket satisfies SocketService,
      createMobileSessionCredentials() satisfies SessionCredentialsService,
      readMobileClientRuntimeConfig() satisfies ClientRuntimeConfigService,
    ];

    expect(adapters).toHaveLength(14);
  });

  it("keeps the bearer session mode with an in-memory CSRF holder", () => {
    const credentials = createMobileSessionCredentials();
    expect(credentials.mode).toBe("bearer");
    expect(credentials.readCsrfToken()).toBeNull();
    credentials.writeCsrfToken("csrf");
    expect(credentials.readCsrfToken()).toBe("csrf");
    credentials.writeCsrfToken(null);
    expect(credentials.readCsrfToken()).toBeNull();
  });

  it("adapts an async key-value store to the KV contract", async () => {
    const store = new Map<string, string>();
    const kv = createMobileKV({
      getItem: async (key) => store.get(key) ?? null,
      setItem: async (key, value) => {
        store.set(key, value);
      },
      removeItem: async (key) => {
        store.delete(key);
      },
    });
    await kv.setItem("draft", "value");
    expect(await kv.getItem("draft")).toBe("value");
    await kv.removeItem("draft");
    expect(await kv.getItem("draft")).toBeNull();
  });

  it("stubs the hosted passkey ceremony as unavailable in B1", async () => {
    await expect(mobilePasskeyCeremony.authenticate({})).rejects.toThrow("hosted mode not available");
    await expect(mobilePasskeyCeremony.register({})).rejects.toThrow("hosted mode not available");
  });

  it("resolves relative pathnames against the configured origin", async () => {
    const calls: string[] = [];
    const globalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string) => {
      calls.push(url);
      return Promise.resolve({ ok: true, status: 200 } as Response);
    }) as typeof fetch;
    try {
      const http = createMobileHttpClient(() => "http://node.local:44342");
      await http.fetch("/api/auth/bootstrap/bearer");
      await http.fetch("https://other.host/x");
      expect(calls).toEqual([
        "http://node.local:44342/api/auth/bootstrap/bearer",
        "https://other.host/x",
      ]);
    } finally {
      globalThis.fetch = globalFetch;
    }
  });

  it("derives a configured primary target and resolves urls from the endpoint", () => {
    const endpoint = createMobileEndpoint(nodeConfig);
    expect(endpoint.origin()).toBe("http://node.local:44342");
    expect(endpoint.readPrimaryTarget()).toEqual({
      source: "configured",
      target: { httpBaseUrl: "http://node.local:44342", wsBaseUrl: "ws://node.local:44342" },
    });
    expect(endpoint.resolveHttpUrl("/api/threads", { limit: "10" })).toBe(
      "http://node.local:44342/api/threads?limit=10",
    );
    expect(endpoint.resolveWsUrl("/ws")).toBe("ws://node.local:44342/ws");
  });

  it("returns no primary target when nothing is configured", () => {
    const endpoint = createMobileEndpoint({ clientMode: "standard" });
    expect(endpoint.readPrimaryTarget()).toBeNull();
    expect(endpoint.origin()).toBe("");
  });

  it("sanitizes secret keys to the SecureStore charset", () => {
    expect(sanitizeSecretKey("env-123.abc")).toBe("env-123.abc");
    expect(sanitizeSecretKey("ws:label/path")).toBe("ws_003alabel_002fpath");
    // `_` is reserved as the escape introducer, so a literal `_` is escaped too.
    expect(sanitizeSecretKey("a_b")).toBe("a_005fb");
  });

  it("routes secret writes through SecureStore and reports failure as false", async () => {
    const backing = new Map<string, string>();
    let failNext = false;
    const secretKv = createMobileSecretKV({
      getItemAsync: async (key) => backing.get(key) ?? null,
      setItemAsync: async (key, value) => {
        if (failNext) throw new Error("keychain unavailable");
        backing.set(key, value);
      },
      deleteItemAsync: async (key) => {
        backing.delete(key);
      },
    });
    expect(await secretKv.set("env-1", "token")).toBe(true);
    expect(await secretKv.get("env-1")).toBe("token");
    failNext = true;
    expect(await secretKv.set("env-1", "token2")).toBe(false);
    await secretKv.remove("env-1");
    expect(await secretKv.get("env-1")).toBeNull();
  });

  it("takes a pairing token from a deep link exactly once", async () => {
    const source = createMobilePairingCredentialSource(
      async () => "ryco://pair?host=http%3A%2F%2Fnode.local%3A44342#token=pairing-token",
    );
    expect(await source.take()).toBe("pairing-token");
    expect(await source.take()).toBeNull();
  });

  it("extracts the pairing token from hash and query", () => {
    expect(extractPairingToken("ryco://pair#token=abc")).toBe("abc");
    expect(extractPairingToken("https://app.ryco.dev/pair?token=def")).toBe("def");
    expect(extractPairingToken("ryco://pair")).toBeNull();
    expect(extractPairingToken("not a url")).toBeNull();
  });

  it("round-trips a uri attachment through the neutral value", async () => {
    const encoded = await mobileAttachmentCodec.encode({
      id: "img-1",
      mime: "image/png",
      size: 3,
      uri: "file:///tmp/img.png",
    });
    expect(encoded).toEqual({ id: "img-1", mime: "image/png", size: 3, uri: "file:///tmp/img.png" });
    await expect(mobileAttachmentCodec.decode(encoded)).resolves.toEqual({
      id: "img-1",
      mime: "image/png",
      size: 3,
      uri: "file:///tmp/img.png",
    });
  });

  it("reports foreground and a live clock/frame", async () => {
    expect(mobileAppLifecycle.isForeground()).toBe(true);
    expect(Number.isFinite(mobileClock.now())).toBe(true);
    await new Promise<void>((resolve) => mobileFrameScheduler.scheduleFrame(resolve));
  });
});
