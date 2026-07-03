import { describe, expect, it } from "vite-plus/test";

import {
  BrowserArtifactId,
  BrowserProfileId,
  BrowserSessionId,
  BrowserTabId,
  ThreadId,
  type BrowserEvent,
  type BrowserProfile,
  type BrowserSessionSnapshot,
  type BrowserStorageInspectionResult,
} from "@ryco/contracts";
import {
  applyBrowserEvent,
  findThreadBrowserSession,
  formatBrowserDownloadUpdate,
  formatBrowserPermissionRequest,
  readBrowserSurfaceBounds,
  resolveBrowserProfileLabel,
  resolveSelectedTab,
  shouldSyncAddressFromNavigation,
  summarizeBrowserStorageInspection,
  formatBrowserCookieExpiry,
  formatBrowserStorageBytes,
} from "./BrowserPanel.logic";

const threadId = ThreadId.make("thread-1");

const session = {
  sessionId: BrowserSessionId.make("browser-session:test"),
  profileId: BrowserProfileId.make("browser-profile:test"),
  threadId,
  selectedTabId: BrowserTabId.make("browser-tab:test"),
  tabs: [
    {
      tabId: BrowserTabId.make("browser-tab:test"),
      sessionId: BrowserSessionId.make("browser-session:test"),
      profileId: BrowserProfileId.make("browser-profile:test"),
      selected: true,
      crashed: false,
      navigation: {
        url: "https://example.test/path",
        origin: "https://example.test",
        loadState: "loaded",
        canGoBack: false,
        canGoForward: false,
      },
      createdAt: "2026-06-25T10:00:00.000Z",
      updatedAt: "2026-06-25T10:00:00.000Z",
    },
  ],
  status: "ready",
  createdAt: "2026-06-25T10:00:00.000Z",
  updatedAt: "2026-06-25T10:00:00.000Z",
} satisfies BrowserSessionSnapshot;

const inspection = {
  session,
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

describe("BrowserPanel session logic", () => {
  it("resolves the selected tab from a session snapshot", () => {
    expect(resolveSelectedTab(session)?.tabId).toBe(session.selectedTabId);
  });

  it("finds an active browser session for the current thread", () => {
    expect(findThreadBrowserSession([session], threadId)?.sessionId).toBe(session.sessionId);
    expect(findThreadBrowserSession([], threadId)).toBeNull();
  });

  it("adopts agent session updates for the active thread", () => {
    const agentSession = {
      ...session,
      sessionId: BrowserSessionId.make("browser-session:agent"),
      tabs: session.tabs.map((tab) => ({
        ...tab,
        sessionId: BrowserSessionId.make("browser-session:agent"),
        navigation: {
          ...tab.navigation,
          url: "https://agent.example.test/",
        },
      })),
    } satisfies BrowserSessionSnapshot;

    const event = {
      type: "session.updated",
      session: agentSession,
      createdAt: "2026-06-25T10:01:00.000Z",
    } satisfies BrowserEvent;

    expect(applyBrowserEvent(null, event, threadId)?.sessionId).toBe(agentSession.sessionId);
    expect(applyBrowserEvent(session, event, threadId)?.tabs[0]?.navigation.url).toBe(
      "https://agent.example.test/",
    );
  });

  it("does not overwrite the address bar while it is focused", () => {
    expect(
      shouldSyncAddressFromNavigation(true, "https://example.test/new", "https://old.test"),
    ).toBe(false);
    expect(
      shouldSyncAddressFromNavigation(false, "https://example.test/new", "https://old.test"),
    ).toBe(true);
  });

  it("reads surface bounds with device scale metadata", () => {
    expect(readBrowserSurfaceBounds({ x: 10.4, y: 20.6, width: 800.2, height: 600.8 }, 2)).toEqual({
      x: 10,
      y: 21,
      width: 800,
      height: 600,
      deviceScaleFactor: 2,
    });
  });

  it("labels thread profiles for the status bar", () => {
    const profiles = [
      {
        profileId: session.profileId,
        displayName: "Thread",
        mode: "thread",
        persistent: true,
        scope: { mode: "thread", threadId },
        createdAt: "2026-06-25T10:00:00.000Z",
        updatedAt: "2026-06-25T10:00:00.000Z",
      },
    ] satisfies ReadonlyArray<BrowserProfile>;

    expect(resolveBrowserProfileLabel(session, profiles)).toBe("Thread profile");
  });

  it("formats permission and download notifications", () => {
    expect(
      formatBrowserPermissionRequest({
        origin: "https://example.test",
        permission: "camera",
      }).title,
    ).toContain("Camera");

    expect(
      formatBrowserDownloadUpdate({
        state: "completed",
        artifact: {
          artifactId: BrowserArtifactId.make("browser-artifact:1"),
          kind: "download",
          mimeType: "application/pdf",
          byteSize: 1024,
          url: "https://example.test/report.pdf",
          createdAt: "2026-06-25T10:00:00.000Z",
          expiresAt: "2026-06-25T11:00:00.000Z",
        },
      })?.title,
    ).toBe("Download completed");
  });
});
