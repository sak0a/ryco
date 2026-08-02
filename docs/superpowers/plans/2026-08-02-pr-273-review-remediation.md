# PR 273 Review Remediation Implementation Plan

**Goal:** Address the two approved Codex review threads by preserving the frozen web-phone
diagnostics presentation and making replay metric registration cancellation-safe.

**Design spec:**
`docs/superpowers/specs/2026-08-02-pr-273-review-remediation-design.md`

## Tasks

- [ ] Add an explicit diagnostics presentation mode while keeping snapshot acquisition,
      visibility-aware polling, warnings, controls, and derived data shared.

- [ ] Reconstruct the pre-PR phone diagnostics section inventory from the base branch and have
      `PhoneSettingsSurface` request it explicitly.

- [ ] Extend browser coverage to prove the phone surface excludes the expanded desktop sections
      while desktop retains them.

- [ ] Extract replay aggregate publication/cleanup so metric state can be registered with
      `Effect.acquireRelease` at insertion time.

- [ ] Keep eager `reset` cleanup idempotent and add a scope-close test that proves aggregate
      pressure returns to zero without an explicit reset.

- [ ] Run focused server typechecks/tests and focused browser tests.

- [ ] Run the complete `AGENTS.md` validation backstop, including the web build and browser suite.

- [ ] Report which review threads are fixed. Do not reply to or resolve GitHub threads without
      separate authorization.
