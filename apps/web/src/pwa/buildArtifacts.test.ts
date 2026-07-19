import { describe, expect, it } from "vite-plus/test";

import { resolveHostedPwaPrecache } from "./buildArtifacts";

describe("hosted PWA build artifacts", () => {
  const entries = [
    { fileName: "assets/main-AbCd1234.js" },
    { fileName: "assets/main-EfGh5678.css" },
    { fileName: "assets/mono-IjKl9012.woff2" },
    { fileName: "assets/logo-MnOp3456.png" },
    { fileName: "assets/main-AbCd1234.js.map" },
    { fileName: "index.html" },
    { fileName: "site.webmanifest" },
    { fileName: "favicon-96x96.png" },
    { fileName: "assets/unversioned.js" },
    { fileName: "assets/readme-QrSt7890.txt" },
  ] as const;

  it("allows only fingerprinted immutable shell assets plus the offline document", () => {
    expect(resolveHostedPwaPrecache({ base: "/", entries }).urls).toEqual([
      "/assets/logo-MnOp3456.png",
      "/assets/main-AbCd1234.js",
      "/assets/main-EfGh5678.css",
      "/assets/mono-IjKl9012.woff2",
      "/offline.html",
    ]);
  });

  it("respects a configured public base path", () => {
    expect(resolveHostedPwaPrecache({ base: "/ryco/", entries }).urls).toEqual([
      "/ryco/assets/logo-MnOp3456.png",
      "/ryco/assets/main-AbCd1234.js",
      "/ryco/assets/main-EfGh5678.css",
      "/ryco/assets/mono-IjKl9012.woff2",
      "/ryco/offline.html",
    ]);
  });

  it("derives a deterministic cache key from immutable output names", () => {
    const first = resolveHostedPwaPrecache({ base: "/", entries });
    const reordered = resolveHostedPwaPrecache({ base: "/", entries: [...entries].reverse() });
    const changed = resolveHostedPwaPrecache({
      base: "/",
      entries: entries.map((entry) =>
        entry.fileName === "assets/main-AbCd1234.js"
          ? { fileName: "assets/main-ZyXw9876.js" }
          : entry,
      ),
    });

    expect(first.cacheName).toMatch(/^ryco-pwa-shell-[a-f0-9]{16}$/);
    expect(reordered).toEqual(first);
    expect(changed.cacheName).not.toBe(first.cacheName);
  });
});
