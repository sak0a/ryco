# GitHub Automation

Ryco keeps CI entrypoints small and routes shared checks through
`.github/workflows/_validation.yml`.

- `ci.yml` validates `main` and manual CI runs with the full suite.
- `branch-ci.yml` validates non-`main` branch pushes with format, lint,
  typecheck, and tests. When the branch already has an open PR, branch CI skips
  expensive validation and lets PR validation own the ref.
- `pull-request-validation.yml` runs the full validation suite for PR review.
- `worktree-validation.yml` manually validates a worktree-backed ref and records
  the local worktree label/path in the run summary when provided.

Shared toolchain setup lives in `.github/actions/setup-ryco`, so new workflows
should reuse that action instead of duplicating Vite+, Bun, Node, cache, and
install steps. The action uses `setup-vp` for Vite+ and Node, sets up Bun
explicitly for Ryco's command surface, and installs dependencies with
`vp install`, which keeps Bun as the underlying package manager via
`packageManager`.

Reusable validation intentionally covers both command surfaces:

- Ryco commands: `bun run fmt:check`, `bun run lint`, `bun run typecheck`,
  `bun run test`, and `bun run build`.
- Vite+ compatibility: `vp check`, `vp test`, and `vp build`.
