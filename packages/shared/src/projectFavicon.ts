// Ported from pingdotgg/t3code (packages/shared/src/projectFavicon.ts) at commit
// 67a7b1a1. Copyright (c) 2026 T3 Tools Inc. Licensed under the MIT License; see
// packages/shared/NOTICE.md for the full notice. Re-namespaced from T3 to Ryco
// for @ryco/shared.

export const PROJECT_FAVICON_FALLBACK_MARKER = "project-favicon-missing";

export function isProjectFaviconFallbackUrl(url: string | null | undefined): boolean {
  if (!url) return false;

  try {
    const pathname = new URL(url, "https://ryco.invalid").pathname;
    return pathname.slice(pathname.lastIndexOf("/") + 1) === PROJECT_FAVICON_FALLBACK_MARKER;
  } catch {
    return false;
  }
}
