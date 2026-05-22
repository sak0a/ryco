import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ConfigProvider, Effect, Option } from "effect";

import {
  COPILOT_SDK_PACKAGE_JSON_PATH,
  DESKTOP_BUILD_FILES,
  EXTERNALIZED_DESKTOP_DEPENDENCY_PATHS,
  resolveBuildOptions,
  resolveDesktopBuildIconAssets,
  resolveDesktopProductName,
  resolveDesktopUpdateChannel,
  resolveDesktopWebAssetBrand,
  resolveMockUpdateServerPort,
  resolveMockUpdateServerUrl,
} from "./build-desktop-artifact.ts";
import { BRAND_ASSET_PATHS } from "./lib/brand-assets.ts";

it.layer(NodeServices.layer)("build-desktop-artifact", (it) => {
  it("resolves the dedicated nightly updater channel from nightly versions", () => {
    assert.equal(resolveDesktopUpdateChannel("0.0.17-nightly.20260413.42"), "nightly");
    assert.equal(resolveDesktopUpdateChannel("0.0.17"), "latest");
  });

  it("switches desktop packaging product names to nightly for nightly builds", () => {
    assert.equal(resolveDesktopProductName("0.0.17"), "Ryco");
    assert.equal(resolveDesktopProductName("0.0.17-nightly.20260413.42"), "Ryco (Nightly)");
  });

  it("switches desktop packaging icons to the nightly artwork for nightly versions", () => {
    assert.deepStrictEqual(resolveDesktopBuildIconAssets("0.0.17"), {
      macIconPng: BRAND_ASSET_PATHS.productionMacIconPng,
      macIconset: BRAND_ASSET_PATHS.productionMacIconset,
      linuxIconPng: BRAND_ASSET_PATHS.productionLinuxIconPng,
      windowsIconIco: BRAND_ASSET_PATHS.productionWindowsIconIco,
    });

    assert.deepStrictEqual(resolveDesktopBuildIconAssets("0.0.17-nightly.20260413.42"), {
      macIconPng: BRAND_ASSET_PATHS.nightlyMacIconPng,
      macIconset: BRAND_ASSET_PATHS.nightlyMacIconset,
      linuxIconPng: BRAND_ASSET_PATHS.nightlyLinuxIconPng,
      windowsIconIco: BRAND_ASSET_PATHS.nightlyWindowsIconIco,
    });
  });

  it("switches packaged web assets to nightly artwork for nightly versions", () => {
    assert.equal(resolveDesktopWebAssetBrand("0.0.17"), "production");
    assert.equal(resolveDesktopWebAssetBrand("0.0.17-nightly.20260413.42"), "nightly");
  });

  it("excludes the bundled GitHub Copilot CLI from desktop artifacts", () => {
    assert.deepStrictEqual(DESKTOP_BUILD_FILES, [
      "**/*",
      "!node_modules/@github/copilot/**",
      "!node_modules/@github/copilot-darwin-arm64/**",
      "!node_modules/@github/copilot-darwin-x64/**",
      "!node_modules/@github/copilot-linux-arm64/**",
      "!node_modules/@github/copilot-linux-x64/**",
      "!node_modules/@github/copilot-win32-arm64/**",
      "!node_modules/@github/copilot-win32-x64/**",
    ]);
    assert.deepStrictEqual(EXTERNALIZED_DESKTOP_DEPENDENCY_PATHS, [
      "node_modules/@github/copilot",
      "node_modules/@github/copilot-darwin-arm64",
      "node_modules/@github/copilot-darwin-x64",
      "node_modules/@github/copilot-linux-arm64",
      "node_modules/@github/copilot-linux-x64",
      "node_modules/@github/copilot-win32-arm64",
      "node_modules/@github/copilot-win32-x64",
    ]);
    assert.equal(COPILOT_SDK_PACKAGE_JSON_PATH, "node_modules/@github/copilot-sdk/package.json");
  });

  it("falls back to the default mock update port when the configured port is blank", () => {
    assert.equal(resolveMockUpdateServerUrl(undefined), "http://localhost:3000");
    assert.equal(resolveMockUpdateServerUrl(4123), "http://localhost:4123");
  });

  it.effect("normalizes mock update server ports from env-style strings", () =>
    Effect.gen(function* () {
      assert.equal(yield* resolveMockUpdateServerPort(undefined), undefined);
      assert.equal(yield* resolveMockUpdateServerPort(""), undefined);
      assert.equal(yield* resolveMockUpdateServerPort("   "), undefined);
      assert.equal(yield* resolveMockUpdateServerPort("4123"), 4123);
    }),
  );

  it.effect("rejects non-numeric or out-of-range mock update ports", () =>
    Effect.gen(function* () {
      const invalidPorts = ["abc", "12.5", "0", "65536"];
      for (const port of invalidPorts) {
        const exit = yield* Effect.exit(resolveMockUpdateServerPort(port));
        assert.equal(exit._tag, "Failure");
      }
    }),
  );

  it.effect("preserves explicit false boolean flags over true env defaults", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveBuildOptions({
        platform: Option.some("mac"),
        target: Option.none(),
        arch: Option.some("arm64"),
        buildVersion: Option.none(),
        outputDir: Option.some("release-test"),
        skipBuild: Option.some(false),
        keepStage: Option.some(false),
        signed: Option.some(false),
        verbose: Option.some(false),
        mockUpdates: Option.some(false),
        mockUpdateServerPort: Option.none(),
      }).pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromEnv({
              env: {
                RYCO_DESKTOP_SKIP_BUILD: "true",
                RYCO_DESKTOP_KEEP_STAGE: "true",
                RYCO_DESKTOP_SIGNED: "true",
                RYCO_DESKTOP_VERBOSE: "true",
                RYCO_DESKTOP_MOCK_UPDATES: "true",
              },
            }),
          ),
        ),
      );

      assert.equal(resolved.skipBuild, false);
      assert.equal(resolved.keepStage, false);
      assert.equal(resolved.signed, false);
      assert.equal(resolved.verbose, false);
      assert.equal(resolved.mockUpdates, false);
    }),
  );
});
