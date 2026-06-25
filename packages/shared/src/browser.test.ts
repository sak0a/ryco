import { describe, expect, it } from "vite-plus/test";

import { normalizeBrowserNavigationUrl, sanitizeBrowserProfileKey } from "./browser.ts";

describe("browser shared helpers", () => {
  it("normalizes ordinary URLs and origin metadata", () => {
    const result = normalizeBrowserNavigationUrl("example.com/path");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.url).toBe("https://example.com/path");
    expect(result.value.origin).toBe("https://example.com");
    expect(result.value.kind).toBe("http");
  });

  it("classifies loopback and private origins distinctly", () => {
    const localhost = normalizeBrowserNavigationUrl("http://localhost:5173");
    const privateNetwork = normalizeBrowserNavigationUrl("http://192.168.1.25");
    expect(localhost.ok && localhost.value.kind).toBe("loopback");
    expect(privateNetwork.ok && privateNetwork.value.kind).toBe("private-network");
  });

  it("rejects empty, invalid, and unsafe schemes", () => {
    expect(normalizeBrowserNavigationUrl("").ok).toBe(false);
    expect(normalizeBrowserNavigationUrl("http://[broken").ok).toBe(false);
    const javascriptUrl = normalizeBrowserNavigationUrl("javascript:alert(1)");
    expect(javascriptUrl.ok).toBe(false);
    expect(!javascriptUrl.ok && javascriptUrl.reason).toBe("blocked-scheme");
  });

  it("keeps browser profile keys path-safe and bounded", () => {
    const key = sanitizeBrowserProfileKey("../../Admin/Profile Name With Spaces");
    expect(key).toMatch(/^[a-z0-9._-]+$/);
    expect(key).not.toContain("/");
    expect(key).not.toContain("\\");
    expect(key.startsWith("admin-profile-name-with-spaces-")).toBe(true);
    expect(key.length).toBeLessThanOrEqual(80);

    const longKey = sanitizeBrowserProfileKey("x".repeat(500));
    expect(longKey.length).toBeLessThanOrEqual(80);
  });
});
