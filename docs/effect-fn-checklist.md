# Effect.fn Refactor Notes

This file used to contain a generated `Effect.fn` migration checklist from an older checkout. The
old scan referenced absolute paths and files that no longer exist, so it should not be treated as a
current task list.

If you want to continue this refactor, regenerate a fresh candidate list from the current tree.

Useful starting points:

```bash
rg "=>\\s*Effect\\.gen\\(function\\*|return\\s+Effect\\.gen\\(function\\*" apps packages scripts -g '*.ts' -g '!*.test.ts'
```

Preferred style:

```ts
const makeThing = Effect.fn("makeThing")(function* (input: Input): Effect.fn.Return<A, E, R> {
  // ...
});
```

Use `Effect.fn("name")(function* (...) {}, (effect, input) => ...)` when the helper needs a shared
post-processing pipe such as logging, retry, or error mapping.

When updating production code, keep the same behavioral contract and run the project-required checks:

```bash
bun fmt
bun lint
bun typecheck
```

Use `bun run test`, never `bun test`, when running the Vitest suite.
