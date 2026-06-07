import { spawnSync } from "node:child_process";
import * as path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ConfigProvider, Effect, Option } from "effect";

import {
  COPILOT_SDK_PACKAGE_JSON_PATH,
  DESKTOP_BUILD_FILES,
  DESKTOP_BUILD_RESOURCES_RELATIVE_DIR,
  EXTERNALIZED_DESKTOP_DEPENDENCY_PATHS,
  MAC_UNSIGNED_INSTALL_HELPER_NAME,
  MAC_UNSIGNED_README_NAME,
  createMacUnsignedInstallReadme,
  createMacUnsignedInstallScript,
  createBuildConfig,
  resolveBuildOptions,
  resolveDesktopBuildIconAssets,
  resolveDesktopProductName,
  resolveDesktopUpdateChannel,
  resolveDesktopWebAssetBrand,
  resolveMockUpdateServerPort,
  resolveMockUpdateServerUrl,
} from "./build-desktop-artifact.ts";
import { BRAND_ASSET_PATHS } from "./lib/brand-assets.ts";

interface TurboDryRunTask {
  readonly taskId: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly resolvedTaskDefinition: {
    readonly cache?: boolean;
    readonly dependsOn?: ReadonlyArray<string>;
  };
}

interface TurboDryRun {
  readonly tasks: ReadonlyArray<TurboDryRunTask>;
}

const repoRoot = path.resolve(import.meta.dirname, "..");

const parseTurboDryRun = (output: string): TurboDryRun => {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");

  assert.ok(start >= 0 && end > start, `Expected Turbo dry-run JSON output, received:\n${output}`);
  return JSON.parse(output.slice(start, end + 1)) as TurboDryRun;
};

const getTask = (dryRun: TurboDryRun, taskId: string): TurboDryRunTask => {
  const task = dryRun.tasks.find((candidate) => candidate.taskId === taskId);
  assert.ok(
    task,
    `Expected Turbo dry-run task ${taskId}; tasks were: ${dryRun.tasks
      .map((candidate) => candidate.taskId)
      .join(", ")}`,
  );
  return task;
};

it.layer(NodeServices.layer)("build-desktop-artifact", (it) => {
  it("builds the web app before bundling it into the desktop server", () => {
    const result = spawnSync("bun", ["run", "build:desktop", "--dry=json"], {
      cwd: repoRoot,
      encoding: "utf8",
      shell: process.platform === "win32",
    });

    assert.equal(
      result.status,
      0,
      `Expected build:desktop dry-run to pass.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );

    const dryRun = parseTurboDryRun(`${result.stdout}\n${result.stderr}`);
    getTask(dryRun, "@ryco/web#build");
    getTask(dryRun, "@ryco/desktop#build");

    const serverTask = getTask(dryRun, "ryco-cli#build");
    assert.ok(serverTask.dependencies.includes("@ryco/web#build"));
    assert.ok(serverTask.resolvedTaskDefinition.dependsOn?.includes("@ryco/web#build"));
    assert.equal(serverTask.resolvedTaskDefinition.cache, false);
  });

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

  it("generates an unsigned macOS install helper for stable and nightly bundle names", () => {
    assert.equal(MAC_UNSIGNED_INSTALL_HELPER_NAME, "Install Ryco.command");
    assert.equal(MAC_UNSIGNED_README_NAME, "README-macOS.txt");

    const stableScript = createMacUnsignedInstallScript("Ryco");
    assert.ok(stableScript.includes("APP_NAME='Ryco.app'"));
    assert.ok(stableScript.includes("xattr -dr com.apple.quarantine"));
    assert.ok(stableScript.includes('TARGET_APP="/Applications/$APP_NAME"'));

    const nightlyScript = createMacUnsignedInstallScript("Ryco (Nightly)");
    assert.ok(nightlyScript.includes("APP_NAME='Ryco (Nightly).app'"));
    assert.ok(nightlyScript.includes('ditto "$SOURCE_APP" "$TARGET_APP"'));
  });

  it("explains the unsigned macOS install fallback without promising notarization", () => {
    const readme = createMacUnsignedInstallReadme("Ryco");
    assert.ok(readme.includes("unsigned and not notarized"));
    assert.ok(readme.includes("Apple requires a paid Developer ID account"));
    assert.ok(readme.includes('xattr -dr com.apple.quarantine "/Applications/Ryco.app"'));
    assert.ok(readme.includes("https://github.com/sak0a/ryco/releases"));
  });

  it.effect("uses electron-builder's current DMG window schema", () =>
    Effect.gen(function* () {
      const config = yield* createBuildConfig("mac", "dmg", "0.1.1", false, false, undefined, {
        installHelperFilePath: "/tmp/Install Ryco.command",
        readmeFilePath: "/tmp/README-macOS.txt",
        installHelperDmgPath: `${DESKTOP_BUILD_RESOURCES_RELATIVE_DIR}/Install Ryco.command`,
        readmeDmgPath: `${DESKTOP_BUILD_RESOURCES_RELATIVE_DIR}/README-macOS.txt`,
      });

      assert.deepStrictEqual(config.dmg, {
        window: {
          width: 560,
          height: 430,
        },
        contents: [
          {
            x: 140,
            y: 155,
            type: "file",
          },
          {
            x: 420,
            y: 155,
            type: "link",
            path: "/Applications",
          },
          {
            x: 140,
            y: 320,
            type: "file",
            path: `${DESKTOP_BUILD_RESOURCES_RELATIVE_DIR}/Install Ryco.command`,
            name: MAC_UNSIGNED_INSTALL_HELPER_NAME,
          },
          {
            x: 420,
            y: 320,
            type: "file",
            path: `${DESKTOP_BUILD_RESOURCES_RELATIVE_DIR}/README-macOS.txt`,
            name: MAC_UNSIGNED_README_NAME,
          },
        ],
        iconSize: 80,
        iconTextSize: 12,
      });
    }),
  );

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
