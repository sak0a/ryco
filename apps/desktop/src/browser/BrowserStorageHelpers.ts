import type { Cookie } from "electron";
import type {
  BrowserCookieMetadata,
  BrowserStorageDataType,
  BrowserStorageEntryMetadata,
} from "@ryco/contracts";

export type ElectronStorageType =
  | "filesystem"
  | "indexdb"
  | "localstorage"
  | "serviceworkers"
  | "cachestorage";

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function browserCookieMetadata(cookie: Cookie): BrowserCookieMetadata {
  return {
    name: cookie.name,
    domain: cookie.domain ?? "",
    path: cookie.path ?? "/",
    secure: cookie.secure === true,
    httpOnly: cookie.httpOnly === true,
    session: cookie.session === true,
    sameSite: cookie.sameSite,
    ...(cookie.expirationDate !== undefined ? { expirationDate: cookie.expirationDate } : {}),
    sizeBytes: byteLength(cookie.name) + byteLength(cookie.value),
  };
}

export function canUseBrowserCookieUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function browserCookieRemovalUrl(input: {
  readonly fallbackUrl: string;
  readonly domain?: string;
  readonly path?: string;
  readonly secure?: boolean;
}): string | null {
  let fallback: URL;
  try {
    fallback = new URL(input.fallbackUrl);
  } catch {
    return null;
  }
  if (fallback.protocol !== "http:" && fallback.protocol !== "https:") return null;

  const hostname = (input.domain ?? fallback.hostname).replace(/^\./, "");
  if (!hostname) return null;
  const protocol = input.secure === true || fallback.protocol === "https:" ? "https:" : "http:";
  const rawPath = input.path && input.path.startsWith("/") ? input.path : "/";
  return `${protocol}//${hostname}${rawPath}`;
}

export function electronStorageTypes(
  dataTypes: ReadonlyArray<BrowserStorageDataType>,
): ElectronStorageType[] {
  const storages = new Set<ElectronStorageType>();
  for (const type of dataTypes) {
    if (type === "localStorage") storages.add("localstorage");
    if (type === "indexedDB") {
      storages.add("indexdb");
      storages.add("filesystem");
    }
    if (type === "cacheStorage") storages.add("cachestorage");
    if (type === "serviceWorkers") storages.add("serviceworkers");
  }
  return [...storages];
}

export function sanitizeBrowserStorageEntries(value: unknown): BrowserStorageEntryMetadata[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as { key?: unknown; valueBytes?: unknown };
      if (typeof candidate.key !== "string") return null;
      const size = typeof candidate.valueBytes === "number" ? candidate.valueBytes : 0;
      return {
        key: candidate.key.slice(0, 4_096),
        valueBytes: Math.max(0, Math.floor(size)),
      } satisfies BrowserStorageEntryMetadata;
    })
    .filter((entry): entry is BrowserStorageEntryMetadata => entry !== null);
}
