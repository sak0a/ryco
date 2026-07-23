import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { parseOptInSourcemapEnv, readEnv } from "@ryco/shared/runtimeEnv";
import { fileURLToPath } from "node:url";
import { defineConfig, type UserConfig } from "vite-plus";
import pkg from "./package.json" with { type: "json" };
import { createHostedPwaBuildPlugin } from "./src/pwa/buildArtifacts";

const webRoot = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT ?? 5733);
const host = process.env.HOST?.trim() || "localhost";
const configuredHttpUrl = process.env.VITE_HTTP_URL?.trim();
const configuredWsUrl = process.env.VITE_WS_URL?.trim();
const clientMode = process.env.VITE_RYCO_CLIENT_MODE === "hosted-hub" ? "hosted-hub" : "standard";
const phoneAppInterstitial =
  process.env.VITE_RYCO_PHONE_APP_INTERSTITIAL === "enabled" ? "enabled" : "disabled";
const mobileAppUrl = process.env.VITE_RYCO_MOBILE_APP_URL ?? "";
const configuredHostedAppUrl = (() => {
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return process.env.VITE_HOSTED_APP_URL?.trim();
})();
const buildSourcemap = parseOptInSourcemapEnv(readEnv("RYCO_WEB_SOURCEMAP"), {
  allowHidden: true,
});

export function shouldEnableHostedPwaBuild(input: {
  readonly clientMode: "hosted-hub" | "standard";
  readonly command: string;
}): boolean {
  return input.clientMode === "hosted-hub" && input.command === "build";
}

function resolveDevProxyTarget(wsUrl: string | undefined): string | undefined {
  if (!wsUrl) {
    return undefined;
  }

  try {
    const url = new URL(wsUrl);
    if (url.protocol === "ws:") {
      url.protocol = "http:";
    } else if (url.protocol === "wss:") {
      url.protocol = "https:";
    }
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

const devProxyTarget = resolveDevProxyTarget(configuredWsUrl);

export function createWebViteConfig(
  resolvedClientMode: "hosted-hub" | "standard" = clientMode,
  resolvedPhoneAppInterstitial: string = phoneAppInterstitial,
  resolvedMobileAppUrl: string = mobileAppUrl,
): UserConfig {
  const normalizedPhoneAppInterstitial =
    resolvedPhoneAppInterstitial === "enabled" ? "enabled" : "disabled";

  return {
    plugins: [
      tanstackRouter(),
      react(),
      babel({
        // Root-level `vp build` executes from the repository root; keep Babel plugin
        // resolution anchored to the package that declares the React Compiler plugin.
        cwd: webRoot,
        // We need to be explicit about the parser options after moving to @vitejs/plugin-react v6.0.0
        // This is because the babel plugin only automatically parses typescript and jsx based on relative paths (e.g. "**/*.ts")
        // whereas the previous version of the plugin parsed all files with a .ts extension.
        // This is causing our packages/ directory to fail to parse, as they are not relative to the CWD.
        parserOpts: { plugins: ["typescript", "jsx"] },
        presets: [reactCompilerPreset()],
      }),
      tailwindcss(),
      ...(resolvedClientMode === "hosted-hub" ? [createHostedPwaBuildPlugin()] : []),
    ],
    optimizeDeps: {
      include: [
        "@pierre/diffs",
        "@pierre/diffs/react",
        "@pierre/diffs/worker/worker.js",
        "effect/Array",
        "effect/Order",
        "react-dom/client",
      ],
    },
    define: {
      "import.meta.env.VITE_HTTP_URL": JSON.stringify(configuredHttpUrl ?? ""),
      // In dev mode, tell the web app where the WebSocket server lives
      "import.meta.env.VITE_WS_URL": JSON.stringify(configuredWsUrl ?? ""),
      "import.meta.env.VITE_HOSTED_APP_URL": JSON.stringify(configuredHostedAppUrl ?? ""),
      "import.meta.env.VITE_RYCO_CLIENT_MODE": JSON.stringify(clientMode),
      "import.meta.env.VITE_RYCO_PHONE_APP_INTERSTITIAL": JSON.stringify(
        normalizedPhoneAppInterstitial,
      ),
      "import.meta.env.VITE_RYCO_MOBILE_APP_URL": JSON.stringify(resolvedMobileAppUrl),
      "import.meta.env.APP_VERSION": JSON.stringify(pkg.version),
    },
    resolve: {
      tsconfigPaths: true,
    },
    server: {
      host,
      port,
      strictPort: true,
      ...(devProxyTarget
        ? {
            proxy: {
              "/.well-known": {
                target: devProxyTarget,
                changeOrigin: clientMode !== "hosted-hub",
              },
              "/api": {
                target: devProxyTarget,
                changeOrigin: clientMode !== "hosted-hub",
              },
              "/attachments": {
                target: devProxyTarget,
                changeOrigin: true,
              },
              ...(clientMode === "hosted-hub"
                ? {
                    "/v1/relay": {
                      target: devProxyTarget,
                      changeOrigin: false,
                      ws: true,
                    },
                  }
                : {}),
            },
          }
        : {}),
      hmr: {
        // Explicit config so Vite's HMR WebSocket connects reliably
        // inside Electron's BrowserWindow. Vite 8 uses console.debug for
        // connection logs — enable "Verbose" in DevTools to see them.
        protocol: "ws",
        host,
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      modulePreload: false,
      sourcemap: buildSourcemap,
    },
  };
}

export default defineConfig(createWebViteConfig());
