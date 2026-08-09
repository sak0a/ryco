# TypeScript tooling

Ryco uses **TypeScript 7** for typechecking. During dependency installation,
`@effect/tsgo` patches the native compiler with its matching Effect-enabled TS7
binary. The normal `bun typecheck` command therefore emits both standard
TypeScript diagnostics and the Effect diagnostics configured in each project's
`tsconfig.json`.

| Command         | Compiler                       | When to run                       |
| --------------- | ------------------------------ | --------------------------------- |
| `bun typecheck` | TS7 (`tsc`, patched by Effect) | The single local and CI type gate |

The `@effect/tsgo` version is pinned alongside TypeScript because its binary is
built against a specific TypeScript release. Keep the pair aligned when either
dependency changes. Suggestion-level Effect diagnostics are hidden in CLI runs
to keep the gate actionable; errors and configured warnings still fail it.
