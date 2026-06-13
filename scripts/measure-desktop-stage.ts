import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface StagePackageJson {
  readonly version?: string;
  readonly rycoCommitHash?: string;
}

interface SizeRow {
  readonly label: string;
  readonly path: string;
  readonly kib: number;
}

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseArgs(argv: readonly string[]): {
  stageDir: string | undefined;
  allowStale: boolean;
  top: number;
} {
  let stageDir: string | undefined;
  let allowStale = false;
  let top = 60;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--stage") {
      const value = argv[index + 1];
      if (!value) throw new Error("--stage requires a path.");
      stageDir = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === "--allow-stale") {
      allowStale = true;
      continue;
    }
    if (arg === "--top") {
      const value = argv[index + 1];
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error("--top requires a positive number.");
      }
      top = Math.floor(parsed);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument '${arg}'.`);
  }
  return { stageDir, allowStale, top };
}

function findLatestStageDir(): string | undefined {
  const tmpDir = os.tmpdir();
  const entries = fs
    .readdirSync(tmpDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^ryco-desktop-.+-stage-/u.test(entry.name))
    .map((entry) => {
      const fullPath = path.join(tmpDir, entry.name);
      return {
        fullPath,
        mtimeMs: fs.statSync(fullPath).mtimeMs,
      };
    })
    .toSorted((left, right) => right.mtimeMs - left.mtimeMs);
  return entries[0]?.fullPath;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function currentCommitShort(): string {
  return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

function diskKib(targetPath: string): number {
  if (!fs.existsSync(targetPath)) {
    return 0;
  }
  try {
    const output = execFileSync("du", ["-sk", targetPath], {
      encoding: "utf8",
    }).trim();
    const [kib] = output.split(/\s+/u);
    const parsed = Number(kib);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  } catch {
    // Fall back to apparent file bytes below for platforms without `du`.
  }
  return Math.ceil(apparentBytes(targetPath) / 1024);
}

function apparentBytes(targetPath: string): number {
  const stat = fs.lstatSync(targetPath);
  if (stat.isSymbolicLink()) return 0;
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  return fs.readdirSync(targetPath).reduce((total, entry) => {
    return total + apparentBytes(path.join(targetPath, entry));
  }, 0);
}

function formatKib(kib: number): string {
  if (kib >= 1024 * 1024) return `${(kib / 1024 / 1024).toFixed(2)} GiB`;
  if (kib >= 1024) return `${(kib / 1024).toFixed(1)} MiB`;
  return `${kib} KiB`;
}

function existingSizeRows(entries: readonly [string, string][]): SizeRow[] {
  return entries.flatMap(([label, entryPath]) => {
    if (!fs.existsSync(entryPath)) {
      return [];
    }
    return [{ label, path: entryPath, kib: diskKib(entryPath) }];
  });
}

function nodeModulePackageDirs(nodeModulesDir: string): string[] {
  if (!fs.existsSync(nodeModulesDir)) {
    return [];
  }
  return fs
    .readdirSync(nodeModulesDir, { withFileTypes: true })
    .flatMap((entry) => {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        return [];
      }
      const entryPath = path.join(nodeModulesDir, entry.name);
      if (!entry.name.startsWith("@")) {
        return [entryPath];
      }
      return fs
        .readdirSync(entryPath, { withFileTypes: true })
        .filter((child) => child.isDirectory())
        .map((child) => path.join(entryPath, child.name));
    })
    .toSorted();
}

function printRows(title: string, rows: readonly SizeRow[]): void {
  console.log(`## ${title}`);
  console.log("");
  console.log("| Size | Path |");
  console.log("| ---: | --- |");
  for (const row of rows) {
    console.log(
      `| ${formatKib(row.kib)} | \`${path.relative(repoRoot, row.path) || row.label}\` |`,
    );
  }
  console.log("");
}

