import { describe, expect, it } from "vite-plus/test";

import {
  browserCookieMetadata,
  browserCookieRemovalUrl,
  canUseBrowserCookieUrl,
  electronStorageTypes,
  sanitizeBrowserStorageEntries,
} from "./BrowserStorageHelpers.ts";

describe("BrowserStorageHelpers", () => {
  it("redacts cookie values while preserving safe metadata", () => {
    const metadata = browserCookieMetadata({
      name: "sid",
      value: "secret-value",
      domain: ".example.test",
      path: "/app",
      secure: true,
      httpOnly: true,
      session: false,
      sameSite: "lax",
      expirationDate: 1_783_000_000,
    } as Parameters<typeof browserCookieMetadata>[0]);

    expect(metadata).toMatchObject({
      name: "sid",
      domain: ".example.test",
      path: "/app",
      secure: true,
      httpOnly: true,
      session: false,
      sameSite: "lax",
      expirationDate: 1_783_000_000,
    });
    expect(JSON.stringify(metadata)).not.toContain("secret-value");
    expect(metadata.sizeBytes).toBeGreaterThan("sid".length);
  });

  it("builds cookie removal URLs from cookie metadata", () => {
    expect(
      browserCookieRemovalUrl({
        fallbackUrl: "http://example.test/app/page",
        domain: ".example.test",
        path: "/app",
        secure: true,
      }),
    ).toBe("https://example.test/app");
    expect(browserCookieRemovalUrl({ fallbackUrl: "about:blank" })).toBeNull();
    expect(canUseBrowserCookieUrl("https://example.test/")).toBe(true);
    expect(canUseBrowserCookieUrl("about:blank")).toBe(false);
  });

  it("maps Ryco storage types to Electron storage names", () => {
    expect(
      electronStorageTypes(["localStorage", "indexedDB", "cacheStorage", "serviceWorkers"]),
    ).toEqual(["localstorage", "indexdb", "filesystem", "cachestorage", "serviceworkers"]);
    expect(electronStorageTypes(["cookies", "httpCache", "sessionStorage"])).toEqual([]);
  });

  it("sanitizes active-page storage entries", () => {
    const [entry] = sanitizeBrowserStorageEntries([
      { key: "a".repeat(5_000), valueBytes: 3.8 },
      { key: "bad", valueBytes: -10 },
      { key: 42, valueBytes: 2 },
    ]);

    expect(entry?.key).toHaveLength(4_096);
    expect(entry?.valueBytes).toBe(3);
    expect(sanitizeBrowserStorageEntries([{ key: "bad", valueBytes: -10 }])).toEqual([
      { key: "bad", valueBytes: 0 },
    ]);
  });
});
