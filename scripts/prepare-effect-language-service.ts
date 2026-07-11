import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { version } = require("typescript/package.json") as { version: string };
const major = Number.parseInt(version.split(".")[0] ?? "0", 10);

if (major >= 7) {
  console.log(
    `[prepare] Skipping effect-language-service patch — TypeScript ${version} uses a native compiler without patchable JS sources.`,
  );
  process.exit(0);
}

const result = spawnSync("effect-language-service", ["patch"], {
  stdio: "inherit",
  shell: true,
});

process.exit(result.status ?? 1);
