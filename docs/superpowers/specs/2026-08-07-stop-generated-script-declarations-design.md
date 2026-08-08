# Stop Generated Script Declarations

## Problem

The private `@ryco/scripts` TypeScript project is typecheck-only, but its `composite` setting allows
project builds to emit declaration files beside source files. The declaration emitter and repository
formatter use different layouts, so repeated builds and formatting toggle tracked `scripts/lib/*.d.ts`
files between two representations.

## Design

- Remove `composite` from `scripts/tsconfig.json`. The project will inherit `noEmit: true` and remain a
  typecheck-only workspace.
- Give the server bundle a dedicated non-composite TypeScript config scoped to its `src` entry graph,
  instead of feeding its declaration bundler the broad server typecheck config that includes
  `scripts/lib`.
- Remove the tracked declaration files generated beside `scripts/lib/*.ts`; the TypeScript sources are
  authoritative and no package consumes the declarations.
- Add a narrow Git ignore rule for declaration files under `scripts/` so accidental explicit compiler
  emission cannot reintroduce source-tree artifacts.
- Keep handwritten declarations elsewhere in the repository unaffected.

## Validation

Run the scripts workspace typecheck and verify that a TypeScript project build does not recreate the
removed declarations. Then run the repository formatting, linting, typechecking, test, and build
backstop required by `AGENTS.md`.
