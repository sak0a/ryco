import { describe, expect, it } from "vite-plus/test";

import {
  BrowserProfileId,
  BrowserSessionId,
  BrowserTabId,
  ThreadId,
  type BrowserStorageInspectionResult,
} from "@ryco/contracts";
import {
  formatBrowserCookieExpiry,
  formatBrowserStorageBytes,
  summarizeBrowserStorageInspection,
} from "./BrowserPanel.logic";

const inspection = {
  session: {
    sessionId: BrowserSessionId.make("browser-session:test"),
    profileId: BrowserProfileId.make("browser-profile:test"),
    threadId: ThreadId.make("thread-1"),
    selectedTabId: BrowserTabId.make("browser-tab:test"),
    tabs: [],
    status: "ready",
    createdAt: "2026-06-25T10:00:00.000Z",
    updatedAt: "2026-06-25T10:00:00.000Z",
  },
  tabId: BrowserTabId.make("browser-tab:test"),
  profileId: BrowserProfileId.make("browser-profile:test"),
  url: "https://example.test/",
  origin: "https://example.test",
  cookies: [],
  localStorage: [
    { key: "theme", valueBytes: 4 },
    { key: "session", valueBytes: 2048 },
  ],
  sessionStorage: [{ key: "draft", valueBytes: 512 }],
  cookieCounts: {
    currentOrigin: 3,
    profile: 8,
  },
  inspectedAt: "2026-06-25T10:00:00.000Z",
} satisfies BrowserStorageInspectionResult;

describe("BrowserPanel storage logic", () => {
  it("summarizes cookie counts and visible storage bytes", () => {
    expect(summarizeBrowserStorageInspection(inspection)).toEqual({
      currentOriginCookies: 3,
      profileCookies: 8,
      localStorageKeys: 2,
      sessionStorageKeys: 1,
      storageBytes: 2564,
    });
  });

  it("formats byte counts for compact browser storage labels", () => {
    expect(formatBrowserStorageBytes(0)).toBe("0 B");
    expect(formatBrowserStorageBytes(512)).toBe("512 B");
    expect(formatBrowserStorageBytes(2048)).toBe("2.0 KB");
    expect(formatBrowserStorageBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("does not require persistent cookie expiry metadata", () => {
    expect(
      formatBrowserCookieExpiry({
        name: "sid",
        domain: "example.test",
        path: "/",
        secure: true,
        httpOnly: true,
        session: true,
        sizeBytes: 24,
      }),
    ).toBe("Session");
  });
});
