# GitHub Automation

Ryco keeps CI entrypoints small and routes shared checks through
`.github/workflows/_validation.yml`.

- `ci.yml` validates `main` and manual CI runs with the full suite.
- `pull-request-validation.yml` is the single automatic source of truth for
  branches. `pr-vouch.yml` dispatches validation for `vouch:trusted` PRs; an
  unvouched PR requires a maintainer's manual dispatch. Its gate fetches the PR
  through the API to decide whether browser and desktop jobs are needed and to
  supply the base SHA for affected-package validation. `main` always runs the
  full suite.
- `branch-ci.yml` manually validates an arbitrary branch/ref on demand
  (`workflow_dispatch`) with format, lint, typecheck, and tests. It does not run
  on push, so a commit is never validated twice (once on push and once on its
  PR) — pull request validation owns automatic branch CI.
- `worktree-validation.yml` manually validates a worktree-backed ref and records
  the local worktree label/path in the run summary when provided.

## Parallelism and path scoping

`_validation.yml` runs each check as its own job so they execute in parallel
rather than as one serial chain. Core validation (`static`, Effect typecheck,
test matrix/tests, and build) uses the repository-scoped self-hosted runner label
`ryco-validation`; browser, desktop, release-smoke, and control jobs run on
GitHub-hosted Ubuntu. The two long poles are sharded across runners:

- `typecheck-effect` splits its projects into two shards via
  `bun run typecheck:effect --shard <i>/<n>`. Sharding is derived from the
  authoritative project list in `scripts/typecheck-effect.ts` (round-robin), so
  adding a project can never silently drop it from a shard.
- `test` switches shape by mode (Turbo forbids `--filter` with `--affected`):
  full runs shard the whole suite into three legs — `ryco-cli` (server) and
  `@ryco/web` each get a runner, and `rest` catches every other package through
  negation filters (`--filter=!ryco-cli --filter=!@ryco/web`) so a new package is
  always covered; PRs instead run a single `--affected` job.

## Affected scoping and caching

On PRs, `pull-request-validation.yml` passes `affected-base` (the base branch
SHA) into `_validation.yml`, which sets `TURBO_SCM_BASE` and appends `--affected`
to `typecheck`, `test`, and `build`. Turbo then runs those tasks only for the
packages the diff touches **and their dependents** (a change to
`packages/contracts` still tests everything that imports it). Full history is
checked out (`fetch-depth: 0`) in those jobs so Turbo can compute the diff; `main`
and manual runs pass no base and validate every package.

Caching compounds this: `typecheck` and `build` are Turbo-cached (unchanged
packages are skipped and their pass/fail memoized by input hash), while `test`
stays uncached because tests may not be pure. `globalDependencies` lists the
shared root `tsconfig.*.json` files so editing them busts every cache, and the
`.turbo` action cache uses a per-commit key with `restore-keys` so it accumulates
run to run instead of freezing at a lockfile-stable key.

`browser`, `desktop`, and `release-smoke` stay gated behind the `run-*` inputs.
On PRs their inputs come from the dispatch gate. Its filters are deliberately
broad (any `packages/**`, lockfile, or CI-infra change trips them) so a check is
never wrongly skipped — the savings come from app-scoped PRs (server-only,
docs-only, config-only) that don't touch the web or desktop surfaces.

Shared toolchain setup lives in `.github/actions/setup-ryco`, so new workflows
should reuse that action instead of duplicating Vite+, Bun, Node, cache, and
install steps. The action uses `setup-vp` for Vite+ and Node, sets up Bun
explicitly for Ryco's command surface, and installs dependencies with
`vp install`, which keeps Bun as the underlying package manager via
`packageManager`. Bun setup caching is disabled because runner containers do not
share stable home-directory paths; the explicit Turbo cache supplies reuse.

Reusable validation uses Ryco's canonical Bun entrypoints: `bun run fmt:check`,
`bun run lint`, `bun run typecheck`, `bun run test`, and `bun run build`.
Those scripts call Vite+ where applicable, while keeping one CI command surface
for the monorepo.
