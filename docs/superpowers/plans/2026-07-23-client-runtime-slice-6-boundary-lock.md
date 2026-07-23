# Client runtime slice 6: cleanup and boundary lock

**Goal:** Lock the extraction's boundary so it cannot silently regress, and retire
the migration-era residue. No behavior changes.

**Design spec:** `docs/superpowers/specs/2026-07-23-client-runtime-extraction-design.md`
(Slice 6).

## Execution rules

- Work only on `feat/client-runtime-boundary-lock`. No behavior changes; all
  existing tests pass with unchanged assertions (specifier updates only where a
  shim narrows).
- Never `bun test`; use `bun run test`. Pre-installed worktree. Stage nothing;
  `git diff --check`; scripts/lib clean; no AI trailers; no private detail.

## Task 1 — Boundary hardening

- Audit the `no-restricted-imports` override for the package against everything
  the extraction now contains: confirm react/react-dom/@effect/atom-react/node:
  deep-path coverage still suffices, and add any gap a grep sweep reveals
  (e.g. `zustand/middleware` is allowed — it is used; `@tanstack/*` must not
  appear; `~/` app-alias imports must be impossible from the package — verify
  the resolver cannot resolve them and add a ban if it can).
- Verify the DOM-lib exclusion + `types: []` still hold on every package
  tsconfig surface; the ambient shims file's inventory comment matches its
  contents.
- Add a package test (or extend an existing one) that greps the package source
  for forbidden patterns as a belt-and-braces CI-independent check ONLY if the
  repo has an existing precedent for source-sweep tests (the acceptance matrix
  does raw-source assertions — follow that pattern); otherwise rely on
  lint+tsconfig and note it.

## Task 2 — Residue retirement

- The unconsumed `HttpClient` platform tag: wire it as the declared home of the
  connection layer's injected http client (one-line consumption) or remove it —
  choose whichever matches how slice 3's connection code actually receives
  fetch, and say which you chose and why.
- Narrow the widest `export *` binding shims (`~/types`, `~/lib/threadSort`,
  and any binding re-exporting configurator setters that no consumer uses) to
  what their consumers import — verified by typecheck, no consumer edits.
- Sweep for any remaining dual-references, dead re-exports, or orphaned
  migration-era helpers across apps/web bindings; retire them.

## Task 3 — Flake quarantine decision

`apps/server/src/server.test.ts` static-asset tests flake under full-suite
parallelism (~3s timing-sensitive cases; recurred across three slices).
Investigate the repo's vitest config for an existing serial/isolation
mechanism; if a low-risk one exists (e.g. per-file `describe.sequential`,
poolMatchGlobs, or maxConcurrency for that file), apply it narrowly to the
flaky file with a comment. If nothing low-risk exists, do not invent one —
report the options instead.

## Task 4 — Validation (agent, offline)

fmt, fmt:check, lint, typecheck, typecheck:effect, `bun run test`, build,
`git diff --check`, scripts/lib clean. Falsify one new boundary rule (inject a
violation, observe the failure, restore). Report everything run.

## Task 5 — Gates, evidence, PR (orchestrator)

Full gate set, audit baseline, three consecutive clean browser runs, diff
review, PR.
