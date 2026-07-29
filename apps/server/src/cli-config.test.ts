import os from "node:os";
import { join } from "node:path";

import { assert, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, FileSystem, Layer, Option, Path } from "effect";

import { NetService } from "@ryco/shared/Net";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DEFAULT_HUB_CONNECTOR_CONFIG,
  deriveServerPaths,
  resolveHubConnectorConfig,
} from "./config.ts";
import { resolveServerConfig } from "./cli.ts";

it("resolves bounded connector defaults and invalid enabled configuration without reflecting input", () => {
  expect(resolveHubConnectorConfig({})).toEqual(DEFAULT_HUB_CONNECTOR_CONFIG);
  expect(
    resolveHubConnectorConfig({
      enabled: "true",
      origin: "https://relay.example",
      reconnectBaseMs: "250",
      reconnectMaxMs: "300000",
      reconnectStableMs: "5000",
      reconnectJitterRatio: "0.5",
      allowFileSecretStore: "true",
    }),
  ).toEqual({
    enabled: true,
    origin: "https://relay.example",
    reconnectBaseMs: 250,
    reconnectMaxMs: 300_000,
    reconnectStableMs: 5_000,
    reconnectJitterRatio: 0.5,
    allowFileSecretStore: true,
    configurationIssue: undefined,
  });

  const invalid = resolveHubConnectorConfig({
    enabled: "true",
    origin: "https://credential:sensitive@relay.example/path?token=sensitive",
    reconnectBaseMs: "0",
    reconnectMaxMs: "not-a-number",
  });
  expect(invalid).toEqual({
    ...DEFAULT_HUB_CONNECTOR_CONFIG,
    enabled: true,
    configurationIssue: "configuration_invalid",
  });
  expect(JSON.stringify(invalid)).not.toContain("sensitive");
});

