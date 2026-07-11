# TypeScript tooling

Ryco uses **TypeScript 7** for daily typechecking (`bun typecheck`). The native Go compiler is ~10× faster than TS6 and is the default for CI and local dev.

**Why TS6 is still installed:** `@effect/language-service` patches the JS-based TypeScript compiler to emit Effect-specific diagnostics (floating effects, barrel imports, etc.) at `tsc` time. TS7 ships as a native binary with no patchable `typescript.js`. We install `@typescript/typescript6` (which wraps the JS `@typescript/old` compiler as `tsc6`) and patch that — leaving TS7 untouched.

| Command                    | Compiler              | When to run                                    |
| -------------------------- | --------------------- | ---------------------------------------------- |
| `bun typecheck`            | TS7 (`tsc`)           | Always — fast gate for all packages            |
| `bun run typecheck:effect` | TS6 (`tsc6`, patched) | When editing Effect-heavy code; enforced in CI |

This split keeps TS7 speed on the hot path without losing Effect lint coverage. Once TS 7.1 stabilizes the programmatic API and `@effect/language-service` supports it, the side-by-side setup can be removed.
