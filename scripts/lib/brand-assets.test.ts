import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

import {
  BRAND_ASSET_PATHS,
  DEVELOPMENT_ICON_OVERRIDES,
  NIGHTLY_ICON_OVERRIDES,
  PUBLISH_ICON_OVERRIDES,
  resolveWebIconOverrides,
} from "./brand-assets.ts";

describe("brand-assets", () => {
  it("maps server publish web assets to production icons", () => {
    expect(PUBLISH_ICON_OVERRIDES).toEqual([
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebFaviconIco,
        targetRelativePath: "dist/client/favicon.ico",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebFaviconSvg,
        targetRelativePath: "dist/client/favicon.svg",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebFavicon96Png,
        targetRelativePath: "dist/client/favicon-96x96.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
        targetRelativePath: "dist/client/apple-touch-icon.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebManifest192Png,
        targetRelativePath: "dist/client/web-app-manifest-192x192.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebManifest512Png,
        targetRelativePath: "dist/client/web-app-manifest-512x512.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebSiteManifest,
        targetRelativePath: "dist/client/site.webmanifest",
      },
    ]);
  });

  it("maps nightly packaged web assets to nightly icons", () => {
    expect(NIGHTLY_ICON_OVERRIDES).toEqual([
      {
        sourceRelativePath: BRAND_ASSET_PATHS.nightlyWebFaviconIco,
        targetRelativePath: "dist/client/favicon.ico",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.nightlyWebFaviconSvg,
        targetRelativePath: "dist/client/favicon.svg",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.nightlyWebFavicon96Png,
        targetRelativePath: "dist/client/favicon-96x96.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.nightlyWebAppleTouchIconPng,
        targetRelativePath: "dist/client/apple-touch-icon.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.nightlyWebManifest192Png,
        targetRelativePath: "dist/client/web-app-manifest-192x192.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.nightlyWebManifest512Png,
        targetRelativePath: "dist/client/web-app-manifest-512x512.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.nightlyWebSiteManifest,
        targetRelativePath: "dist/client/site.webmanifest",
      },
    ]);
  });

  it("maps server build web assets to development icons", () => {
    expect(DEVELOPMENT_ICON_OVERRIDES).toEqual([
      {
        sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFaviconIco,
        targetRelativePath: "dist/client/favicon.ico",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFaviconSvg,
        targetRelativePath: "dist/client/favicon.svg",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFavicon96Png,
        targetRelativePath: "dist/client/favicon-96x96.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng,
        targetRelativePath: "dist/client/apple-touch-icon.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.developmentWebManifest192Png,
        targetRelativePath: "dist/client/web-app-manifest-192x192.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.developmentWebManifest512Png,
        targetRelativePath: "dist/client/web-app-manifest-512x512.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.developmentWebSiteManifest,
        targetRelativePath: "dist/client/site.webmanifest",
      },
    ]);
  });

  it("can target hosted web dist directly", () => {
    expect(resolveWebIconOverrides("production", "apps/web/dist")).toContainEqual({
      sourceRelativePath: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
      targetRelativePath: "apps/web/dist/apple-touch-icon.png",
    });
  });

  it.each([
    BRAND_ASSET_PATHS.productionWebSiteManifest,
    BRAND_ASSET_PATHS.nightlyWebSiteManifest,
    BRAND_ASSET_PATHS.developmentWebSiteManifest,
    "apps/web/public/site.webmanifest",
  ])("keeps %s installable within its serving scope", (manifestPath) => {
    const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
    const manifest = JSON.parse(readFileSync(`${repoRoot}/${manifestPath}`, "utf8")) as {
      readonly id?: string;
      readonly start_url?: string;
      readonly scope?: string;
      readonly display?: string;
      readonly icons?: ReadonlyArray<{ readonly purpose?: string }>;
    };

    expect(manifest).toMatchObject({ id: ".", start_url: ".", scope: ".", display: "standalone" });
    expect(manifest.icons).toHaveLength(2);
    expect(manifest.icons?.every((icon) => icon.purpose === "any maskable")).toBe(true);
  });
});
