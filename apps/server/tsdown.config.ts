import { parseOptInSourcemapEnv, readEnv } from "@ryco/shared/runtimeEnv";
import { defineConfig } from "tsdown";

const buildSourcemap = parseOptInSourcemapEnv(readEnv("RYCO_SERVER_SOURCEMAP"));

export default defineConfig({
  entry: ["src/bin.ts"],
  tsconfig: "tsconfig.build.json",
  format: ["esm", "cjs"],
  checks: {
    legacyCjs: false,
  },
  outDir: "dist",
  sourcemap: buildSourcemap,
  clean: true,
  deps: {
    alwaysBundle: (id) => id.startsWith("@ryco/") || id.startsWith("effect-acp"),
    onlyBundle: false,
  },
  banner: {
    js: "#!/usr/bin/env node\n",
  },
});
