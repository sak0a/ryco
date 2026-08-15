# External Performance Harness Design

Date: 2026-08-15

## Goal

Add a repeatable black-box performance system that can measure a built Ryco application, compare
two Git revisions on the same machine, and fail on meaningful regressions. The primary evidence
must come from the browser, network, launched process tree, and build process rather than from
implementation-specific timers.

## Decisions

- Keep the harness in `scripts/perf` as repository tooling, not application runtime code.
- Use the real production `ryco serve` entrypoint and its one-time pairing URL.
- Use the pinned Playwright Chromium runtime already used by the web package.
- Run baseline and candidate sequentially in detached temporary Git worktrees.
- Clone an optional stopped, sanitized Ryco home into every iteration. This supports realistic
  long-thread and cache workloads without committing user data or a version-fragile database.
- Store raw samples as JSON and generate a human-readable Markdown comparison.
- Apply both relative and absolute regression thresholds. Small timing noise alone must not fail a
  run.
- Keep opt-in application profiling disabled during normal measurements. It may be enabled in a
  separate diagnostic run, but must never silently change benchmark semantics.

## Commands

The public interface is:

```sh
bun run perf:smoke
bun run perf:external -- run [options]
bun run perf:compare -- --base origin/main --candidate HEAD [options]
```

`perf:smoke` uses existing local build output and one short iteration. `run` measures the current
checkout or an already-running URL. `compare` creates isolated worktrees, installs with the frozen
lockfile, builds the relevant production packages, runs the same scenarios for both revisions, and
writes the comparison artifacts.

## Measurement Lifecycle

Each launched iteration:

1. creates a unique temporary home and optionally copies a sanitized fixture home;
2. chooses an unused loopback port;
3. starts the built server in headless mode with browser opening, analytics, and Hub activity
   disabled;
4. records spawn-to-ready time and parses the emitted one-time pairing URL;
5. opens a fresh Chromium context with cache disabled;
6. records navigation, paint, layout-shift, long-task, network, and WebSocket observations;
7. records a foreground idle window;
8. backgrounds the app with a second tab and records a hidden idle window;
9. restores the app, exercises an offline/online transition, and measures WebSocket recovery;
10. samples the launched process tree throughout the run;
11. closes Chromium and terminates the server gracefully, escalating only if its bounded shutdown
    deadline expires.

An optional route and readiness selector allow the same lifecycle to measure a thread, settings
surface, diff, or another fixture-backed screen after authentication.

## Metrics

Raw samples include:

- server readiness and browser navigation timings;
- TTFB, DOM content loaded, FCP, LCP, CLS, and usable-shell time;
- HTTP request count and encoded transfer bytes;
- WebSocket frame count and payload bytes;
- foreground and background idle request counts;
- foreground and background browser task duration;
- offline-to-WebSocket-reconnect latency;
- long-task count and maximum duration;
- renderer heap before and after idle phases;
- process-tree peak RSS and aggregate CPU samples;
- page, console, server, and harness errors.

The report presents per-revision median, p95, and maximum values. Comparison gates use the median
for noisy continuous metrics and exact ceilings for error and unexpected-background-work counts.

## Comparison Policy

The default policy is deliberately conservative:

- startup and paint metrics: fail only when the candidate is at least 15% and 50 ms slower;
- LCP and usable-shell time: 15% and 100 ms;
- transfer bytes: 10% and 10 KiB;
- peak process-tree RSS: 10% and 20 MiB;
- foreground or hidden idle requests: no more than one request above baseline;
- page errors, console errors, failed requests, server crashes, and missing required measurements:
  fail immediately.

A checked-in policy file can override these values as stable dedicated-runner baselines emerge.
Local comparison reports remain useful even when a machine is too noisy for gating.

## Isolation and Safety

- Ref comparison refuses a dirty candidate when asked to measure `HEAD`.
- Temporary worktrees and homes are created beneath a harness-owned temporary root.
- The source fixture home must be stopped and is copied, never symlinked or modified.
- Secrets and private profiles are never written into reports.
- Output includes commit hashes, platform, architecture, runtime versions, scenario configuration,
  and raw samples for reproducibility.
- Cleanup targets only paths created by the current harness run.

## Testing

Unit tests cover argument parsing, statistical aggregation, threshold evaluation, report
generation, process-table parsing, startup-output parsing, and metric delta calculation. A focused
smoke run proves the built server and Chromium lifecycle on the current checkout. Full ref
comparison is intentionally an explicit developer/nightly command because it installs and builds
two worktrees.

## CI Rollout

1. Land the harness and run `perf:smoke` manually and in an opt-in workflow.
2. Add a short PR job after dedicated-runner variance is known.
3. Run multi-iteration ref comparisons nightly with a representative sanitized fixture.
4. Add packaged-desktop and sustained provider/terminal workload adapters only after their fixture
   custody and platform runner requirements are available.

The scenario boundary is intentionally extensible, but the first implementation does not add
production-only fixture endpoints or weaken authentication to manufacture load.