it.layer(NodeServices.layer)("cli config resolution", (it) => {
  const defaultObservabilityConfig = {
    traceMinLevel: "Info",
    traceTimingEnabled: true,
    traceBatchWindowMs: 200,
    traceMaxBytes: 10 * 1024 * 1024,
    traceMaxFiles: 10,
    otlpTracesUrl: undefined,
    otlpMetricsUrl: undefined,
    otlpExportIntervalMs: 10_000,
    otlpServiceName: "ryco-server",
  } as const;
  const defaultConnectorConfig = { hubConnector: DEFAULT_HUB_CONNECTOR_CONFIG } as const;

  const openBootstrapFd = Effect.fn(function* (payload: Record<string, unknown>) {
    const fs = yield* FileSystem.FileSystem;
    const filePath = yield* fs.makeTempFileScoped({ prefix: "ryco-bootstrap-", suffix: ".ndjson" });
    yield* fs.writeFileString(filePath, `${JSON.stringify(payload)}\n`);
    const { fd } = yield* fs.open(filePath, { flag: "r" });
    return fd;
  });

  type ResolveServerFlags = Parameters<typeof resolveServerConfig>[0];

  const makeServerFlags = (
    baseDir: string,
    overrides: Partial<ResolveServerFlags> = {},
  ): ResolveServerFlags => ({
    mode: Option.none(),
    port: Option.some(0),
    host: Option.some("127.0.0.1"),
    baseDir: Option.some(baseDir),
    cwd: Option.none(),
    devUrl: Option.none(),
    noBrowser: Option.none(),
    bootstrapFd: Option.none(),
    autoBootstrapProjectFromCwd: Option.none(),
    logWebSocketEvents: Option.none(),
    tailscaleServeEnabled: Option.none(),
    tailscaleServePort: Option.none(),
    ...overrides,
  });

  const resolveHubServerConfig = (
    testName: string,
    overrides: Partial<ResolveServerFlags>,
    env: Record<string, string>,
  ) =>
    resolveServerConfig(
      makeServerFlags(join(os.tmpdir(), `ryco-cli-config-hub-${testName}`), overrides),
      Option.none(),
    ).pipe(
      Effect.provide(
        Layer.mergeAll(ConfigProvider.layer(ConfigProvider.fromEnv({ env })), NetService.layer),
      ),
    );

  it.effect("preserves Hub environment configuration when CLI flags are omitted", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveHubServerConfig(
        "environment",
        {},
        {
          RYCO_HUB_CONNECTOR_ENABLED: "true",
          RYCO_HUB_ORIGIN: "https://environment.example",
          RYCO_HUB_ALLOW_FILE_SECRET_STORE: "true",
        },
      );

      expect(resolved.hubConnector).toEqual({
        ...DEFAULT_HUB_CONNECTOR_CONFIG,
        enabled: true,
        origin: "https://environment.example",
        allowFileSecretStore: true,
      });
    }),
  );

  it.effect("uses positive Hub CLI flags before environment values", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveHubServerConfig(
        "positive-flags",
        {
          hubConnectorEnabled: Option.some(true),
          hubOrigin: Option.some("https://cli.example"),
          hubAllowFileSecretStore: Option.some(true),
        },
        {
          RYCO_HUB_CONNECTOR_ENABLED: "false",
          RYCO_HUB_ORIGIN: "https://environment.example",
          RYCO_HUB_ALLOW_FILE_SECRET_STORE: "false",
        },
      );

      expect(resolved.hubConnector).toEqual({
        ...DEFAULT_HUB_CONNECTOR_CONFIG,
        enabled: true,
        origin: "https://cli.example",
        allowFileSecretStore: true,
      });
    }),
  );

  it.effect("uses negative Hub CLI flags before true environment values", () =>
    Effect.gen(function* () {
      const disabled = yield* resolveHubServerConfig(
        "disabled-flag",
        { hubConnectorEnabled: Option.some(false) },
        {
          RYCO_HUB_CONNECTOR_ENABLED: "true",
          RYCO_HUB_ORIGIN: "https://environment.example",
          RYCO_HUB_ALLOW_FILE_SECRET_STORE: "true",
        },
      );
      expect(disabled.hubConnector).toEqual(DEFAULT_HUB_CONNECTOR_CONFIG);

      const fileFallbackDisabled = yield* resolveHubServerConfig(
        "file-fallback-disabled",
        {
          hubConnectorEnabled: Option.some(true),
          hubOrigin: Option.some("https://cli.example"),
          hubAllowFileSecretStore: Option.some(false),
        },
        {
          RYCO_HUB_ALLOW_FILE_SECRET_STORE: "true",
        },
      );
      expect(fileFallbackDisabled.hubConnector).toEqual({
        ...DEFAULT_HUB_CONNECTOR_CONFIG,
        enabled: true,
        origin: "https://cli.example",
      });
    }),
  );

  it.effect("keeps invalid CLI origins fail-closed and out of resolved configuration", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveHubServerConfig(
        "invalid-origin",
        {
          hubConnectorEnabled: Option.some(true),
          hubOrigin: Option.some("https://private-canary@example.test/path"),
        },
        {},
      );

      expect(resolved.hubConnector).toEqual({
        ...DEFAULT_HUB_CONNECTOR_CONFIG,
        enabled: true,
        configurationIssue: "configuration_invalid",
      });
      expect(JSON.stringify(resolved.hubConnector)).not.toContain("private-canary");
    }),
  );

  it.effect("falls back to effect/config values when flags are omitted", () =>
    Effect.gen(function* () {
      const { join } = yield* Path.Path;
      const baseDir = join(os.tmpdir(), "ryco-cli-config-env-base");
      const derivedPaths = yield* deriveServerPaths(baseDir, new URL("http://127.0.0.1:5173"));
      const resolved = yield* resolveServerConfig(
        {
          mode: Option.none(),
          port: Option.none(),
          host: Option.none(),
          baseDir: Option.none(),
          cwd: Option.none(),
          devUrl: Option.none(),
          noBrowser: Option.none(),
          bootstrapFd: Option.none(),
          autoBootstrapProjectFromCwd: Option.none(),
          logWebSocketEvents: Option.none(),
          tailscaleServeEnabled: Option.none(),
          tailscaleServePort: Option.none(),
        },
        Option.none(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            ConfigProvider.layer(
              ConfigProvider.fromEnv({
                env: {
                  RYCO_LOG_LEVEL: "Warn",
                  RYCO_MODE: "desktop",
                  RYCO_PORT: "4001",
                  RYCO_HOST: "0.0.0.0",
                  RYCO_HOME: baseDir,
                  VITE_DEV_SERVER_URL: "http://127.0.0.1:5173",
                  RYCO_NO_BROWSER: "true",
                  RYCO_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "false",
                  RYCO_LOG_WS_EVENTS: "true",
                },
              }),
            ),
            NetService.layer,
          ),
        ),
      );

      expect(resolved).toEqual({
        logLevel: "Warn",
        ...defaultObservabilityConfig,
        ...defaultConnectorConfig,
        mode: "desktop",
        port: 4001,
        cwd: process.cwd(),
        baseDir,
        ...derivedPaths,
        host: "0.0.0.0",
        staticDir: undefined,
        devUrl: new URL("http://127.0.0.1:5173"),
        noBrowser: true,
        startupPresentation: "browser",
        desktopBootstrapToken: undefined,
        autoBootstrapProjectFromCwd: false,
        logWebSocketEvents: true,
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
      });
    }),
  );

  it.effect("uses CLI flags when provided", () =>
    Effect.gen(function* () {
      const { join } = yield* Path.Path;
      const baseDir = join(os.tmpdir(), "ryco-cli-config-flags-base");
      const derivedPaths = yield* deriveServerPaths(baseDir, new URL("http://127.0.0.1:4173"));
      const resolved = yield* resolveServerConfig(
        {
          mode: Option.some("web"),
          port: Option.some(8788),
          host: Option.some("127.0.0.1"),
          baseDir: Option.some(baseDir),
          cwd: Option.none(),
          devUrl: Option.some(new URL("http://127.0.0.1:4173")),
          noBrowser: Option.some(true),
          bootstrapFd: Option.none(),
          autoBootstrapProjectFromCwd: Option.some(true),
          logWebSocketEvents: Option.some(true),
          tailscaleServeEnabled: Option.some(true),
          tailscaleServePort: Option.some(8443),
        },
        Option.some("Debug"),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            ConfigProvider.layer(
              ConfigProvider.fromEnv({
                env: {
                  RYCO_LOG_LEVEL: "Warn",
                  RYCO_MODE: "desktop",
                  RYCO_PORT: "4001",
                  RYCO_HOST: "0.0.0.0",
                  RYCO_HOME: join(os.tmpdir(), "ignored-base"),
                  VITE_DEV_SERVER_URL: "http://127.0.0.1:5173",
                  RYCO_NO_BROWSER: "false",
                  RYCO_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "false",
                  RYCO_LOG_WS_EVENTS: "false",
                },
              }),
            ),
            NetService.layer,
          ),
        ),
      );

      expect(resolved).toEqual({
        logLevel: "Debug",
        ...defaultObservabilityConfig,
        ...defaultConnectorConfig,
        mode: "web",
        port: 8788,
        cwd: process.cwd(),
        baseDir,
        ...derivedPaths,
        host: "127.0.0.1",
        staticDir: undefined,
        devUrl: new URL("http://127.0.0.1:4173"),
        noBrowser: true,
        startupPresentation: "browser",
        desktopBootstrapToken: undefined,
        autoBootstrapProjectFromCwd: true,
        logWebSocketEvents: true,
        tailscaleServeEnabled: true,
        tailscaleServePort: 8443,
      });
    }),
  );

  it.effect("preserves explicit false CLI boolean flags over env and bootstrap values", () =>
    Effect.gen(function* () {
      const { join } = yield* Path.Path;
      const baseDir = join(os.tmpdir(), "ryco-cli-config-false-flags");
      const fd = yield* openBootstrapFd({
        noBrowser: true,
        autoBootstrapProjectFromCwd: true,
        logWebSocketEvents: true,
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
      });
      const derivedPaths = yield* deriveServerPaths(baseDir, new URL("http://127.0.0.1:4173"));

      const resolved = yield* resolveServerConfig(
        {
          mode: Option.some("web"),
          port: Option.some(8788),
          host: Option.some("127.0.0.1"),
          baseDir: Option.some(baseDir),
          cwd: Option.none(),
          devUrl: Option.some(new URL("http://127.0.0.1:4173")),
          noBrowser: Option.some(false),
          bootstrapFd: Option.none(),
          autoBootstrapProjectFromCwd: Option.some(false),
          logWebSocketEvents: Option.some(false),
          tailscaleServeEnabled: Option.none(),
          tailscaleServePort: Option.none(),
        },
        Option.none(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            ConfigProvider.layer(
              ConfigProvider.fromEnv({
                env: {
                  RYCO_BOOTSTRAP_FD: String(fd),
                  RYCO_NO_BROWSER: "true",
                  RYCO_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "true",
                  RYCO_LOG_WS_EVENTS: "true",
                },
              }),
            ),
            NetService.layer,
          ),
        ),
      );

      expect(resolved).toEqual({
        logLevel: "Info",
        ...defaultObservabilityConfig,
        ...defaultConnectorConfig,
        mode: "web",
        port: 8788,
        cwd: process.cwd(),
        baseDir,
        ...derivedPaths,
        host: "127.0.0.1",
        staticDir: undefined,
        devUrl: new URL("http://127.0.0.1:4173"),
        noBrowser: false,
        startupPresentation: "browser",
        desktopBootstrapToken: undefined,
        autoBootstrapProjectFromCwd: false,
        logWebSocketEvents: false,
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
      });
    }),
  );

  it.effect("uses bootstrap envelope values as fallbacks when flags and env are absent", () =>
    Effect.gen(function* () {
      const { join } = yield* Path.Path;
      const baseDir = "/tmp/ryco-bootstrap-home";
      const fd = yield* openBootstrapFd({
        mode: "desktop",
        port: 4888,
        host: "127.0.0.2",
        rycoHome: baseDir,
        devUrl: "http://127.0.0.1:5173",
        noBrowser: true,
        autoBootstrapProjectFromCwd: false,
        logWebSocketEvents: true,
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
        otlpTracesUrl: "http://localhost:4318/v1/traces",
        otlpMetricsUrl: "http://localhost:4318/v1/metrics",
      });
      const derivedPaths = yield* deriveServerPaths(baseDir, new URL("http://127.0.0.1:5173"));

      const resolved = yield* resolveServerConfig(
        {
          mode: Option.none(),
          port: Option.none(),
          host: Option.none(),
          baseDir: Option.none(),
          cwd: Option.none(),
          devUrl: Option.none(),
          noBrowser: Option.none(),
          bootstrapFd: Option.none(),
          autoBootstrapProjectFromCwd: Option.none(),
          logWebSocketEvents: Option.none(),
          tailscaleServeEnabled: Option.none(),
          tailscaleServePort: Option.none(),
        },
        Option.none(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            ConfigProvider.layer(
              ConfigProvider.fromEnv({
                env: {
                  RYCO_BOOTSTRAP_FD: String(fd),
                },
              }),
            ),
            NetService.layer,
          ),
        ),
      );

      expect(resolved).toEqual({
        logLevel: "Info",
        ...defaultObservabilityConfig,
        ...defaultConnectorConfig,
        otlpTracesUrl: "http://localhost:4318/v1/traces",
        otlpMetricsUrl: "http://localhost:4318/v1/metrics",
        mode: "desktop",
        port: 4888,
        cwd: process.cwd(),
        baseDir,
        ...derivedPaths,
        host: "127.0.0.2",
        staticDir: undefined,
        devUrl: new URL("http://127.0.0.1:5173"),
        noBrowser: true,
        startupPresentation: "browser",
        desktopBootstrapToken: undefined,
        autoBootstrapProjectFromCwd: false,
        logWebSocketEvents: true,
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
      });
      assert.equal(join(baseDir, "dev"), resolved.stateDir);
    }),
  );

  it.effect("creates derived runtime directories during config resolution", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "ryco-cli-config-dirs-" });
      const customCwd = path.join(baseDir, "nested", "project");

      const resolved = yield* resolveServerConfig(
        {
          mode: Option.some("desktop"),
          port: Option.some(4888),
          host: Option.none(),
          baseDir: Option.some(baseDir),
          cwd: Option.some(customCwd),
          devUrl: Option.some(new URL("http://127.0.0.1:5173")),
          noBrowser: Option.none(),
          bootstrapFd: Option.none(),
          autoBootstrapProjectFromCwd: Option.none(),
          logWebSocketEvents: Option.none(),
          tailscaleServeEnabled: Option.none(),
          tailscaleServePort: Option.none(),
        },
        Option.none(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
            NetService.layer,
          ),
        ),
      );

      for (const directory of [
        customCwd,
        resolved.stateDir,
        resolved.logsDir,
        resolved.providerLogsDir,
        resolved.terminalLogsDir,
        resolved.attachmentsDir,
        resolved.worktreesDir,
        path.dirname(resolved.serverLogPath),
        path.dirname(resolved.serverTracePath),
      ]) {
        expect(yield* fs.exists(directory)).toBe(true);
      }
      expect(resolved.cwd).toBe(path.resolve(customCwd));
    }),
  );

  it.effect("uses the canonical startup cwd as the restricted workspace root", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "ryco-cli-config-restricted-" });
      const customCwd = path.join(baseDir, "workspace");

      const resolved = yield* resolveServerConfig(
        makeServerFlags(baseDir, {
          cwd: Option.some(customCwd),
          restrictToCwd: Option.some(true),
        }),
        Option.none(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
            NetService.layer,
          ),
        ),
      );

      expect(resolved.cwd).toBe(path.resolve(customCwd));
      expect(resolved.workspaceAccessRoot).toBe(yield* fs.realPath(customCwd));
    }),
  );

  it.effect("keeps workspace access unrestricted when the flag is absent or disabled", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({
        prefix: "ryco-cli-config-unrestricted-",
      });

      const absent = yield* resolveServerConfig(makeServerFlags(baseDir), Option.none()).pipe(
        Effect.provide(
          Layer.mergeAll(
            ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
            NetService.layer,
          ),
        ),
      );
      const disabled = yield* resolveServerConfig(
        makeServerFlags(baseDir, { restrictToCwd: Option.some(false) }),
        Option.none(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
            NetService.layer,
          ),
        ),
      );

      expect(absent.workspaceAccessRoot).toBeUndefined();
      expect(disabled.workspaceAccessRoot).toBeUndefined();
    }),
  );

  it.effect("applies flag then env precedence over bootstrap envelope values", () =>
    Effect.gen(function* () {
      const { join } = yield* Path.Path;
      const baseDir = join(os.tmpdir(), "ryco-cli-config-env-wins");
      const fd = yield* openBootstrapFd({
        mode: "desktop",
        port: 4888,
        host: "127.0.0.2",
        rycoHome: "/tmp/ryco-bootstrap-home",
        devUrl: "http://127.0.0.1:5173",
        noBrowser: false,
        autoBootstrapProjectFromCwd: false,
        logWebSocketEvents: false,
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
      });
      const derivedPaths = yield* deriveServerPaths(baseDir, new URL("http://127.0.0.1:4173"));

      const resolved = yield* resolveServerConfig(
        {
          mode: Option.none(),
          port: Option.some(8788),
          host: Option.some("127.0.0.1"),
          baseDir: Option.none(),
          cwd: Option.none(),
          devUrl: Option.some(new URL("http://127.0.0.1:4173")),
          noBrowser: Option.none(),
          bootstrapFd: Option.none(),
          autoBootstrapProjectFromCwd: Option.none(),
          logWebSocketEvents: Option.none(),
          tailscaleServeEnabled: Option.none(),
          tailscaleServePort: Option.none(),
        },
        Option.some("Debug"),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            ConfigProvider.layer(
              ConfigProvider.fromEnv({
                env: {
                  RYCO_MODE: "web",
                  RYCO_BOOTSTRAP_FD: String(fd),
                  RYCO_HOME: baseDir,
                  RYCO_NO_BROWSER: "true",
                  RYCO_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "true",
                  RYCO_LOG_WS_EVENTS: "true",
                },
              }),
            ),
            NetService.layer,
          ),
        ),
      );

      expect(resolved).toEqual({
        logLevel: "Debug",
        ...defaultObservabilityConfig,
        ...defaultConnectorConfig,
        mode: "web",
        port: 8788,
        cwd: process.cwd(),
        baseDir,
        ...derivedPaths,
        host: "127.0.0.1",
        staticDir: undefined,
        devUrl: new URL("http://127.0.0.1:4173"),
        noBrowser: true,
        startupPresentation: "browser",
        desktopBootstrapToken: undefined,
        autoBootstrapProjectFromCwd: true,
        logWebSocketEvents: true,
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
      });
    }),
  );

  it.effect("falls back to persisted observability settings when env vars are absent", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "ryco-cli-config-settings-" });
      const derivedPaths = yield* deriveServerPaths(baseDir, undefined);
      yield* fs.makeDirectory(path.dirname(derivedPaths.settingsPath), { recursive: true });
      yield* fs.writeFileString(
        derivedPaths.settingsPath,
        `${JSON.stringify({
          observability: {
            otlpTracesUrl: "http://localhost:4318/v1/traces",
            otlpMetricsUrl: "http://localhost:4318/v1/metrics",
          },
        })}\n`,
      );

      const resolved = yield* resolveServerConfig(
        {
          mode: Option.some("desktop"),
          port: Option.some(4888),
          host: Option.none(),
          baseDir: Option.some(baseDir),
          cwd: Option.none(),
          devUrl: Option.none(),
          noBrowser: Option.none(),
          bootstrapFd: Option.none(),
          autoBootstrapProjectFromCwd: Option.none(),
          logWebSocketEvents: Option.none(),
          tailscaleServeEnabled: Option.none(),
          tailscaleServePort: Option.none(),
        },
        Option.none(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
            NetService.layer,
          ),
        ),
      );

      expect(resolved.otlpTracesUrl).toBe("http://localhost:4318/v1/traces");
      expect(resolved.otlpMetricsUrl).toBe("http://localhost:4318/v1/metrics");
      expect(resolved).toEqual({
        logLevel: "Info",
        ...defaultObservabilityConfig,
        ...defaultConnectorConfig,
        otlpTracesUrl: "http://localhost:4318/v1/traces",
        otlpMetricsUrl: "http://localhost:4318/v1/metrics",
        mode: "desktop",
        port: 4888,
        cwd: process.cwd(),
        baseDir,
        ...derivedPaths,
        host: "127.0.0.1",
        staticDir: resolved.staticDir,
        devUrl: undefined,
        noBrowser: true,
        startupPresentation: "browser",
        desktopBootstrapToken: undefined,
        autoBootstrapProjectFromCwd: false,
        logWebSocketEvents: false,
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
      });
    }),
  );

  it.effect("forces noBrowser and disables auto-bootstrap for headless startup presentation", () =>
    Effect.gen(function* () {
      const { join } = yield* Path.Path;
      const baseDir = join(os.tmpdir(), "ryco-cli-config-headless-base");
      const derivedPaths = yield* deriveServerPaths(baseDir, undefined);

      const resolved = yield* resolveServerConfig(
        {
          mode: Option.some("web"),
          port: Option.some(3773),
          host: Option.none(),
          baseDir: Option.some(baseDir),
          cwd: Option.none(),
          devUrl: Option.none(),
          noBrowser: Option.none(),
          bootstrapFd: Option.none(),
          autoBootstrapProjectFromCwd: Option.none(),
          logWebSocketEvents: Option.none(),
          tailscaleServeEnabled: Option.none(),
          tailscaleServePort: Option.none(),
        },
        Option.none(),
        {
          startupPresentation: "headless",
        },
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            ConfigProvider.layer(
              ConfigProvider.fromEnv({
                env: {
                  RYCO_NO_BROWSER: "false",
                  RYCO_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "true",
                },
              }),
            ),
            NetService.layer,
          ),
        ),
      );

      expect(resolved).toEqual({
        logLevel: "Info",
        ...defaultObservabilityConfig,
        ...defaultConnectorConfig,
        mode: "web",
        port: 3773,
        cwd: process.cwd(),
        baseDir,
        ...derivedPaths,
        host: undefined,
        staticDir: resolved.staticDir,
        devUrl: undefined,
        noBrowser: true,
        startupPresentation: "headless",
        desktopBootstrapToken: undefined,
        autoBootstrapProjectFromCwd: false,
        logWebSocketEvents: false,
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
      });
    }),
  );
});
