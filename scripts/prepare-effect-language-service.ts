import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { version } = require("typescript/package.json") as { version: string };
const major = Number.parseInt(version.split(".")[0] ?? "0", 10);

function resolvePatchTarget(): { dir: string; label: string } {
  if (major >= 7) {
    const ts6Root = path.dirname(require.resolve("@typescript/typescript6/package.json"));
    const oldRoot = path.dirname(
      require.resolve("@typescript/old/package.json", { paths: [ts6Root] }),
    );
    return {
      dir: oldRoot,
      label: `@typescript/old (JS compiler for tsc6; primary compiler is TypeScript ${version})`,
    };
  }

  return {
    dir: path.dirname(require.resolve("typescript/package.json")),
    label: "typescript",
  };
}

const { dir, label } = resolvePatchTarget();

console.log(`[prepare] Patching ${label} for effect-language-service…`);

const result = spawnSync("effect-language-service", ["patch", "--dir", dir], {
  stdio: "inherit",
  shell: true,
});

if (result.error) {
  console.error("[prepare] Failed to run effect-language-service:", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
