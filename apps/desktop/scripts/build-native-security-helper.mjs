import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") process.exit(0);

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, "..");
const source = join(desktopDir, "native/macos/RycoDesktopSecurityHelper.swift");
const output = join(desktopDir, "resources/ryco-desktop-security-helper");
const temporaryDir = mkdtempSync(join(tmpdir(), "ryco-desktop-security-helper-"));

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: desktopDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0) return;
  const details = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  throw new Error(
    `Desktop native security helper build failed.${details.length > 0 ? `\n${details}` : ""}`,
  );
}

try {
  const binaries = [];
  for (const architecture of ["x86_64", "arm64"]) {
    const binary = join(temporaryDir, `ryco-desktop-security-helper-${architecture}`);
    run("xcrun", [
      "--sdk",
      "macosx",
      "swiftc",
      "-O",
      "-target",
      `${architecture}-apple-macosx11.0`,
      "-framework",
      "Security",
      "-framework",
      "CryptoKit",
      source,
      "-o",
      binary,
    ]);
    binaries.push(binary);
  }

  const universal = join(temporaryDir, "ryco-desktop-security-helper");
  run("xcrun", ["lipo", "-create", ...binaries, "-output", universal]);
  chmodSync(universal, 0o755);
  mkdirSync(dirname(output), { recursive: true });
  renameSync(universal, output);
} finally {
  rmSync(temporaryDir, { recursive: true, force: true });
}
