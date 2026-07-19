import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(scriptsDir, "..");
const tsc6 = path.join(root, "node_modules/.bin/tsc6");

/** Packages with @effect/language-service plugin config in tsconfig. */
const projects = [
  "apps/server",
  "apps/web",
  "packages/contracts",
  "packages/effect-acp",
  "packages/effect-codex-app-server",
  "packages/ssh",
  "packages/tailscale",
  "scripts",
] as const;

/**
 * Optional `--shard <index>/<total>` (1-based) splits `projects` across CI
 * runners. Sharding is derived from this authoritative list via round-robin, so
 * adding a project here automatically distributes it — a shard can never
 * silently skip a package. With no flag, every project runs (local + main).
 */
const parseShard = (): { index: number; total: number } | null => {
  const flag = process.argv.indexOf("--shard");
  if (flag === -1) return null;
  const raw = process.argv[flag + 1];
  const match = raw?.match(/^(\d+)\/(\d+)$/);
  if (!match) {
    console.error(`[typecheck:effect] Invalid --shard value: ${raw ?? "(missing)"} (expected i/n)`);
    process.exit(1);
  }
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (index < 1 || total < 1 || index > total) {
    console.error(`[typecheck:effect] Out-of-range --shard value: ${raw}`);
    process.exit(1);
  }
  return { index, total };
};

const shard = parseShard();
const selectedProjects = shard
  ? projects.filter((_, i) => i % shard.total === shard.index - 1)
  : projects;

const run = (project: string) =>
  new Promise<{ project: string; status: number | null }>((resolve) => {
    const cwd = path.join(root, project);
    console.log(`[typecheck:effect] ${project}`);
    const child = spawn(tsc6, ["--noEmit", "-p", "tsconfig.json"], {
      cwd,
      stdio: "inherit",
    });
    let settled = false;
    const finish = (status: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ project, status });
    };
    child.on("error", (error) => {
      console.error(`[typecheck:effect] Failed to start tsc6 for ${project}:`, error.message);
      finish(1);
    });
    child.on("close", (status) => finish(status));
  });

const shardLabel = shard ? ` (shard ${shard.index}/${shard.total})` : "";

if (selectedProjects.length === 0) {
  console.log(`[typecheck:effect] No projects in this shard${shardLabel}`);
  process.exit(0);
}

const results = await Promise.all(selectedProjects.map(run));
const failed = results.filter((r) => r.status !== 0);

if (failed.length > 0) {
  console.error(`[typecheck:effect] Failed: ${failed.map((r) => r.project).join(", ")}`);
  process.exit(1);
}

console.log(`[typecheck:effect] ${selectedProjects.length} projects passed${shardLabel}`);
