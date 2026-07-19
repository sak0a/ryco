import { describe, expect, it } from "vite-plus/test";

import { renderHostedPwaServiceWorker, resolveHostedPwaPrecache } from "./buildArtifacts";
import { renderHostedPwaOfflineDocument } from "./offlineDocument";

describe("hosted PWA build artifacts", () => {
  const entries = [
    {
      fileName: "assets/main-AbCd1234.js",
      isEntry: true,
      dynamicImports: ["assets/lazy-UvWx1234.js"],
      imports: ["assets/vendor-QrSt7890.js"],
      importedCss: ["assets/main-EfGh5678.css"],
      importedAssets: ["assets/mono-IjKl9012.woff2", "assets/logo-MnOp3456.png"],
    },
    { fileName: "assets/vendor-QrSt7890.js" },
    { fileName: "assets/main-EfGh5678.css" },
    { fileName: "assets/mono-IjKl9012.woff2" },
    { fileName: "assets/logo-MnOp3456.png" },
    { fileName: "assets/main-AbCd1234.js.map" },
    { fileName: "index.html" },
    { fileName: "site.webmanifest" },
    { fileName: "favicon-96x96.png" },
    { fileName: "assets/unversioned.js" },
    { fileName: "assets/readme-QrSt7890.txt" },
    {
      fileName: "assets/lazy-UvWx1234.js",
      imports: ["assets/lazy-dependency-YzAb5678.js"],
    },
    { fileName: "assets/lazy-dependency-YzAb5678.js" },
  ] as const;

  it("allows only fingerprinted immutable shell assets plus the offline document", () => {
    expect(resolveHostedPwaPrecache({ base: "/", entries }).urls).toEqual([
      "/assets/lazy-UvWx1234.js",
      "/assets/lazy-dependency-YzAb5678.js",
      "/assets/logo-MnOp3456.png",
      "/assets/main-AbCd1234.js",
      "/assets/main-EfGh5678.css",
      "/assets/mono-IjKl9012.woff2",
      "/assets/vendor-QrSt7890.js",
      "/offline.html",
    ]);
  });

  it("respects a configured public base path", () => {
    expect(resolveHostedPwaPrecache({ base: "/ryco/", entries }).urls).toEqual([
      "/ryco/assets/lazy-UvWx1234.js",
      "/ryco/assets/lazy-dependency-YzAb5678.js",
      "/ryco/assets/logo-MnOp3456.png",
      "/ryco/assets/main-AbCd1234.js",
      "/ryco/assets/main-EfGh5678.css",
      "/ryco/assets/mono-IjKl9012.woff2",
      "/ryco/assets/vendor-QrSt7890.js",
      "/ryco/offline.html",
    ]);
  });

  it("derives a deterministic cache key from immutable output names", () => {
    const first = resolveHostedPwaPrecache({ base: "/", entries });
    const reordered = resolveHostedPwaPrecache({ base: "/", entries: entries.toReversed() });
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

  it("renders a bounded worker that caches only the resolved allowlist", () => {
    const precache = resolveHostedPwaPrecache({ base: "/", entries });
    const source = renderHostedPwaServiceWorker(precache);

    expect(source).toContain(JSON.stringify(precache.cacheName));
    expect(source).toContain(JSON.stringify(precache.urls));
    expect(source).toContain('request.mode === "navigate"');
    expect(source).toContain('request.headers.has("range")');
    expect(source).toContain("event.data?.type === ACTIVATION_MESSAGE");
    expect(source).not.toContain("index.html");
    expect(source).not.toContain('skipWaiting();\n});\n\nself.addEventListener("activate"');
  });

  it("renders a self-contained offline document without application data hooks", () => {
    const source = renderHostedPwaOfflineDocument({ startUrl: "/ryco/" });

    expect(source).toContain('href="/ryco/"');
    expect(source).toContain("No project or conversation data is stored");
    expect(source).not.toContain("<script");
    expect(source).not.toContain("/api/");
    expect(source).not.toContain("localStorage");
  });
});
