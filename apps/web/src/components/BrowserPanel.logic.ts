import type {
  BrowserArtifactRef,
  BrowserCookieMetadata,
  BrowserEvent,
  BrowserPermissionKind,
  BrowserProfile,
  BrowserProfileMode,
  BrowserSessionSnapshot,
  BrowserStorageDataType,
  BrowserStorageInspectionResult,
  BrowserTabSnapshot,
  ThreadId,
} from "@ryco/contracts";

export const BROWSER_CURRENT_ORIGIN_CLEAR_TYPES = [
  "cookies",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "cacheStorage",
  "serviceWorkers",
] as const satisfies ReadonlyArray<BrowserStorageDataType>;

export const BROWSER_CURRENT_ORIGIN_STORAGE_TYPES = [
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "cacheStorage",
  "serviceWorkers",
] as const satisfies ReadonlyArray<BrowserStorageDataType>;

export const BROWSER_PROFILE_CLEAR_TYPES = [
  "cookies",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "cacheStorage",
  "serviceWorkers",
  "httpCache",
] as const satisfies ReadonlyArray<BrowserStorageDataType>;

/** Matches provider browser tools (`browser_open` uses thread-scoped profiles). */
export const BROWSER_PANEL_PROFILE_MODE: BrowserProfileMode = "thread";

export interface BrowserSurfaceBoundsPayload {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor: number;
}

export function resolveSelectedTab(
  session: BrowserSessionSnapshot | null,
): BrowserTabSnapshot | null {
  if (!session) return null;
  return session.tabs.find((tab) => tab.tabId === session.selectedTabId) ?? session.tabs[0] ?? null;
}

export function findThreadBrowserSession(
  sessions: ReadonlyArray<BrowserSessionSnapshot>,
  threadId: ThreadId,
): BrowserSessionSnapshot | null {
  return (
    sessions.find((session) => session.threadId === threadId && session.status !== "closed") ?? null
  );
}

export function resolveBrowserProfileLabel(
  session: BrowserSessionSnapshot | null,
  profiles: ReadonlyArray<BrowserProfile>,
): string {
  if (!session) return "Opening";
  const profile = profiles.find((candidate) => candidate.profileId === session.profileId);
  if (profile?.mode === "thread") return "Thread profile";
  if (profile?.mode === "project") return "Project profile";
  if (profile?.mode === "worktree") return "Worktree profile";
  if (profile?.mode === "temporary") return "Temporary profile";
  if (profile?.displayName) return profile.displayName;
  return "Browser profile";
}

export function isAgentOwnedBrowserSession(
  session: BrowserSessionSnapshot | null,
  profiles: ReadonlyArray<BrowserProfile>,
): boolean {
  if (!session) return false;
  const profile = profiles.find((candidate) => candidate.profileId === session.profileId);
  return profile?.mode === "thread";
}

export function shouldSyncAddressFromNavigation(
  addressFocused: boolean,
  nextUrl: string | undefined,
  currentAddress: string,
): boolean {
  if (addressFocused) return false;
  return (nextUrl ?? "") !== currentAddress;
}

export function readBrowserSurfaceBounds(
  rect: Pick<DOMRectReadOnly, "x" | "y" | "width" | "height">,
  deviceScaleFactor: number,
): BrowserSurfaceBoundsPayload | null {
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width,
    height,
    deviceScaleFactor: deviceScaleFactor > 0 ? deviceScaleFactor : 1,
  };
}

export function applyBrowserEvent(
  current: BrowserSessionSnapshot | null,
  event: BrowserEvent,
  threadId: ThreadId,
): BrowserSessionSnapshot | null {
  if (event.type === "session.updated") {
    if (current && event.session.sessionId === current.sessionId) {
      return event.session;
    }
    if (event.session.threadId === threadId && event.session.status !== "closed") {
      return event.session;
    }
    return current;
  }
  if (!current) return current;
  if (event.type === "session.closed" && event.sessionId === current.sessionId) {
    return { ...current, status: "closed", updatedAt: new Date().toISOString() };
  }
  if (event.type === "tab.updated" && event.tab.sessionId === current.sessionId) {
    const tabs = current.tabs.some((tab) => tab.tabId === event.tab.tabId)
      ? current.tabs.map((tab) => (tab.tabId === event.tab.tabId ? event.tab : tab))
      : [...current.tabs, event.tab];
    return {
      ...current,
      tabs,
      selectedTabId: event.tab.selected ? event.tab.tabId : current.selectedTabId,
      updatedAt: new Date().toISOString(),
    };
  }
  if (event.type === "tab.crashed" && event.sessionId === current.sessionId) {
    return {
      ...current,
      status: "error",
      tabs: current.tabs.map((tab) =>
        tab.tabId === event.tabId ? { ...tab, crashed: true, updatedAt: event.createdAt } : tab,
      ),
      updatedAt: event.createdAt,
    };
  }
  return current;
}

const PERMISSION_LABELS: Record<BrowserPermissionKind, string> = {
  camera: "Camera",
  microphone: "Microphone",
  location: "Location",
  notifications: "Notifications",
  midi: "MIDI",
  clipboard: "Clipboard",
  fullscreen: "Fullscreen",
  download: "Download",
  popup: "Popup",
  "file-system": "File system",
  "media-capture": "Media capture",
};

export function formatBrowserPermissionRequest(input: {
  readonly origin: string;
  readonly permission: BrowserPermissionKind;
}): { readonly title: string; readonly description: string } {
  const permissionLabel = PERMISSION_LABELS[input.permission] ?? input.permission;
  return {
    title: `${permissionLabel} permission requested`,
    description: `${input.origin} requested ${permissionLabel.toLowerCase()} access in the embedded browser.`,
  };
}

export function formatBrowserDownloadUpdate(input: {
  readonly state: "started" | "progress" | "completed" | "failed" | "cancelled";
  readonly artifact: BrowserArtifactRef;
}): {
  readonly title: string;
  readonly description: string;
  readonly variant: "info" | "error";
} | null {
  const fileName = input.artifact.url
    ? decodeURIComponent(input.artifact.url.split(/[/?#]/).pop() ?? "download")
    : "Download";
  switch (input.state) {
    case "started":
      return {
        title: "Download started",
        description: fileName,
        variant: "info",
      };
    case "completed":
      return {
        title: "Download completed",
        description: fileName,
        variant: "info",
      };
    case "failed":
      return {
        title: "Download failed",
        description: fileName,
        variant: "error",
      };
    case "cancelled":
      return {
        title: "Download cancelled",
        description: fileName,
        variant: "info",
      };
    default:
      return null;
  }
}

export function formatBrowserStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(kib < 10 ? 1 : 0)} KB`;
  const mib = kib / 1024;
  return `${mib.toFixed(mib < 10 ? 1 : 0)} MB`;
}

export function formatBrowserCookieExpiry(cookie: BrowserCookieMetadata): string {
  if (cookie.session || cookie.expirationDate === undefined) return "Session";
  const expiresAt = new Date(cookie.expirationDate * 1000);
  if (Number.isNaN(expiresAt.getTime())) return "Persistent";
  return expiresAt.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function summarizeBrowserStorageInspection(
  inspection: BrowserStorageInspectionResult | null,
): {
  readonly currentOriginCookies: number;
  readonly profileCookies: number;
  readonly localStorageKeys: number;
  readonly sessionStorageKeys: number;
  readonly storageBytes: number;
} {
  if (!inspection) {
    return {
      currentOriginCookies: 0,
      profileCookies: 0,
      localStorageKeys: 0,
      sessionStorageKeys: 0,
      storageBytes: 0,
    };
  }
  const localStorageBytes = inspection.localStorage.reduce(
    (total, entry) => total + entry.valueBytes,
    0,
  );
  const sessionStorageBytes = inspection.sessionStorage.reduce(
    (total, entry) => total + entry.valueBytes,
    0,
  );
  return {
    currentOriginCookies: inspection.cookieCounts.currentOrigin,
    profileCookies: inspection.cookieCounts.profile,
    localStorageKeys: inspection.localStorage.length,
    sessionStorageKeys: inspection.sessionStorage.length,
    storageBytes: localStorageBytes + sessionStorageBytes,
  };
}
