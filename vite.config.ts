import * as path from "node:path";
import { defineConfig, mergeConfig } from "vite-plus";

const rootConfig = {
  resolve: {
    alias: {
      "~": path.resolve(import.meta.dirname, "./apps/web/src"),
      "@t3tools/contracts": path.resolve(import.meta.dirname, "./packages/contracts/src/index.ts"),
    },
  },
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: [
      ".reference",
      ".plans",
      "dist",
      "dist-electron",
      "node_modules",
      "bun.lock",
      "*.tsbuildinfo",
      "**/routeTree.gen.ts",
      "apps/web/public/mockServiceWorker.js",
      "apps/web/src/lib/vendor/qrcodegen.ts",
      "*.icon/**",
    ],
    sortPackageJson: {},
    overrides: [
      {
        files: [".devcontainer/devcontainer.json"],
        options: {
          trailingComma: "none",
        },
      },
    ],
  },
  lint: {
    ignorePatterns: [
      "dist",
      "dist-electron",
      "node_modules",
      "bun.lock",
      "*.tsbuildinfo",
      "**/routeTree.gen.ts",
    ],
    plugins: ["eslint", "oxc", "react", "unicorn", "typescript"],
    categories: {
      correctness: "warn",
      suspicious: "warn",
      perf: "warn",
    },
    rules: {
      "react-in-jsx-scope": "off",
      "eslint/no-shadow": "off",
      "eslint/no-await-in-loop": "off",
      "eslint/no-underscore-dangle": "off",
      "react/no-object-type-as-default-prop": "off",
      "react/no-unstable-nested-components": "off",
      "unicorn/consistent-function-scoping": "off",
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
  },
};

export default defineConfig(async () => {
  const isVpBuild = process.argv.some((arg) => arg === "build");
  if (!isVpBuild) {
    return rootConfig;
  }

  const { default: webConfig } = await import("./apps/web/vite.config");
  return mergeConfig(webConfig, {
    ...rootConfig,
    root: path.resolve(import.meta.dirname, "./apps/web"),
  });
});
