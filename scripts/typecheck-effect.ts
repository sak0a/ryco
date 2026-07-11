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

const run = (project: string) =>
  new Promise<{ project: string; status: number | null }>((resolve) => {
    const cwd = path.join(root, project);
    console.log(`[typecheck:effect] ${project}`);
    const child = spawn(tsc6, ["--noEmit", "-p", "tsconfig.json"], {
      cwd,
      stdio: "inherit",
    });
    child.on("close", (status) => resolve({ project, status }));
  });

const results = await Promise.all(projects.map(run));
const failed = results.filter((r) => r.status !== 0);

if (failed.length > 0) {
  console.error(`[typecheck:effect] Failed: ${failed.map((r) => r.project).join(", ")}`);
  process.exit(1);
}

console.log(`[typecheck:effect] ${projects.length} projects passed`);
