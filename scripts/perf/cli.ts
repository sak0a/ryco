#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compareBenchmarks } from "./comparison.ts";
import { compareGitRefs } from "./gitComparison.ts";
import {
  DEFAULT_COMPARISON_POLICY,
  type ComparisonPolicy,
  type PerfScenarioConfig,
} from "./model.ts";
import { writeBenchmarkArtifacts } from "./report.ts";
import { defaultScenarioConfig, runCheckoutBenchmark } from "./runner.ts";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const KNOWN_OPTIONS = new Set([
  "base",
  "candidate",
  "url",
  "iterations",
  "idle-ms",
  "hidden-idle-ms",
  "offline-ms",
  "reconnect-timeout-ms",
  "fixture-home",
  "target-path",
  "ready-selector",
  "output",
  "policy",
  "help",
]);

interface ParsedArgs {
  readonly command: "smoke" | "run" | "compare-refs";
  readonly values: ReadonlyMap<string, string>;
  readonly flags: ReadonlySet<string>;
}

function usage(): string {
  return `Ryco external performance harness

Usage:
  bun scripts/perf/cli.ts smoke [options]
  bun scripts/perf/cli.ts run [options]
  bun scripts/perf/cli.ts compare-refs [options]

Options:
  --base <ref>                 Baseline ref. Default: origin/main
  --candidate <ref>            Candidate ref. Default: HEAD
  --url <url>                  Measure an already-running application.
  --iterations <count>         Measured iterations. Default: 5 (smoke: 1)
  --idle-ms <ms>               Foreground idle window.
  --hidden-idle-ms <ms>        Background idle window.
  --offline-ms <ms>            Offline duration before recovery.
  --reconnect-timeout-ms <ms>  Recovery deadline.
  --fixture-home <path>        Stopped, sanitized Ryco home copied per iteration.
  --target-path <path>         Route opened after pairing.
  --ready-selector <selector>  Visible readiness selector. Default: #root
  --output <directory>         Result directory. Default: .perf-results/<timestamp>
  --policy <json-file>         Comparison policy override.
  --help                       Show this help.
`;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const first = argv[0] ?? "run";
  if (first === "--help" || first === "-h") {
    return { command: "run", values: new Map(), flags: new Set(["help"]) };
  }
  if (first !== "smoke" && first !== "run" && first !== "compare-refs") {
    throw new Error(`Unknown command '${first}'.\n\n${usage()}`);
  }
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith("--")) throw new Error(`Unexpected argument '${argument}'.`);
    const key = argument.slice(2);
    if (!KNOWN_OPTIONS.has(key)) throw new Error(`Unknown option '--${key}'.`);
    if (key === "help") {
      flags.add(key);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`--${key} requires a value.`);
    values.set(key, value);
    index += 1;
  }
  return { command: first, values, flags };
}

function positiveInteger(
  values: ReadonlyMap<string, string>,
  key: string,
  fallback: number,
): number {
  const raw = values.get(key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`--${key} must be a positive integer.`);
  }
  return parsed;
}

function scenarioFromArgs(parsed: ParsedArgs): PerfScenarioConfig {
  const defaults = defaultScenarioConfig(parsed.command === "smoke");
  const fixtureHome = parsed.values.get("fixture-home");
  return {
    iterations: positiveInteger(parsed.values, "iterations", defaults.iterations),
    idleMs: positiveInteger(parsed.values, "idle-ms", defaults.idleMs),
    hiddenIdleMs: positiveInteger(parsed.values, "hidden-idle-ms", defaults.hiddenIdleMs),
    offlineMs: positiveInteger(parsed.values, "offline-ms", defaults.offlineMs),
    reconnectTimeoutMs: positiveInteger(
      parsed.values,
      "reconnect-timeout-ms",
      defaults.reconnectTimeoutMs,
    ),
    readySelector: parsed.values.get("ready-selector") ?? defaults.readySelector,
    targetPath: parsed.values.get("target-path") ?? defaults.targetPath,
    fixtureHome: fixtureHome ? path.resolve(fixtureHome) : defaults.fixtureHome,
  };
}

function outputDirectory(values: ReadonlyMap<string, string>): string {
  const configured = values.get("output");
  if (configured) return path.resolve(configured);
  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  return path.join(repoRoot, ".perf-results", timestamp);
}

function currentRevision(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
}

function readPolicy(policyPath: string | undefined): ComparisonPolicy {
  if (!policyPath) return DEFAULT_COMPARISON_POLICY;
  const parsed = JSON.parse(
    readFileSync(path.resolve(policyPath), "utf8"),
  ) as Partial<ComparisonPolicy>;
  return {
    ...DEFAULT_COMPARISON_POLICY,
    ...parsed,
    metrics: { ...DEFAULT_COMPARISON_POLICY.metrics, ...parsed.metrics },
  };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.flags.has("help")) {
    console.log(usage());
    return;
  }
  const scenario = scenarioFromArgs(parsed);
  const outputDir = outputDirectory(parsed.values);

  if (parsed.command === "compare-refs") {
    const { baseline, candidate } = await compareGitRefs({
      repoRoot,
      baselineRef: parsed.values.get("base") ?? "origin/main",
      candidateRef: parsed.values.get("candidate") ?? "HEAD",
      scenario,
    });
    const comparison = compareBenchmarks(
      baseline,
      candidate,
      readPolicy(parsed.values.get("policy")),
    );
    writeBenchmarkArtifacts({ outputDir, baseline, candidate, comparison });
    console.log(`Performance comparison: ${comparison.passed ? "PASS" : "FAIL"}`);
    console.log(`Report: ${path.join(outputDir, "comparison.md")}`);
    if (!comparison.passed) process.exitCode = 1;
    return;
  }

  const externalUrl = parsed.values.get("url");
  const result = await runCheckoutBenchmark({
    repoRoot,
    label: parsed.command === "smoke" ? "local-smoke" : "local",
    revision: currentRevision(),
    scenario,
    ...(externalUrl ? { externalUrl } : {}),
  });
  writeBenchmarkArtifacts({ outputDir, candidate: result });
  console.log(`Samples: ${result.samples.length}/${scenario.iterations}`);
  console.log(`Result: ${path.join(outputDir, "result.json")}`);
  if (result.errors.length > 0 || result.samples.some((sample) => sample.errors.length > 0)) {
    process.exitCode = 1;
  }
}

const isEntrypoint =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
