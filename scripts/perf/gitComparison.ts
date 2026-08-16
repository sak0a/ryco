import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { runMeasuredCommand } from "./command.ts";
import type { BenchmarkResult, PerfScenarioConfig } from "./model.ts";
import { runCheckoutBenchmark } from "./runner.ts";

export const REF_BUILD_ARGS = [
  "run",
  "build",
  "--force",
  "--filter=ryco-cli",
  "--filter=@ryco/web",
] as const;

function git(repoRoot: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

export function assertReproducibleCandidate(repoRoot: string, candidateRef: string): void {
  if (candidateRef !== "HEAD") return;
  const status = git(repoRoot, ["status", "--porcelain=v1"]);
  if (status.length > 0) {
    throw new Error(
      "Ref comparison requires a clean worktree when candidate is HEAD. Commit or stash changes first.",
    );
  }
}

async function measureRef(input: {
  readonly sourceRepoRoot: string;
  readonly temporaryRoot: string;
  readonly ref: string;
  readonly label: string;
  readonly scenario: PerfScenarioConfig;
}): Promise<BenchmarkResult> {
  const safeLabel = input.label.replace(/[^a-zA-Z0-9_-]+/gu, "-");
  const worktree = path.join(input.temporaryRoot, safeLabel);
  git(input.sourceRepoRoot, ["worktree", "add", "--detach", worktree, input.ref]);
  try {
    const revision = git(worktree, ["rev-parse", "HEAD"]);
    const bunBinary = process.env.RYCO_PERF_BUN_BINARY || process.execPath;
    const install = await runMeasuredCommand({
      command: bunBinary,
      args: ["install", "--frozen-lockfile"],
      cwd: worktree,
      timeoutMs: 10 * 60_000,
    });
    if (install.measurement.exitCode !== 0) {
      throw new Error(`Dependency installation failed for ${input.ref}.\n${install.outputTail}`);
    }
    const build = await runMeasuredCommand({
      command: bunBinary,
      // Detached worktrees can still see Turbo's shared worktree cache. Force
      // execution so one revision cannot receive a warm-cache advantage.
      args: REF_BUILD_ARGS,
      cwd: worktree,
      env: { RYCO_WEB_SOURCEMAP: "0" },
      timeoutMs: 15 * 60_000,
    });
    if (build.measurement.exitCode !== 0) {
      throw new Error(`Production build failed for ${input.ref}.\n${build.outputTail}`);
    }
    return await runCheckoutBenchmark({
      repoRoot: worktree,
      label: input.label,
      revision,
      scenario: input.scenario,
      build: build.measurement,
    });
  } finally {
    try {
      git(input.sourceRepoRoot, ["worktree", "remove", "--force", worktree]);
    } finally {
      if (existsSync(worktree)) rmSync(worktree, { recursive: true, force: true });
    }
  }
}

export async function compareGitRefs(input: {
  readonly repoRoot: string;
  readonly baselineRef: string;
  readonly candidateRef: string;
  readonly scenario: PerfScenarioConfig;
}): Promise<{ readonly baseline: BenchmarkResult; readonly candidate: BenchmarkResult }> {
  assertReproducibleCandidate(input.repoRoot, input.candidateRef);
  git(input.repoRoot, ["rev-parse", "--verify", `${input.baselineRef}^{commit}`]);
  git(input.repoRoot, ["rev-parse", "--verify", `${input.candidateRef}^{commit}`]);
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "ryco-perf-refs-"));
  try {
    const baseline = await measureRef({
      sourceRepoRoot: input.repoRoot,
      temporaryRoot,
      ref: input.baselineRef,
      label: `baseline:${input.baselineRef}`,
      scenario: input.scenario,
    });
    const candidate = await measureRef({
      sourceRepoRoot: input.repoRoot,
      temporaryRoot,
      ref: input.candidateRef,
      label: `candidate:${input.candidateRef}`,
      scenario: input.scenario,
    });
    return { baseline, candidate };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
    git(input.repoRoot, ["worktree", "prune"]);
  }
}
