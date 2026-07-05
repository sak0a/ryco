# 25 — macOS notarization

| Field | Value |
|-------|-------|
| **Batch** | Ops / trust |
| **Recommended model** | Composer 2.5 |
| **Subagent?** | Solo |
| **Dependencies** | None |
| **PR size** | Small (docs/CI) |

## Prompt

Document and automate macOS code signing + notarization for Electron releases (or improve unsigned install UX if signing cert unavailable).

### Context

- `apps/desktop` electron-builder config
- README unsigned workaround (`xattr` quarantine)
- `scripts/build-desktop-artifact.ts`

### Requirements

- If Developer ID available: notarize + staple in CI release job
- If not: improve `Install Ryco.command` and first-run UX with clear in-app notice
- Update `docs/release.md`

### Acceptance

- Release docs accurate
- DMG install path tested on clean macOS VM or documented manual verification
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked
