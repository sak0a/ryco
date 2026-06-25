import type {
  BrowserCookieMetadata,
  BrowserStorageDataType,
  BrowserStorageInspectionResult,
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