function main(): void {
  const { stageDir: requestedStageDir, allowStale, top } = parseArgs(process.argv.slice(2));
  const stageRoot = requestedStageDir ?? findLatestStageDir();
  if (!stageRoot) {
    throw new Error(
      [
        "No kept desktop stage found.",
        "Run a current build first, for example:",
        'RYCO_DESKTOP_KEEP_STAGE=true RYCO_DESKTOP_OUTPUT_DIR="$PWD/release-size-audit/$(git rev-parse --short=12 HEAD)-mac-arm64" RYCO_WEB_SOURCEMAP=0 bun run dist:desktop:dmg:arm64',
      ].join("\n"),
    );
  }
  const stageAppDir = path.basename(stageRoot) === "app" ? stageRoot : path.join(stageRoot, "app");
  const packageJsonPath = path.join(stageAppDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Missing staged package.json at ${packageJsonPath}.`);
  }

  const stagePackage = readJson<StagePackageJson>(packageJsonPath);
  const currentCommit = currentCommitShort();
  const stageCommit = stagePackage.rycoCommitHash ?? "";
  const isCurrent = stageCommit.startsWith(currentCommit);
  if (!isCurrent && !allowStale) {
    throw new Error(
      [
        "Refusing to treat a stale kept stage as current measurement output.",
        `Current HEAD: ${currentCommit}`,
        `Stage commit: ${stageCommit || "(missing)"}`,
        `Stage path: ${stageAppDir}`,
        "Pass --allow-stale only when intentionally inspecting historical context.",
      ].join("\n"),
    );
  }

  const nodeModulesDir = path.join(stageAppDir, "node_modules");
  const sectionRows = existingSizeRows([
    ["stage app", stageAppDir],
    ["node_modules", nodeModulesDir],
    ["server dist", path.join(stageAppDir, "apps/server/dist")],
    ["web client", path.join(stageAppDir, "apps/server/dist/client")],
    ["desktop dist", path.join(stageAppDir, "apps/desktop/dist-electron")],
    ["desktop resources", path.join(stageAppDir, "apps/desktop/resources")],
    ["desktop prod resources", path.join(stageAppDir, "apps/desktop/prod-resources")],
    ["final artifacts", path.join(stageAppDir, "dist")],
  ]);
  const packageRows = nodeModulePackageDirs(nodeModulesDir)
    .map((entryPath) => ({
      label: path.relative(nodeModulesDir, entryPath),
      path: entryPath,
      kib: diskKib(entryPath),
    }))
    .toSorted((left, right) => right.kib - left.kib);
  const targetRows = existingSizeRows([
    ["@anthropic-ai", path.join(nodeModulesDir, "@anthropic-ai")],
    ["node-pty", path.join(nodeModulesDir, "node-pty")],
    ["@img", path.join(nodeModulesDir, "@img")],
    ["sharp", path.join(nodeModulesDir, "sharp")],
    ["@github", path.join(nodeModulesDir, "@github")],
    ["@opencode-ai", path.join(nodeModulesDir, "@opencode-ai")],
    ["effect", path.join(nodeModulesDir, "effect")],
    ["@effect", path.join(nodeModulesDir, "@effect")],
    ["electron-updater", path.join(nodeModulesDir, "electron-updater")],
    ["geist", path.join(nodeModulesDir, "geist")],
    ["next", path.join(nodeModulesDir, "next")],
  ]).toSorted((left, right) => right.kib - left.kib);

  console.log("# Desktop Kept-Stage Size Measurement");
  console.log("");
  console.log(`Stage: \`${stageAppDir}\``);
  console.log(`Version: \`${stagePackage.version ?? "(missing)"}\``);
  console.log(`Stage commit: \`${stageCommit || "(missing)"}\``);
  console.log(`Current HEAD: \`${currentCommit}\``);
  console.log(`Current output: \`${isCurrent ? "yes" : "no"}\``);
  console.log("");
  printRows("Stage Sections", sectionRows);
  printRows("Tracked Package Targets", targetRows);
  printRows(
    `Largest ${Math.min(top, packageRows.length)} node_modules Packages`,
    packageRows.slice(0, top),
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
