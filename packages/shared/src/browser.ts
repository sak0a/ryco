export type BrowserOriginKind =
  | "http"
  | "loopback"
  | "private-network"
  | "link-local"
  | "file"
  | "about"
  | "blocked-scheme";

export interface BrowserUrlInfo {
  readonly url: string;
  readonly origin: string | null;
  readonly scheme: string;
  readonly hostname: string | null;
  readonly kind: BrowserOriginKind;
}

export type BrowserUrlParseResult =
  | {
      readonly ok: true;
      readonly value: BrowserUrlInfo;
    }
  | {
      readonly ok: false;
      readonly reason: "empty" | "invalid" | "blocked-scheme";
      readonly message: string;
    };

const ALLOWED_BROWSER_SCHEMES = new Set(["http:", "https:", "file:", "about:"]);
const BLOCKED_BROWSER_SCHEMES = new Set([
  "blob:",
  "chrome:",
  "data:",
  "devtools:",
  "javascript:",
  "view-source:",
]);
const SAFE_PROFILE_KEY_MAX_LENGTH = 80;

export function normalizeBrowserNavigationUrl(rawInput: string): BrowserUrlParseResult {
  const input = rawInput.trim();
  if (input.length === 0) {
    return { ok: false, reason: "empty", message: "URL is empty" };
  }

  const explicitScheme = input.match(/^([a-zA-Z][a-zA-Z\d+.-]*):/)?.[0]?.toLowerCase();
  const candidate =
    input.includes("://") ||
    input.startsWith("about:") ||
    input.startsWith("file:") ||
    (explicitScheme !== undefined && BLOCKED_BROWSER_SCHEMES.has(explicitScheme))
      ? input
      : `${defaultSchemeForInput(input)}://${input}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, reason: "invalid", message: "URL is invalid" };
  }

  if (!ALLOWED_BROWSER_SCHEMES.has(parsed.protocol)) {
    return {
      ok: false,
      reason: "blocked-scheme",
      message: `Browser navigation blocked unsupported URL scheme: ${parsed.protocol}`,
    };
  }

  if (parsed.protocol === "about:" && parsed.href !== "about:blank") {
    return {
      ok: false,
      reason: "blocked-scheme",
      message: "Only about:blank is supported",
    };
  }

  const hostname = parsed.hostname || null;
  const origin = parsed.origin === "null" ? null : parsed.origin;
  return {
    ok: true,
    value: {
      url: parsed.href,
      origin,
      scheme: parsed.protocol.replace(/:$/, ""),
      hostname,
      kind: classifyBrowserOrigin(parsed),
    },
  };
}

export function classifyBrowserOrigin(parsed: URL): BrowserOriginKind {
  if (parsed.protocol === "file:") return "file";
  if (parsed.protocol === "about:") return "about";
  if (!ALLOWED_BROWSER_SCHEMES.has(parsed.protocol)) return "blocked-scheme";

  const hostname = parsed.hostname.toLowerCase();
  if (isLoopbackHostname(hostname)) return "loopback";
  if (isPrivateNetworkHostname(hostname)) return "private-network";
  if (isLinkLocalHostname(hostname)) return "link-local";
  return "http";
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized === "0:0:0:0:0:0:0:1" ||
    normalized.startsWith("127.")
  );
}

export function isPrivateNetworkHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;

  const parts = normalized.split(".").map((part) => Number.parseInt(part, 10));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  const [a = -1, b = -1] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function isLinkLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  const parts = normalized.split(".").map((part) => Number.parseInt(part, 10));
  if (
    parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    return parts[0] === 169 && parts[1] === 254;
  }
  return normalized.startsWith("fe80:");
}

export function sanitizeBrowserProfileKey(input: string): string {
  const trimmed = input.trim().toLowerCase();
  const hash = stableBrowserKeyHash(trimmed || "profile");
  const slug = trimmed
    .replace(/[\\/]+/g, "-")
    .replace(/\.\.+/g, ".")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, SAFE_PROFILE_KEY_MAX_LENGTH);
  const base = slug || "profile";
  if (base.length <= SAFE_PROFILE_KEY_MAX_LENGTH - 9) {
    return `${base}-${hash}`;
  }
  return `${base.slice(0, SAFE_PROFILE_KEY_MAX_LENGTH - 9)}-${hash}`;
}

function defaultSchemeForInput(input: string): "http" | "https" {
  const hostCandidate = input.split(/[/?#]/, 1)[0] ?? input;
  const hostname = hostCandidate.startsWith("[")
    ? hostCandidate.slice(0, hostCandidate.indexOf("]") + 1)
    : (hostCandidate.split(":")[0] ?? hostCandidate);

  return isLoopbackHostname(hostname) ||
    isPrivateNetworkHostname(hostname) ||
    isLinkLocalHostname(hostname)
    ? "http"
    : "https";
}

function stableBrowserKeyHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0").slice(0, 7);
}

export interface BrowserSurfaceBoundsInput {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor?: number | undefined;
}

export interface BrowserSurfaceBoundsRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Reconcile renderer-reported bounds with the native window scale factor for Electron setBounds. */
export function resolveElectronSurfaceBounds(
  bounds: BrowserSurfaceBoundsInput,
  nativeDeviceScaleFactor: number,
): BrowserSurfaceBoundsRect | null {
  const reportedScale =
    bounds.deviceScaleFactor !== undefined && bounds.deviceScaleFactor > 0
      ? bounds.deviceScaleFactor
      : 1;
  const nativeScale = nativeDeviceScaleFactor > 0 ? nativeDeviceScaleFactor : 1;
  const ratio = nativeScale / reportedScale;
  const x = Math.round(bounds.x * ratio);
  const y = Math.round(bounds.y * ratio);
  const width = Math.max(1, Math.round(bounds.width * ratio));
  const height = Math.max(1, Math.round(bounds.height * ratio));

  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return { x, y, width, height };
}
