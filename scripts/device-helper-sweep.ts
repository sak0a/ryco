// Compile and probe the helper against each locally installed Xcode.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { deviceHelperCacheKey } from "@ryco/shared/deviceHelperCache";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const smokeScript = join(repoRoot, "scripts/device-helper-smoke.ts");

interface Toolchain {
  readonly developerDir: string;
  readonly label: string;
}

interface SweepResult extends Toolchain {
  readonly ok: boolean;
  readonly detail: string;
  readonly durationMs: number;
}

function toolchainLabel(developerDir: string): string {
  try {
    const version = execFileSync("xcodebuild", ["-version"], {
      encoding: "utf8",
      env: { ...process.env, DEVELOPER_DIR: developerDir },
      stdio: ["ignore", "pipe", "ignore"],
    });
    return deviceHelperCacheKey(version) ?? developerDir;
  } catch {
    return developerDir;
  }
}

function discoverToolchains(): Toolchain[] {
  const directories = new Set<string>();
  for (const entry of readdirSync("/Applications")) {
    if (!entry.startsWith("Xcode") || !entry.endsWith(".app")) continue;
    const developerDir = join("/Applications", entry, "Contents/Developer");
    if (existsSync(developerDir)) directories.add(developerDir);
  }
  try {
    const output = execFileSync("xcodes", ["installed"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    for (const line of output.split("\n")) {
      const match = /(\/.*\.app)\s*$/u.exec(line.trim());
      if (!match) continue;
      const developerDir = join(match[1]!, "Contents/Developer");
      if (existsSync(developerDir)) directories.add(developerDir);
    }
  } catch {
    // The optional xcodes CLI is only an additional discovery source.
  }
  return [...directories].toSorted().map((developerDir) => ({
    developerDir,
    label: toolchainLabel(developerDir),
  }));
}

function runSmoke(toolchain: Toolchain, full: boolean): SweepResult {
  const started = Date.now();
  const result = spawnSync("bun", [smokeScript, ...(full ? [] : ["--probe-only"])], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, DEVELOPER_DIR: toolchain.developerDir },
    stdio: ["ignore", "inherit", "inherit"],
    timeout: full ? 30 * 60_000 : 10 * 60_000,
  });
  return {
    ...toolchain,
    ok: result.status === 0 && !result.error,
    detail: result.error?.message ?? (result.status === 0 ? "pass" : `exit ${result.status}`),
    durationMs: Date.now() - started,
  };
}

function main(): void {
  if (process.platform !== "darwin") {
    console.error("[device-sweep] the device helper is macOS only");
    process.exit(1);
  }
  const full = process.argv.includes("--full");
  const toolchains = discoverToolchains();
  if (toolchains.length === 0) {
    console.error("[device-sweep] no Xcode installs found under /Applications");
    process.exit(1);
  }
  console.log(`[device-sweep] ${toolchains.length} toolchain(s), mode=${full ? "full" : "probe"}`);
  const results = toolchains.map((toolchain) => {
    console.log(`[device-sweep] ${toolchain.label} (${toolchain.developerDir})`);
    return runSmoke(toolchain, full);
  });
  for (const result of results) {
    console.log(
      `[device-sweep] ${result.ok ? "PASS" : "FAIL"} ${result.label} ${result.detail} ` +
        `${(result.durationMs / 1_000).toFixed(1)}s`,
    );
  }
  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) process.exit(1);
}

main();
