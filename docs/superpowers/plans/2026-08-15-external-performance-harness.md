# External Performance Harness Implementation Plan

Date: 2026-08-15

## 1. Shared model and statistics

- Define versioned result, sample, aggregate, comparison, and policy types.
- Implement finite-number normalization, median, nearest-rank p95, maxima, and metric deltas.
- Unit test odd/even samples, missing values, and regression threshold boundaries.

## 2. External collectors

- Implement cross-platform-safe process-tree sampling through `ps` on macOS/Linux, with an
  explicit unsupported result elsewhere.
- Implement Chromium collection through Playwright and CDP.
- Capture navigation, Web Vitals, long tasks, network bytes, WebSocket frames, lifecycle-specific
  deltas, heap, and browser task duration.
- Keep collection failures in the sample rather than silently omitting evidence.

## 3. Production server lifecycle

- Reserve a loopback port and create an isolated Ryco home.
- Clone an optional sanitized fixture home.
- Launch the built server in headless mode and parse readiness/pairing output.
- Terminate the exact child process gracefully with a bounded escalation path.
- Unit test parsing and lifecycle-independent helpers.

## 4. Runner and reports

- Run repeated samples with fresh homes and browser contexts.
- Aggregate metrics and record environment metadata.
- Render JSON and Markdown artifacts.
- Compare reports using relative plus absolute thresholds and return a nonzero exit code on a real
  regression.

## 5. Git-ref orchestration

- Refuse dirty `HEAD` measurements.
- Create detached temporary worktrees for the baseline and candidate.
- Install with `bun install --frozen-lockfile` and build the server/web production targets.
- Measure build duration and peak build-process RSS.
- Run both revisions with identical scenario options, then remove only harness-owned worktrees.

## 6. Repository integration

- Add root scripts for smoke, current-checkout measurement, and ref comparison.
- Add the pinned Playwright dependency to the scripts workspace.
- Ignore generated performance result directories.
- Document fixture preparation, commands, outputs, limitations, and CI recommendations.

## 7. Verification

- Install dependencies with the repository-pinned Bun release.
- Run focused scripts-package tests and typecheck.
- Run topic-file formatting and lint checks.
- Build the relevant web/server packages.
- Run one external smoke iteration against the current production build.
- Inspect the final diff for generated artifacts, credentials, local profiles, or unrelated files.
