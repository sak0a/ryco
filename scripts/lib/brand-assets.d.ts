export declare const BRAND_ASSET_PATHS: {
  readonly productionMacIconPng: "assets/prod/ryco-macos-1024.png";
  readonly productionMacIconset: "assets/prod/ryco-macos.iconset";
  readonly productionLinuxIconPng: "assets/prod/ryco-linux-1024.png";
  readonly productionWindowsIconIco: "assets/prod/ryco-windows.ico";
  readonly productionWebFaviconIco: "assets/prod/favicon/favicon.ico";
  readonly productionWebFaviconSvg: "assets/prod/favicon/favicon.svg";
  readonly productionWebFavicon96Png: "assets/prod/favicon/favicon-96x96.png";
  readonly productionWebAppleTouchIconPng: "assets/prod/favicon/apple-touch-icon.png";
  readonly productionWebManifest192Png: "assets/prod/favicon/web-app-manifest-192x192.png";
  readonly productionWebManifest512Png: "assets/prod/favicon/web-app-manifest-512x512.png";
  readonly productionWebSiteManifest: "assets/prod/favicon/site.webmanifest";
  readonly nightlyMacIconPng: "assets/nightly/ryco-macos-1024.png";
  readonly nightlyMacIconset: "assets/nightly/ryco-macos.iconset";
  readonly nightlyLinuxIconPng: "assets/nightly/ryco-linux-1024.png";
  readonly nightlyWindowsIconIco: "assets/nightly/ryco-windows.ico";
  readonly nightlyWebFaviconIco: "assets/nightly/favicon/favicon.ico";
  readonly nightlyWebFaviconSvg: "assets/nightly/favicon/favicon.svg";
  readonly nightlyWebFavicon96Png: "assets/nightly/favicon/favicon-96x96.png";
  readonly nightlyWebAppleTouchIconPng: "assets/nightly/favicon/apple-touch-icon.png";
  readonly nightlyWebManifest192Png: "assets/nightly/favicon/web-app-manifest-192x192.png";
  readonly nightlyWebManifest512Png: "assets/nightly/favicon/web-app-manifest-512x512.png";
  readonly nightlyWebSiteManifest: "assets/nightly/favicon/site.webmanifest";
  readonly developmentDesktopIconPng: "assets/dev/ryco-macos-1024.png";
  readonly developmentMacIconset: "assets/dev/ryco-macos.iconset";
  readonly developmentLinuxIconPng: "assets/dev/ryco-linux-1024.png";
  readonly developmentWindowsIconIco: "assets/dev/ryco-windows.ico";
  readonly developmentWebFaviconIco: "assets/dev/favicon/favicon.ico";
  readonly developmentWebFaviconSvg: "assets/dev/favicon/favicon.svg";
  readonly developmentWebFavicon96Png: "assets/dev/favicon/favicon-96x96.png";
  readonly developmentWebAppleTouchIconPng: "assets/dev/favicon/apple-touch-icon.png";
  readonly developmentWebManifest192Png: "assets/dev/favicon/web-app-manifest-192x192.png";
  readonly developmentWebManifest512Png: "assets/dev/favicon/web-app-manifest-512x512.png";
  readonly developmentWebSiteManifest: "assets/dev/favicon/site.webmanifest";
};
export type WebAssetBrand = "development" | "nightly" | "production";
export interface IconOverride {
  readonly sourceRelativePath: string;
  readonly targetRelativePath: string;
}
export declare function resolveWebIconOverrides(
  brand: WebAssetBrand,
  targetDirectory: string,
): ReadonlyArray<IconOverride>;
export declare const DEVELOPMENT_ICON_OVERRIDES: readonly IconOverride[];
export declare const NIGHTLY_ICON_OVERRIDES: readonly IconOverride[];
export declare const PUBLISH_ICON_OVERRIDES: readonly IconOverride[];
