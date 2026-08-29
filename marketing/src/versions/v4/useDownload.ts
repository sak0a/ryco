/**
 * useDownload — resolves a one-click, OS- and arch-correct download.
 *
 * The repo's release assets are versioned (Ryco-X.Y.Z-arch.ext), so there's no
 * stable URL to hard-link. We fetch the latest release from the GitHub API once
 * (CORS-enabled, cached in localStorage + a shared in-flight promise) and match
 * the right asset for the visitor's platform.
 *
 * Apple Silicon vs Intel can't be read from the user agent (it always says
 * "MacIntel"), so arch is best-effort: UA-Client-Hints `architecture` first,
 * then a WebGL GPU-renderer heuristic, defaulting to Apple Silicon. Callers
 * surface the detected target + an "all builds" link so a wrong guess is
 * recoverable. Everything degrades to the Releases page if the API is
 * unreachable or rate-limited.
 */
import { useEffect, useState } from "react";
import { SITE } from "@/data/content";

const REPO = "saka-gg/ryco";
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const CACHE_KEY = "ryco:latest-release";
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6h

export type Os = "mac" | "windows" | "linux" | null;
export type Arch = "arm64" | "x64" | null;

interface ReleaseAsset {
  name: string;
  url: string;
}
interface Release {
  tag: string;
  assets: ReleaseAsset[];
}

export interface AssetUrls {
  macArm: string | null;
  macX64: string | null;
  win: string | null;
  linux: string | null;
}

export interface DownloadInfo {
  os: Os;
  osLabel: string | null;
  arch: Arch;
  /** "Apple Silicon" / "Intel" for macOS; null elsewhere. */
  archLabel: string | null;
  version: string | null;
  /** Best direct asset for the detected platform, else the Releases page. */
  href: string;
  /** True when `href` is a direct binary download (not the Releases page). */
  isDirect: boolean;
  urls: AssetUrls | null;
  releasesUrl: string;
}

let inflight: Promise<Release | null> | null = null;

function loadCached(): Release | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { t, data } = JSON.parse(raw) as { t: number; data: Release };
    return Date.now() - t < CACHE_TTL ? data : null;
  } catch {
    return null;
  }
}

function fetchLatest(): Promise<Release | null> {
  if (inflight) return inflight;
  const p = (async () => {
    const cached = loadCached();
    if (cached) return cached;
    try {
      const res = await fetch(API, { headers: { Accept: "application/vnd.github+json" } });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        tag_name?: string;
        assets?: Array<{ name: string; browser_download_url: string }>;
      };
      const data: Release = {
        tag: json.tag_name ?? "",
        assets: (json.assets ?? []).map((a) => ({ name: a.name, url: a.browser_download_url })),
      };
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), data }));
      } catch {
        /* storage may be unavailable (private mode) — that's fine */
      }
      return data;
    } catch {
      return null;
    }
  })();
  inflight = p;
  // Release the shared promise once it settles, so a failed fetch doesn't pin
  // every later caller to the Releases fallback for the rest of the session —
  // concurrent callers still share this run; later mounts can retry.
  void p.finally(() => {
    if (inflight === p) inflight = null;
  });
  return p;
}

function pick(assets: ReleaseAsset[], re: RegExp): string | null {
  const a = assets.find((x) => re.test(x.name) && !/\.blockmap$/i.test(x.name));
  return a?.url ?? null;
}

function detectOs(): Os {
  const hay = `${navigator.platform || ""} ${navigator.userAgent || ""}`.toLowerCase();
  if (/android|iphone|ipad|ipod/.test(hay)) return null; // desktop app n/a on mobile
  // iPadOS Safari masquerades as "MacIntel"/"Macintosh"; a touch-capable "Mac"
  // is really an iPad, so don't hand it a .dmg — fall back to Releases.
  if (/mac/.test(hay)) return navigator.maxTouchPoints > 1 ? null : "mac";
  if (/win/.test(hay)) return "windows";
  if (/linux|x11|cros/.test(hay)) return "linux";
  return null;
}

/** Best-effort Apple-Silicon vs Intel; only meaningful for macOS. */
async function detectMacArch(): Promise<Arch> {
  // 1) UA Client Hints (Chromium) — most reliable when present
  try {
    const uaData = (
      navigator as unknown as {
        userAgentData?: {
          getHighEntropyValues?: (k: string[]) => Promise<{ architecture?: string }>;
        };
      }
    ).userAgentData;
    if (uaData?.getHighEntropyValues) {
      const hv = await uaData.getHighEntropyValues(["architecture"]);
      if (hv.architecture === "arm") return "arm64";
      if (hv.architecture === "x86") return "x64";
    }
  } catch {
    /* not supported — fall through */
  }
  // 2) WebGL GPU renderer heuristic (works in Safari too)
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const dbg = gl?.getExtension("WEBGL_debug_renderer_info");
    const renderer = (
      (dbg && (gl?.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string)) ||
      ""
    ).toLowerCase();
    if (renderer.includes("apple")) return "arm64";
    if (/intel|amd|radeon|nvidia|geforce/.test(renderer)) return "x64";
  } catch {
    /* blocked (e.g. resistFingerprinting) — fall through */
  }
  return null; // unknown → caller defaults to Apple Silicon
}

export function useDownload(): DownloadInfo {
  const [os, setOs] = useState<Os>(null);
  const [arch, setArch] = useState<Arch>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [urls, setUrls] = useState<AssetUrls | null>(null);

  useEffect(() => {
    const o = detectOs();
    setOs(o);
    let cancelled = false;
    (async () => {
      if (o === "mac") {
        const a = await detectMacArch();
        if (!cancelled) setArch(a);
      }
      const rel = await fetchLatest();
      if (cancelled || !rel) return;
      setVersion(rel.tag || null);
      setUrls({
        macArm: pick(rel.assets, /arm64\.dmg$/i),
        macX64: pick(rel.assets, /x64\.dmg$/i),
        win: pick(rel.assets, /\.exe$/i),
        linux: pick(rel.assets, /\.appimage$/i),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const osLabel =
    os === "mac" ? "Mac" : os === "windows" ? "Windows" : os === "linux" ? "Linux" : null;
  const archLabel = os === "mac" ? (arch === "x64" ? "Intel" : "Apple Silicon") : null;

  let href: string = SITE.releases;
  if (urls) {
    if (os === "mac") href = (arch === "x64" ? urls.macX64 : urls.macArm) ?? SITE.releases;
    else if (os === "windows") href = urls.win ?? SITE.releases;
    else if (os === "linux") href = urls.linux ?? SITE.releases;
  }
  const isDirect = href !== SITE.releases;

  return {
    os,
    osLabel,
    arch,
    archLabel,
    version,
    href,
    isDirect,
    urls,
    releasesUrl: SITE.releases,
  };
}
