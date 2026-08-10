# Issue Creation Dialog (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a "New issue" dialog on the Issues tab that lets the user write a rough description, polish it with the configured text-generation model, set labels/assignees, and optionally create a worktree with an AI-suggested branch name on submit. GitHub-only for Phase 1; other providers stub the new contract methods.

**Architecture:** Bottom-up. Contracts first, then the text-generation service extension, then the source-control provider extension and GitHub implementation, then RPC wiring, then web client hooks, then the dialog UI. Each layer is testable and committable on its own. Provider abstraction is preserved so Phase 3 can add GitLab/Forgejo/Bitbucket/Azure DevOps without dialog changes.

**Tech Stack:** Effect/TypeScript (server), React + TanStack Query + Effect Schema (web), Vitest (tests), `gh` CLI (GitHub provider), Bun (runtime/test runner).

**Spec:** [docs/superpowers/specs/2026-05-16-issue-creation-dialog-design.md](../specs/2026-05-16-issue-creation-dialog-design.md)

---

## Conventions and reminders

- Project commands (from `AGENTS.md`): `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` (never `bun test`).
- TDD: write the failing test, run to confirm failure, implement, run to confirm pass, commit. Commit after every task.
- Imports use `.ts` extension (per existing codebase convention). Use `import type` for type-only imports.
- Effect-style: services declared via `Context.Service` tags; errors with `Schema.TaggedErrorClass`.
- Existing patterns to mirror:
  - `gitHubIssues.ts` (parsing) + `GitHubCli.ts` (CLI operations) split.
  - `createPullRequest` in `GitHubCli.ts` uses `--body-file <path>` with a temp file (NOT stdin). Mirror this for `--body-file` on `gh issue create`.
  - `buildCommitMessagePrompt` / `buildPrContentPrompt` in `TextGenerationPrompts.ts` for prompt builders.
  - `NewWorktreeDialog.tsx` (similar dialog shape and `onCreated` callback pattern).

---

## Task 1: Add issue creation contract schemas

**Files:**

- Modify: `packages/contracts/src/sourceControl.ts`
- Test: `packages/contracts/src/sourceControl.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/contracts/src/sourceControl.test.ts`:

```ts
import { SourceControlAssigneeCandidate, SourceControlCreateIssueInput } from "./sourceControl.ts";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

describe("SourceControlAssigneeCandidate", () => {
  it("requires login; optional displayName and avatarUrl", () => {
    const decode = Schema.decodeUnknownSync(SourceControlAssigneeCandidate);
    expect(decode({ login: "alice" })).toEqual({ login: "alice" });
    expect(decode({ login: "alice", displayName: "Alice", avatarUrl: "https://x" })).toEqual({
      login: "alice",
      displayName: "Alice",
      avatarUrl: "https://x",
    });
    expect(() => decode({ login: "" })).toThrow();
  });
});

describe("SourceControlCreateIssueInput", () => {
  it("requires cwd + title; body may be empty; worktree is optional", () => {
    const decode = Schema.decodeUnknownSync(SourceControlCreateIssueInput);
    expect(decode({ cwd: "/repo", title: "Bug", body: "" })).toEqual({
      cwd: "/repo",
      title: "Bug",
      body: "",
    });
    expect(
      decode({
        cwd: "/repo",
        title: "Bug",
        body: "details",
        labels: ["bug"],
        assignees: ["alice"],
        worktree: { enabled: true, branchName: "fix/bug" },
      }),
    ).toMatchObject({ worktree: { enabled: true, branchName: "fix/bug" } });
    expect(() => decode({ cwd: "", title: "Bug", body: "" })).toThrow();
    expect(() => decode({ cwd: "/repo", title: "", body: "" })).toThrow();
  });
});

// Note: The merged result type that includes worktree output lives in
// packages/contracts/src/rpc.ts (Task 10), because GitCreateWorktreeForProjectOutput
// is declared there. No separate result type is needed in sourceControl.ts.
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun run test packages/contracts/src/sourceControl.test.ts
```

Expected: failures stating `SourceControlAssigneeCandidate is not exported` (or similar).

- [ ] **Step 3: Add the schemas**

Append to `packages/contracts/src/sourceControl.ts` (after the existing `SourceControlIssueDetail` block, before `SourceControlChangeRequestCommit`):

```ts
export const SourceControlAssigneeCandidate = Schema.Struct({
  login: TrimmedNonEmptyString,
  displayName: Schema.optional(TrimmedNonEmptyString),
  avatarUrl: Schema.optional(Schema.String),
});
export type SourceControlAssigneeCandidate = typeof SourceControlAssigneeCandidate.Type;

export const SourceControlCreateIssueWorktree = Schema.Struct({
  enabled: Schema.Boolean,
  branchName: TrimmedNonEmptyString,
});
export type SourceControlCreateIssueWorktree = typeof SourceControlCreateIssueWorktree.Type;

export const SourceControlCreateIssueInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  body: Schema.String,
  labels: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  assignees: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  worktree: Schema.optional(SourceControlCreateIssueWorktree),
});
export type SourceControlCreateIssueInput = typeof SourceControlCreateIssueInput.Type;
```

No result type is declared in `sourceControl.ts`. The RPC's merged result type (which references `GitCreateWorktreeForProjectOutput`) is declared in `packages/contracts/src/rpc.ts` in Task 10, where the worktree output type is already in scope.

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun run test packages/contracts/src/sourceControl.test.ts
```

Expected: all new tests pass.

- [ ] **Step 5: Run typecheck + lint**

```bash
bun typecheck && bun lint
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/sourceControl.ts packages/contracts/src/sourceControl.test.ts
git commit -m "Add issue creation contract schemas"
```

---

## Task 2: Extend CreateWorktreeIntent to carry an optional branch name for issues

**Files:**

- Modify: `packages/contracts/src/worktree.ts:35-45`
- Test: `packages/contracts/src/worktree.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/contracts/src/worktree.test.ts`:

```ts
import { CreateWorktreeIntent } from "./worktree.ts";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

describe("CreateWorktreeIntent (issue variant)", () => {
  const decode = Schema.decodeUnknownSync(CreateWorktreeIntent);

  it("accepts issue intent without branchName (existing callers)", () => {
    expect(decode({ kind: "issue", number: 42 })).toEqual({ kind: "issue", number: 42 });
  });

  it("accepts issue intent with branchName override", () => {
    expect(decode({ kind: "issue", number: 42, branchName: "fix/bug" })).toEqual({
      kind: "issue",
      number: 42,
      branchName: "fix/bug",
    });
  });

  it("rejects empty branchName", () => {
    expect(() => decode({ kind: "issue", number: 42, branchName: "" })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun run test packages/contracts/src/worktree.test.ts
```

Expected: the second test fails — `branchName` is rejected today.

- [ ] **Step 3: Update the schema**

In `packages/contracts/src/worktree.ts`, replace the issue variant inside `CreateWorktreeIntent`:

```ts
export const CreateWorktreeIntent = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("branch"), branchName: TrimmedNonEmptyString }),
  Schema.Struct({ kind: Schema.Literal("pr"), number: Schema.Number }),
  Schema.Struct({
    kind: Schema.Literal("issue"),
    number: Schema.Number,
    branchName: Schema.optional(TrimmedNonEmptyString),
  }),
  Schema.Struct({
    kind: Schema.Literal("newBranch"),
    branchName: Schema.optional(TrimmedNonEmptyString),
    baseBranch: Schema.optional(TrimmedNonEmptyString),
  }),
]);
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun run test packages/contracts/src/worktree.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run typecheck across the workspace**

```bash
bun typecheck
```

Expected: clean. If any code in `apps/server/src/git/GitManager.ts` exhaustiveness-checks the issue variant and breaks, fix it minimally by destructuring `branchName` (treat as optional override).

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/worktree.ts packages/contracts/src/worktree.test.ts
git commit -m "Allow issue CreateWorktreeIntent to carry a branch name override"
```

---

## Task 3: Add `issueInstructions` to TextGenerationPolicy

**Files:**

- Modify: `apps/server/src/textGeneration/TextGenerationPolicy.ts`

- [ ] **Step 1: Update the policy schema**

Replace the body of `TextGenerationPolicy` in `apps/server/src/textGeneration/TextGenerationPolicy.ts`:

```ts
export const TextGenerationPolicy = Schema.Struct({
  kind: TextGenerationPolicyKind,
  commitInstructions: Schema.optional(Schema.String),
  changeRequestInstructions: Schema.optional(Schema.String),
  branchInstructions: Schema.optional(Schema.String),
  threadTitleInstructions: Schema.optional(Schema.String),
  issueInstructions: Schema.optional(Schema.String),
  inferRepositoryConventions: Schema.Boolean,
});
```

- [ ] **Step 2: Run typecheck**

```bash
bun typecheck
```

Expected: clean. The field is `Schema.optional` so no existing consumer breaks.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/textGeneration/TextGenerationPolicy.ts
git commit -m "Add issueInstructions to TextGenerationPolicy"
```

---

## Task 4: Add `generateIssueContent` prompt builders

**Files:**

- Modify: `apps/server/src/textGeneration/TextGenerationPrompts.ts`
- Test: `apps/server/src/textGeneration/TextGenerationPrompts.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/server/src/textGeneration/TextGenerationPrompts.test.ts`:

```ts
import {
  buildIssueContentPolishPrompt,
  buildIssueContentTitlePrompt,
} from "./TextGenerationPrompts.ts";
import { describe, expect, it } from "vitest";

describe("buildIssueContentPolishPrompt", () => {
  it("requests a JSON object with title and body", () => {
    const { prompt, outputSchema } = buildIssueContentPolishPrompt({
      rough: "login broken on safari 17",
    });
    expect(prompt).toContain('"title"');
    expect(prompt).toContain('"body"');
    expect(prompt).toContain("login broken on safari 17");
    const schema = outputSchema as ReturnType<typeof buildIssueContentPolishPrompt>["outputSchema"];
    expect(schema).toBeDefined();
  });

  it("includes currentTitle context when provided", () => {
    const { prompt } = buildIssueContentPolishPrompt({
      rough: "details",
      currentTitle: "Existing title",
    });
    expect(prompt).toContain("Existing title");
  });

  it("injects issueInstructions when policy is given", () => {
    const { prompt } = buildIssueContentPolishPrompt({
      rough: "details",
      policy: {
        kind: "custom",
        inferRepositoryConventions: false,
        issueInstructions: "Always use British English.",
      },
    });
    expect(prompt).toContain("British English");
  });
});

describe("buildIssueContentTitlePrompt", () => {
  it("requests a JSON object with title only, derived from body", () => {
    const { prompt } = buildIssueContentTitlePrompt({
      body: "Safari 17 CORS error on /api/auth/session",
    });
    expect(prompt).toContain('"title"');
    expect(prompt).toContain("Safari 17 CORS error");
    expect(prompt).toContain("72");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
bun run test apps/server/src/textGeneration/TextGenerationPrompts.test.ts
```

Expected: import errors / "function not defined".

- [ ] **Step 3: Implement the prompt builders**

Append to `apps/server/src/textGeneration/TextGenerationPrompts.ts`:

```ts
// ---------------------------------------------------------------------------
// Issue content (polish + title)
// ---------------------------------------------------------------------------

export interface IssueContentPolishPromptInput {
  rough: string;
  currentTitle?: string;
  policy?: TextGenerationPolicy | undefined;
}

export function buildIssueContentPolishPrompt(input: IssueContentPolishPromptInput) {
  const prompt = [
    "You rewrite rough notes into a clear GitHub issue.",
    'Return a JSON object with keys: "title", "body".',
    "Rules:",
    "- title must be <= 72 chars, no trailing period",
    "- title should read as a noun phrase or imperative",
    "- body must be markdown",
    "- if the rough text describes a bug, use sections: '## Steps to reproduce',",
    "  '## Expected', '## Actual'",
    "- otherwise use a one-line summary followed by bullet points",
    "- preserve any code, command output, or error text from the rough notes verbatim",
    ...(input.currentTitle ? ["", `Current title hint: ${input.currentTitle}`] : []),
    ...policyInstruction(input.policy?.issueInstructions),
    "",
    "Rough notes:",
    limitSection(input.rough, 8_000),
  ].join("\n");

  return {
    prompt,
    outputSchema: Schema.Struct({
      title: Schema.String,
      body: Schema.String,
    }),
  };
}

export interface IssueContentTitlePromptInput {
  body: string;
  policy?: TextGenerationPolicy | undefined;
}

export function buildIssueContentTitlePrompt(input: IssueContentTitlePromptInput) {
  const prompt = [
    "You write concise GitHub issue titles from an existing body.",
    'Return a JSON object with one key: "title".',
    "Rules:",
    "- title must be <= 72 chars, no trailing period",
    "- title should read as a noun phrase or imperative",
    "- title should capture the primary user-visible issue",
    ...policyInstruction(input.policy?.issueInstructions),
    "",
    "Body:",
    limitSection(input.body, 8_000),
  ].join("\n");

  return {
    prompt,
    outputSchema: Schema.Struct({
      title: Schema.String,
    }),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
bun run test apps/server/src/textGeneration/TextGenerationPrompts.test.ts
```

Expected: all new tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/textGeneration/TextGenerationPrompts.ts apps/server/src/textGeneration/TextGenerationPrompts.test.ts
git commit -m "Add generateIssueContent prompt builders (polish + title modes)"
```

---

## Task 5: Extend `TextGenerationShape` with `generateIssueContent` and route from the registry

**Files:**

- Modify: `apps/server/src/textGeneration/TextGeneration.ts`
- Test: `apps/server/src/textGeneration/TextGeneration.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/server/src/textGeneration/TextGeneration.test.ts`:

```ts
describe("generateIssueContent", () => {
  it("delegates to the resolved provider instance", () =>
    Effect.gen(function* () {
      const tg = yield* makeTextGenerationLayerForTest({
        // existing helper in this file — copy from the generateBranchName test
        generateIssueContent: (input) => {
          if (input.mode === "polish") {
            return Effect.succeed({ title: "Polished", body: "## Body" });
          }
          return Effect.succeed({ title: "From body" });
        },
      });

      const polish = yield* tg.generateIssueContent({
        cwd: "/repo",
        mode: "polish",
        rough: "rough notes",
        modelSelection: testModelSelection,
      });
      expect(polish).toEqual({ title: "Polished", body: "## Body" });

      const title = yield* tg.generateIssueContent({
        cwd: "/repo",
        mode: "title",
        body: "Body content",
        modelSelection: testModelSelection,
      });
      expect(title).toEqual({ title: "From body" });
    }).pipe(Effect.runPromise));

  it("fails with TextGenerationError when instance is missing", () =>
    Effect.gen(function* () {
      const tg = yield* makeTextGenerationLayerWithoutInstance();
      const result = yield* tg
        .generateIssueContent({
          cwd: "/repo",
          mode: "polish",
          rough: "x",
          modelSelection: missingInstanceModelSelection,
        })
        .pipe(Effect.flip);
      expect(result.operation).toBe("generateIssueContent");
    }).pipe(Effect.runPromise));
});
```

If a helper `makeTextGenerationLayerForTest` does not already exist in this file under that exact name, mirror the existing `generateBranchName` test setup — read the surrounding test code in `TextGeneration.test.ts` and follow the established pattern.

- [ ] **Step 2: Run to verify it fails**

```bash
bun run test apps/server/src/textGeneration/TextGeneration.test.ts
```

Expected: `generateIssueContent is not a function on TextGenerationShape`.

- [ ] **Step 3: Add types and shape method**

In `apps/server/src/textGeneration/TextGeneration.ts`, add the input/output types alongside the other `*GenerationInput`/`*GenerationResult` types:

```ts
export interface IssueContentGenerationInput {
  cwd: string;
  mode: "polish" | "title";
  rough?: string;
  body?: string;
  currentTitle?: string;
  modelSelection: ModelSelection;
}

export interface IssueContentGenerationResult {
  title?: string;
  body?: string;
}
```

Add to `TextGenerationService` interface:

```ts
generateIssueContent(input: IssueContentGenerationInput): Promise<IssueContentGenerationResult>;
```

Add to `TextGenerationShape` interface:

```ts
readonly generateIssueContent: (
  input: IssueContentGenerationInput,
) => Effect.Effect<IssueContentGenerationResult, TextGenerationError>;
```

Add `"generateIssueContent"` to the `TextGenerationOp` union.

Add to `makeTextGenerationFromRegistry`:

```ts
generateIssueContent: (input) =>
  resolveInstance(registry, "generateIssueContent", input.modelSelection.instanceId).pipe(
    Effect.flatMap((textGeneration) => textGeneration.generateIssueContent(input)),
  ),
```

- [ ] **Step 4: Update the stub maps in this test file and any other test stubs**

Locate the test stub object near the top of the file (the one currently assigning `Effect.die("generateCommitMessage stub not configured…")` etc.). Add:

```ts
generateIssueContent: () =>
  Effect.die("generateIssueContent stub not configured for this test"),
```

Repeat the same addition in:

- `apps/server/src/git/GitManager.test.ts` (search for the existing `generateBranchName` stub block)
- `apps/server/integration/OrchestrationEngineHarness.integration.ts`
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts`

(Use grep to find all files referencing `generateBranchName` and add the missing field — the TypeScript compiler will tell you which files break otherwise.)

- [ ] **Step 5: Run typecheck to find every stub site**

```bash
bun typecheck
```

Expected: errors at any test or integration file with a `TextGenerationShape` stub that's now missing `generateIssueContent`. Fix each by adding the stub line above. Re-run until clean.

- [ ] **Step 6: Run the new test to verify it passes**

```bash
bun run test apps/server/src/textGeneration/TextGeneration.test.ts
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/textGeneration apps/server/src/git apps/server/src/orchestration apps/server/integration
git commit -m "Add generateIssueContent to TextGeneration service"
```

---

## Task 6: Implement `generateIssueContent` in every TextGeneration driver

**Files:**

- Modify: `apps/server/src/textGeneration/CodexTextGeneration.ts`
- Modify: `apps/server/src/textGeneration/ClaudeTextGeneration.ts`
- Modify: `apps/server/src/textGeneration/CopilotTextGeneration.ts`
- Modify: `apps/server/src/textGeneration/CursorTextGeneration.ts`
- Modify: `apps/server/src/textGeneration/OpenCodeTextGeneration.ts`
- Test: `apps/server/src/textGeneration/CodexTextGeneration.test.ts`
- Test: `apps/server/src/textGeneration/ClaudeTextGeneration.test.ts`
- Test: `apps/server/src/textGeneration/OpenCodeTextGeneration.test.ts`
- Test: `apps/server/src/textGeneration/CursorTextGeneration.test.ts`

- [ ] **Step 1: Read the existing pattern**

Open `apps/server/src/textGeneration/CodexTextGeneration.ts` and locate the existing `generateBranchName` method. Note how it:

1. Builds a prompt via `buildBranchNamePrompt(...)`.
2. Runs the CLI with that prompt and the `modelSelection`.
3. Decodes the JSON output against the prompt's `outputSchema`.
4. Maps schema/JSON errors to `TextGenerationError`.

Read the equivalent in `ClaudeTextGeneration.ts`, `OpenCodeTextGeneration.ts`, `CursorTextGeneration.ts`, and `CopilotTextGeneration.ts`. Note Copilot uses a `codexFallback` delegate.

- [ ] **Step 2: Write the failing test for CodexTextGeneration**

Append to `apps/server/src/textGeneration/CodexTextGeneration.test.ts` (mirror the existing `generateBranchName` test):

```ts
it("generateIssueContent (polish mode) returns title and body from the model", () =>
  Effect.gen(function* () {
    // Use whatever harness the existing tests use — likely a mocked Codex CLI
    // that returns a canned JSON payload. Mirror the generateBranchName test
    // and have the mock return: '{"title":"Bug X","body":"## Steps..."}'.
    const codex = makeFakeCodexCli(({ args }) => {
      expect(args.join(" ")).toContain("issue");
      return '{"title":"Polished title","body":"## Body"}';
    });
    const gen = makeCodexTextGeneration({ codex });
    const result = yield* gen.generateIssueContent({
      cwd: "/repo",
      mode: "polish",
      rough: "rough notes",
      modelSelection: testModelSelection,
    });
    expect(result).toEqual({ title: "Polished title", body: "## Body" });
  }).pipe(Effect.runPromise));

it("generateIssueContent (title mode) returns title only", () =>
  Effect.gen(function* () {
    const codex = makeFakeCodexCli(() => '{"title":"From body"}');
    const gen = makeCodexTextGeneration({ codex });
    const result = yield* gen.generateIssueContent({
      cwd: "/repo",
      mode: "title",
      body: "Body content",
      modelSelection: testModelSelection,
    });
    expect(result).toEqual({ title: "From body" });
  }).pipe(Effect.runPromise));
```

(The helper names `makeFakeCodexCli` / `makeCodexTextGeneration` / `testModelSelection` should match the names used by the existing `generateBranchName` test in the same file — grep for them and reuse exactly.)

- [ ] **Step 3: Run to verify failure**

```bash
bun run test apps/server/src/textGeneration/CodexTextGeneration.test.ts
```

Expected: `generateIssueContent is not a function`.

- [ ] **Step 4: Implement `generateIssueContent` in CodexTextGeneration.ts**

Add a method that mirrors `generateBranchName` but calls the appropriate prompt builder:

```ts
generateIssueContent: (input) =>
  Effect.gen(function* () {
    const policy = yield* policyForCwd(input.cwd);
    const { prompt, outputSchema } =
      input.mode === "polish"
        ? buildIssueContentPolishPrompt({
            rough: input.rough ?? "",
            ...(input.currentTitle ? { currentTitle: input.currentTitle } : {}),
            policy,
          })
        : buildIssueContentTitlePrompt({
            body: input.body ?? "",
            policy,
          });
    const raw = yield* runCodex({ prompt, modelSelection: input.modelSelection });
    return yield* decodeJsonAgainstSchema(raw, outputSchema, "generateIssueContent");
  }),
```

(`policyForCwd`, `runCodex`, `decodeJsonAgainstSchema` are existing helpers — use whatever names appear near the existing `generateBranchName` implementation. Read the surrounding code and mirror it exactly.)

- [ ] **Step 5: Run the Codex test to verify it passes**

```bash
bun run test apps/server/src/textGeneration/CodexTextGeneration.test.ts
```

Expected: pass.

- [ ] **Step 6: Repeat steps 2–5 for Claude, OpenCode, and Cursor**

For each driver:

- Mirror the test pattern.
- Implement `generateIssueContent` by following the existing `generateBranchName` shape in that driver.
- Run the driver-specific test to verify.

- [ ] **Step 7: Wire Copilot via the codexFallback delegate**

In `apps/server/src/textGeneration/CopilotTextGeneration.ts`, locate the existing pattern:

```ts
generateBranchName: (input) =>
  codexFallback.generateBranchName(withGitFallbackSelection(input)),
```

Add the analogous:

```ts
generateIssueContent: (input) =>
  codexFallback.generateIssueContent(withGitFallbackSelection(input)),
```

(No new Copilot test needed — the existing pattern is unit-tested via the codex tests.)

- [ ] **Step 8: Run the full text-generation test suite**

```bash
bun run test apps/server/src/textGeneration/
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/textGeneration
git commit -m "Implement generateIssueContent in all TextGeneration drivers"
```

---

## Task 7: Extend `SourceControlProviderShape` and stub non-GitHub providers

**Files:**

- Modify: `apps/server/src/sourceControl/SourceControlProvider.ts`
- Modify: `apps/server/src/sourceControl/GitLabSourceControlProvider.ts`
- Modify: `apps/server/src/sourceControl/ForgejoSourceControlProvider.ts`
- Modify: `apps/server/src/sourceControl/BitbucketSourceControlProvider.ts`
- Modify: `apps/server/src/sourceControl/AzureDevOpsSourceControlProvider.ts`
- Test: each provider's test file

- [ ] **Step 1: Add the three new methods to `SourceControlProviderShape`**

In `apps/server/src/sourceControl/SourceControlProvider.ts`, append to the `SourceControlProviderShape` interface:

```ts
readonly createIssue: (input: {
  readonly cwd: string;
  readonly context?: SourceControlProviderContext;
  readonly title: string;
  readonly body: string;
  readonly labels?: ReadonlyArray<string>;
  readonly assignees?: ReadonlyArray<string>;
}) => Effect.Effect<SourceControlIssueSummary, SourceControlProviderError>;

readonly listLabels: (input: {
  readonly cwd: string;
  readonly context?: SourceControlProviderContext;
}) => Effect.Effect<ReadonlyArray<SourceControlLabel>, SourceControlProviderError>;

readonly listAssignees: (input: {
  readonly cwd: string;
  readonly context?: SourceControlProviderContext;
}) => Effect.Effect<ReadonlyArray<SourceControlAssigneeCandidate>, SourceControlProviderError>;
```

Update the imports at the top of the file to include `SourceControlAssigneeCandidate` and `SourceControlLabel` from `@ryco/contracts`.

- [ ] **Step 2: Run typecheck to find which providers now fail to compile**

```bash
bun typecheck
```

Expected: errors at every `SourceControlProviderShape` implementer.

- [ ] **Step 3: Write the failing stub test for one provider (GitLab)**

Append to `apps/server/src/sourceControl/GitLabSourceControlProvider.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { makeGitLabSourceControlProvider } from "./GitLabSourceControlProvider.ts";

describe("GitLabSourceControlProvider stubs (Phase 1 of issue creation)", () => {
  it("createIssue fails with 'Not implemented' SourceControlProviderError", () =>
    Effect.gen(function* () {
      const provider = makeGitLabSourceControlProvider(/* fake deps */);
      const result = yield* provider
        .createIssue({ cwd: "/repo", title: "x", body: "" })
        .pipe(Effect.flip);
      expect(result.operation).toBe("createIssue");
      expect(result.detail).toContain("Not implemented");
    }).pipe(Effect.runPromise));

  it("listLabels fails with 'Not implemented'", () =>
    Effect.gen(function* () {
      const provider = makeGitLabSourceControlProvider(/* fake deps */);
      const result = yield* provider.listLabels({ cwd: "/repo" }).pipe(Effect.flip);
      expect(result.detail).toContain("Not implemented");
    }).pipe(Effect.runPromise));

  it("listAssignees fails with 'Not implemented'", () =>
    Effect.gen(function* () {
      const provider = makeGitLabSourceControlProvider(/* fake deps */);
      const result = yield* provider.listAssignees({ cwd: "/repo" }).pipe(Effect.flip);
      expect(result.detail).toContain("Not implemented");
    }).pipe(Effect.runPromise));
});
```

(Use the existing factory name and fake-deps pattern from the test file — grep for the existing `makeGitLab…` or factory.)

- [ ] **Step 4: Run to verify failure**

```bash
bun run test apps/server/src/sourceControl/GitLabSourceControlProvider.test.ts
```

Expected: `createIssue is not a function`.

- [ ] **Step 5: Add the three stubs to `GitLabSourceControlProvider.ts`**

Inside the object returned by `makeGitLabSourceControlProvider`:

```ts
createIssue: () =>
  Effect.fail(
    new SourceControlProviderError({
      provider: "gitlab",
      operation: "createIssue",
      detail: "Not implemented in Phase 1",
    }),
  ),
listLabels: () =>
  Effect.fail(
    new SourceControlProviderError({
      provider: "gitlab",
      operation: "listLabels",
      detail: "Not implemented in Phase 1",
    }),
  ),
listAssignees: () =>
  Effect.fail(
    new SourceControlProviderError({
      provider: "gitlab",
      operation: "listAssignees",
      detail: "Not implemented in Phase 1",
    }),
  ),
```

- [ ] **Step 6: Run the GitLab test to verify it passes**

```bash
bun run test apps/server/src/sourceControl/GitLabSourceControlProvider.test.ts
```

Expected: pass.

- [ ] **Step 7: Repeat steps 3–6 for Forgejo, Bitbucket, and Azure DevOps**

Use the matching `provider` string in each `SourceControlProviderError` (`"forgejo"`, `"bitbucket"`, `"azure-devops"`).

- [ ] **Step 8: Run the full source-control test suite**

```bash
bun run test apps/server/src/sourceControl/
```

Expected: all pass except GitHub (which is implemented next).

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/sourceControl
git commit -m "Add createIssue/listLabels/listAssignees to SourceControlProviderShape (stubs for non-GitHub)"
```

---

## Task 8: GitHub CLI — `createIssue`, `listLabels`, `listAssignees`

**Files:**

- Create: `apps/server/src/sourceControl/gitHubIssueCreate.ts`
- Modify: `apps/server/src/sourceControl/GitHubCli.ts`
- Modify: `apps/server/src/sourceControl/GitHubSourceControlProvider.ts`
- Test: Create `apps/server/src/sourceControl/gitHubIssueCreate.test.ts`
- Test: `apps/server/src/sourceControl/GitHubSourceControlProvider.test.ts`

- [ ] **Step 1: Write failing argv builder tests**

Create `apps/server/src/sourceControl/gitHubIssueCreate.test.ts`:

```ts
import { buildGitHubIssueCreateArgv } from "./gitHubIssueCreate.ts";
import { describe, expect, it } from "vitest";

describe("buildGitHubIssueCreateArgv", () => {
  it("emits --title and --body-file", () => {
    expect(
      buildGitHubIssueCreateArgv({
        title: "Bug",
        bodyFile: "/tmp/body.md",
      }),
    ).toEqual(["issue", "create", "--title", "Bug", "--body-file", "/tmp/body.md"]);
  });

  it("emits one --label flag per label", () => {
    const argv = buildGitHubIssueCreateArgv({
      title: "Bug",
      bodyFile: "/tmp/b",
      labels: ["bug", "frontend"],
    });
    const labelFlags = argv.filter((a, i) => argv[i - 1] === "--label");
    expect(labelFlags).toEqual(["bug", "frontend"]);
  });

  it("omits --label entirely when labels is empty", () => {
    const argv = buildGitHubIssueCreateArgv({
      title: "Bug",
      bodyFile: "/tmp/b",
      labels: [],
    });
    expect(argv).not.toContain("--label");
  });

  it("emits one --assignee flag per assignee", () => {
    const argv = buildGitHubIssueCreateArgv({
      title: "Bug",
      bodyFile: "/tmp/b",
      assignees: ["alice", "bob"],
    });
    const assigneeFlags = argv.filter((a, i) => argv[i - 1] === "--assignee");
    expect(assigneeFlags).toEqual(["alice", "bob"]);
  });

  it("omits --assignee entirely when assignees is empty", () => {
    const argv = buildGitHubIssueCreateArgv({
      title: "Bug",
      bodyFile: "/tmp/b",
      assignees: [],
    });
    expect(argv).not.toContain("--assignee");
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
bun run test apps/server/src/sourceControl/gitHubIssueCreate.test.ts
```

Expected: import error — file does not exist.

- [ ] **Step 3: Create the argv builder + URL parser**

Create `apps/server/src/sourceControl/gitHubIssueCreate.ts`:

```ts
export interface GitHubIssueCreateArgs {
  readonly title: string;
  readonly bodyFile: string;
  readonly labels?: ReadonlyArray<string>;
  readonly assignees?: ReadonlyArray<string>;
}

export function buildGitHubIssueCreateArgv(args: GitHubIssueCreateArgs): ReadonlyArray<string> {
  const argv: string[] = ["issue", "create", "--title", args.title, "--body-file", args.bodyFile];
  for (const label of args.labels ?? []) {
    argv.push("--label", label);
  }
  for (const assignee of args.assignees ?? []) {
    argv.push("--assignee", assignee);
  }
  return argv;
}

const ISSUE_URL_RE = /\/issues\/(\d+)(?:[#?].*)?$/;

export interface ParsedIssueCreateOutput {
  readonly url: string;
  readonly number: number;
}

export function parseGitHubIssueCreateOutput(stdout: string): ParsedIssueCreateOutput | null {
  const url = stdout.trim().split(/\r?\n/).pop()?.trim();
  if (!url) return null;
  const match = ISSUE_URL_RE.exec(url);
  const number = match?.[1] ? Number.parseInt(match[1], 10) : NaN;
  if (!Number.isFinite(number)) return null;
  return { url, number };
}
```

- [ ] **Step 4: Add a test for `parseGitHubIssueCreateOutput`**

Append to the same test file:

```ts
import { parseGitHubIssueCreateOutput } from "./gitHubIssueCreate.ts";

describe("parseGitHubIssueCreateOutput", () => {
  it("extracts url and number from the last non-empty line", () => {
    const stdout = "Creating issue in owner/repo\nhttps://github.com/owner/repo/issues/42\n";
    expect(parseGitHubIssueCreateOutput(stdout)).toEqual({
      url: "https://github.com/owner/repo/issues/42",
      number: 42,
    });
  });

  it("returns null on unrecognized output", () => {
    expect(parseGitHubIssueCreateOutput("nope\n")).toBeNull();
  });
});
```

- [ ] **Step 5: Run to verify tests pass**

```bash
bun run test apps/server/src/sourceControl/gitHubIssueCreate.test.ts
```

Expected: all pass.

- [ ] **Step 6: Add `createIssue`, `listLabels`, `listAssignees` to `GitHubCli.ts`**

Open `apps/server/src/sourceControl/GitHubCli.ts`. Locate the `GitHubCli` shape and the layer. Add to the shape:

```ts
readonly createIssue: (input: {
  readonly cwd: string;
  readonly title: string;
  readonly bodyFile: string;
  readonly labels?: ReadonlyArray<string>;
  readonly assignees?: ReadonlyArray<string>;
}) => Effect.Effect<{ url: string; number: number }, GitHubCliError>;

readonly listLabels: (input: {
  readonly cwd: string;
}) => Effect.Effect<ReadonlyArray<GitHubLabel>, GitHubCliError>;

readonly listAssignees: (input: {
  readonly cwd: string;
}) => Effect.Effect<
  ReadonlyArray<{ login: string; name?: string | null; avatarUrl?: string | null }>,
  GitHubCliError
>;
```

Implement them in the layer:

```ts
createIssue: (input) =>
  execute({
    cwd: input.cwd,
    args: buildGitHubIssueCreateArgv({
      title: input.title,
      bodyFile: input.bodyFile,
      ...(input.labels ? { labels: input.labels } : {}),
      ...(input.assignees ? { assignees: input.assignees } : {}),
    }),
  }).pipe(
    Effect.flatMap((r) => {
      const parsed = parseGitHubIssueCreateOutput(r.stdout);
      return parsed
        ? Effect.succeed(parsed)
        : Effect.fail(
            new GitHubCliError({
              operation: "createIssue",
              detail: `Unrecognized 'gh issue create' output: ${r.stdout.slice(0, 200)}`,
            }),
          );
    }),
  ),

listLabels: (input) =>
  execute({
    cwd: input.cwd,
    args: ["label", "list", "--json", "name,color,description", "--limit", "100"],
  }).pipe(
    Effect.flatMap((r) =>
      decodeJsonResult(
        Schema.Array(
          Schema.Struct({
            name: Schema.String,
            color: Schema.optional(Schema.NullOr(Schema.String)),
            description: Schema.optional(Schema.NullOr(Schema.String)),
          }),
        ),
        r.stdout,
      ),
    ),
    Effect.mapError(
      (cause) =>
        new GitHubCliError({
          operation: "listLabels",
          detail: `Invalid label list output: ${formatSchemaError(cause)}`,
          cause,
        }),
    ),
    Effect.map((labels) =>
      labels.map((l) => ({
        name: l.name,
        ...(l.color ? { color: l.color } : {}),
        ...(l.description ? { description: l.description } : {}),
      })),
    ),
  ),

listAssignees: (input) =>
  execute({
    cwd: input.cwd,
    args: ["api", "repos/{owner}/{repo}/assignees", "--paginate"],
  }).pipe(
    Effect.flatMap((r) =>
      decodeJsonResult(
        Schema.Array(
          Schema.Struct({
            login: Schema.String,
            name: Schema.optional(Schema.NullOr(Schema.String)),
            avatar_url: Schema.optional(Schema.NullOr(Schema.String)),
          }),
        ),
        r.stdout,
      ),
    ),
    Effect.mapError(
      (cause) =>
        new GitHubCliError({
          operation: "listAssignees",
          detail: `Invalid assignees output: ${formatSchemaError(cause)}`,
          cause,
        }),
    ),
    Effect.map((users) =>
      users.map((u) => ({
        login: u.login,
        ...(u.name ? { name: u.name } : {}),
        ...(u.avatar_url ? { avatarUrl: u.avatar_url } : {}),
      })),
    ),
  ),
```

(`decodeJsonResult` and `formatSchemaError` already exist in this file — they are imported from `@ryco/shared/schemaJson`. Reuse the same imports.)

- [ ] **Step 7: Write the failing provider test**

Append to `apps/server/src/sourceControl/GitHubSourceControlProvider.test.ts`:

```ts
describe("GitHubSourceControlProvider.createIssue", () => {
  it("happy path: writes body to a temp file, invokes gh, returns issue summary", () =>
    Effect.gen(function* () {
      const cli = makeFakeGitHubCli({
        createIssue: ({ args }) => {
          // Verify argv shape — title before body-file, --label flags follow.
          expect(args.title).toBe("Bug");
          expect(args.labels).toEqual(["bug"]);
          return { url: "https://github.com/owner/repo/issues/42", number: 42 };
        },
        getIssue: () => ({/* fake decoded issue */}),
      });
      const provider = makeGitHubSourceControlProvider({ cli /* deps */ });
      const summary = yield* provider.createIssue({
        cwd: "/repo",
        title: "Bug",
        body: "## Body",
        labels: ["bug"],
      });
      expect(summary.number).toBe(42);
      expect(summary.url).toBe("https://github.com/owner/repo/issues/42");
    }).pipe(Effect.runPromise));

  it("propagates GitHubCliError as SourceControlProviderError", () =>
    Effect.gen(function* () {
      const cli = makeFakeGitHubCli({
        createIssue: () => {
          throw new GitHubCliError({ operation: "createIssue", detail: "auth failed" });
        },
      });
      const provider = makeGitHubSourceControlProvider({ cli });
      const result = yield* provider
        .createIssue({ cwd: "/repo", title: "x", body: "" })
        .pipe(Effect.flip);
      expect(result.operation).toBe("createIssue");
      expect(result.detail).toContain("auth failed");
    }).pipe(Effect.runPromise));
});
```

(Mirror the existing `createPullRequest` test in the same file for the temp-file body handling.)

- [ ] **Step 8: Run to verify failure**

```bash
bun run test apps/server/src/sourceControl/GitHubSourceControlProvider.test.ts
```

Expected: `createIssue is not a function`.

- [ ] **Step 9: Implement `createIssue`, `listLabels`, `listAssignees` in the provider**

In `apps/server/src/sourceControl/GitHubSourceControlProvider.ts`, locate the existing `createChangeRequest` implementation. Mirror its temp-file-for-body pattern (it uses `FileSystem.Effect.makeTempFileScoped` or similar — read the exact helper). Add:

```ts
createIssue: (input) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem; // mirror createChangeRequest exactly
    const bodyFile = yield* fs.makeTempFile({ suffix: ".md" });
    yield* fs.writeFileString(bodyFile, input.body);
    const created = yield* cli.createIssue({
      cwd: input.cwd,
      title: input.title,
      bodyFile,
      ...(input.labels ? { labels: input.labels } : {}),
      ...(input.assignees ? { assignees: input.assignees } : {}),
    });
    // Reuse existing getIssue path to return a SourceControlIssueSummary.
    return yield* getIssueAsSummary(input.cwd, String(created.number));
  }).pipe(
    Effect.mapError((cause) =>
      cause._tag === "SourceControlProviderError"
        ? cause
        : new SourceControlProviderError({
            provider: "github",
            operation: "createIssue",
            detail: cause.message ?? "Unknown failure",
            cause,
          }),
    ),
  ),

listLabels: (input) =>
  cli
    .listLabels({ cwd: input.cwd })
    .pipe(
      Effect.mapError(
        (cause) =>
          new SourceControlProviderError({
            provider: "github",
            operation: "listLabels",
            detail: cause.detail ?? cause.message ?? "Unknown failure",
            cause,
          }),
      ),
    ),

listAssignees: (input) =>
  cli.listAssignees({ cwd: input.cwd }).pipe(
    Effect.map((users) =>
      users.map((u) => ({
        login: u.login,
        ...(u.name ? { displayName: u.name } : {}),
        ...(u.avatarUrl ? { avatarUrl: u.avatarUrl } : {}),
      })),
    ),
    Effect.mapError(
      (cause) =>
        new SourceControlProviderError({
          provider: "github",
          operation: "listAssignees",
          detail: cause.detail ?? cause.message ?? "Unknown failure",
          cause,
        }),
    ),
  ),
```

(`getIssueAsSummary` should reuse the existing `getIssue` path. Read the surrounding code — if no helper exists, factor one inline by calling the existing `getIssue` method on the provider and projecting to the summary fields.)

- [ ] **Step 10: Run all GitHub provider tests**

```bash
bun run test apps/server/src/sourceControl/GitHubSourceControlProvider.test.ts
```

Expected: pass.

- [ ] **Step 11: Commit**

```bash
git add apps/server/src/sourceControl
git commit -m "Implement GitHub createIssue, listLabels, listAssignees"
```

---

## Task 9: Extend `git.createWorktreeForProject` to honor `branchName` for issue intent

**Files:**

- Modify: `apps/server/src/git/GitManager.ts`
- Test: `apps/server/src/git/GitManager.test.ts`

- [ ] **Step 1: Locate the issue-intent branch resolution**

In `apps/server/src/git/GitManager.ts`, grep for `kind === "issue"` (or the equivalent pattern-match). The current code derives a branch name from the issue (probably uses `gh issue view` or builds a slug from title). The change: if `intent.branchName` is present, use it directly without calling the slug builder.

- [ ] **Step 2: Write the failing test**

Append to `apps/server/src/git/GitManager.test.ts`:

```ts
describe("createWorktreeForProject with issue intent + branchName override", () => {
  it("uses the provided branchName instead of generating one from the issue title", () =>
    Effect.gen(function* () {
      const manager = makeManager(/* fake deps that record git operations */);
      const result = yield* manager.createWorktreeForProject({
        projectId: testProjectId,
        intent: { kind: "issue", number: 42, branchName: "custom/branch" },
      });
      // Assert that the worktree was created with branch "custom/branch".
      expect(recordedBranchName()).toBe("custom/branch");
    }).pipe(Effect.runPromise));

  it("falls back to default behavior when branchName is omitted", () =>
    Effect.gen(function* () {
      const manager = makeManager(/* fake deps */);
      yield* manager.createWorktreeForProject({
        projectId: testProjectId,
        intent: { kind: "issue", number: 42 },
      });
      expect(recordedBranchName()).not.toBe("custom/branch");
      // Existing default — derived from issue title — applies.
    }).pipe(Effect.runPromise));
});
```

(Use the existing test helpers in this file. Grep for the existing PR-intent test for the right harness.)

- [ ] **Step 3: Run to verify failure**

```bash
bun run test apps/server/src/git/GitManager.test.ts
```

Expected: first test fails because `branchName` is not honored.

- [ ] **Step 4: Implement**

Find the issue-intent branch:

```ts
// before:
case "issue": {
  const branchName = deriveBranchNameFromIssue(/* ... */);
  // ...
}

// after:
case "issue": {
  const branchName = intent.branchName ?? deriveBranchNameFromIssue(/* ... */);
  // ...
}
```

(Method names will vary; use the actual ones in your codebase.)

- [ ] **Step 5: Run tests**

```bash
bun run test apps/server/src/git/GitManager.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/git
git commit -m "Honor branchName override on issue-intent worktree creation"
```

---

## Task 10: Add RPC methods to contracts (`packages/contracts/src/rpc.ts`)

**Files:**

- Modify: `packages/contracts/src/rpc.ts`

- [ ] **Step 1: Add the method-name constants**

In `WS_METHODS`, append within the source-control block:

```ts
sourceControlCreateIssue: "sourceControl.createIssue",
sourceControlListIssueLabels: "sourceControl.listIssueLabels",
sourceControlListIssueAssignees: "sourceControl.listIssueAssignees",
```

Add a new block for text-generation methods (these are the first):

```ts
// Text generation methods
textGenerationGenerateIssueContent: "textGeneration.generateIssueContent",
textGenerationGenerateBranchName: "textGeneration.generateBranchName",
```

- [ ] **Step 2: Update imports at the top of the file**

```ts
import {
  // ... existing
  SourceControlAssigneeCandidate,
  SourceControlCreateIssueInput,
  SourceControlCreateIssueResult,
  SourceControlLabel,
} from "./sourceControl.ts";
```

- [ ] **Step 3: Declare the merged `SourceControlCreateIssueResultWithWorktree` schema**

Recall from Task 1 that `SourceControlCreateIssueResult` in `sourceControl.ts` does not include the worktree output (because the worktree types live in `rpc.ts`). Declare the merged result here:

```ts
export const SourceControlCreateIssueWithWorktreeResult = Schema.Struct({
  issue: SourceControlIssueSummary,
  worktree: Schema.optional(GitCreateWorktreeForProjectOutput),
  worktreeError: Schema.optional(Schema.String),
});
export type SourceControlCreateIssueWithWorktreeResult =
  typeof SourceControlCreateIssueWithWorktreeResult.Type;
```

- [ ] **Step 4: Add the `Rpc.make(...)` declarations**

Append after the existing source-control RPCs:

```ts
export const WsSourceControlCreateIssueRpc = Rpc.make(WS_METHODS.sourceControlCreateIssue, {
  payload: SourceControlCreateIssueInput,
  success: SourceControlCreateIssueWithWorktreeResult,
  error: Schema.Union([SourceControlProviderError, AuthRpcError, GitManagerServiceError]),
});

export const WsSourceControlListIssueLabelsRpc = Rpc.make(WS_METHODS.sourceControlListIssueLabels, {
  payload: Schema.Struct({ cwd: Schema.String }),
  success: Schema.Array(SourceControlLabel),
  error: Schema.Union([SourceControlProviderError, AuthRpcError]),
});

export const WsSourceControlListIssueAssigneesRpc = Rpc.make(
  WS_METHODS.sourceControlListIssueAssignees,
  {
    payload: Schema.Struct({ cwd: Schema.String }),
    success: Schema.Array(SourceControlAssigneeCandidate),
    error: Schema.Union([SourceControlProviderError, AuthRpcError]),
  },
);

export const TextGenerationIssueContentMode = Schema.Literals(["polish", "title"]);
export type TextGenerationIssueContentMode = typeof TextGenerationIssueContentMode.Type;

export const TextGenerationIssueContentInput = Schema.Struct({
  cwd: Schema.String,
  mode: TextGenerationIssueContentMode,
  rough: Schema.optional(Schema.String),
  body: Schema.optional(Schema.String),
  currentTitle: Schema.optional(Schema.String),
});

export const TextGenerationIssueContentResult = Schema.Struct({
  title: Schema.optional(Schema.String),
  body: Schema.optional(Schema.String),
});

export const TextGenerationBranchNameInput = Schema.Struct({
  cwd: Schema.String,
  message: Schema.String,
});

export const TextGenerationBranchNameResult = Schema.Struct({
  branch: Schema.String,
});

export const WsTextGenerationGenerateIssueContentRpc = Rpc.make(
  WS_METHODS.textGenerationGenerateIssueContent,
  {
    payload: TextGenerationIssueContentInput,
    success: TextGenerationIssueContentResult,
    error: AuthRpcError, // TextGenerationError will be added; for now passthrough
  },
);

export const WsTextGenerationGenerateBranchNameRpc = Rpc.make(
  WS_METHODS.textGenerationGenerateBranchName,
  {
    payload: TextGenerationBranchNameInput,
    success: TextGenerationBranchNameResult,
    error: AuthRpcError,
  },
);
```

Note on error union: locate `TextGenerationError` in the contracts (`packages/contracts/src/textGeneration.ts` if it exists, or in `provider.ts`). If exported, replace `AuthRpcError` with `Schema.Union([TextGenerationError, AuthRpcError])`. If not exported, leave as `AuthRpcError` and handle text-gen errors as RPC failures in the server handler.

- [ ] **Step 5: Add the five new RPC handlers to the exported group**

Locate the `WsRpcGroup` (or equivalent `RpcGroup.make([...])` at the bottom of `rpc.ts`) and add the five new RPCs to the array.

- [ ] **Step 6: Run typecheck**

```bash
bun typecheck
```

Expected: clean (or surfaces work in Task 11 for the server handler).

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/rpc.ts
git commit -m "Declare RPC contracts for createIssue, listIssueLabels, listIssueAssignees, generateIssueContent, generateBranchName"
```

---

## Task 11: Route the five new RPC methods server-side

**Files:**

- Modify: `apps/server/src/ws.ts` (or wherever RPC handlers are registered — search for `sourceControl.listIssues` to find the routing block)
- Test: existing `ws.ts` test file or a new one

- [ ] **Step 1: Locate the existing source-control handler**

```bash
rg -n "sourceControlListIssues|sourceControl\\.listIssues" apps/server/src packages/contracts/src
```

Grep the server source for `sourceControlListIssues` to find where existing handlers are wired up.

- [ ] **Step 2: Write a failing routing test (smoke-level)**

In whichever file currently tests RPC routing, add:

```ts
describe("sourceControl.createIssue RPC", () => {
  it("invokes the provider and includes worktree output when worktree.enabled", () =>
    Effect.gen(function* () {
      const harness = makeServerTestHarness({
        provider: { createIssue: () => Effect.succeed(fakeIssueSummary) },
        git: { createWorktreeForProject: () => Effect.succeed(fakeWorktreeOutput) },
      });
      const result = yield* harness.rpc.sourceControl.createIssue({
        cwd: "/repo",
        title: "Bug",
        body: "",
        worktree: { enabled: true, branchName: "fix/x" },
      });
      expect(result.issue).toEqual(fakeIssueSummary);
      expect(result.worktree).toEqual(fakeWorktreeOutput);
    }).pipe(Effect.runPromise));

  it("returns worktreeError when worktree creation fails", () =>
    Effect.gen(function* () {
      const harness = makeServerTestHarness({
        provider: { createIssue: () => Effect.succeed(fakeIssueSummary) },
        git: {
          createWorktreeForProject: () => Effect.fail(new GitManagerServiceError({/* … */})),
        },
      });
      const result = yield* harness.rpc.sourceControl.createIssue({
        cwd: "/repo",
        title: "Bug",
        body: "",
        worktree: { enabled: true, branchName: "fix/x" },
      });
      expect(result.issue).toEqual(fakeIssueSummary);
      expect(result.worktree).toBeUndefined();
      expect(result.worktreeError).toContain(/* something from the error */);
    }).pipe(Effect.runPromise));
});
```

(Adapt to the actual harness in your codebase. If no harness exists, mock directly via the provider/git services in the Effect runtime.)

- [ ] **Step 3: Run to verify failure**

```bash
bun run test apps/server/src/ws.test.ts
```

Expected: `sourceControl.createIssue is not a registered method`.

- [ ] **Step 4: Wire `createIssue` handler**

```ts
WsSourceControlCreateIssueRpc.toHandler(({ payload }) =>
  Effect.gen(function* () {
    const provider = yield* resolveProviderForCwd(payload.cwd);
    const issue = yield* provider.createIssue({
      cwd: payload.cwd,
      title: payload.title,
      body: payload.body,
      ...(payload.labels ? { labels: payload.labels } : {}),
      ...(payload.assignees ? { assignees: payload.assignees } : {}),
    });

    if (!payload.worktree?.enabled) {
      return { issue };
    }

    const projectId = yield* resolveProjectIdForCwd(payload.cwd);
    const worktreeResult = yield* git
      .createWorktreeForProject({
        projectId,
        intent: { kind: "issue", number: issue.number, branchName: payload.worktree.branchName },
      })
      .pipe(
        Effect.either, // tolerate partial failure — issue stays
      );

    return worktreeResult._tag === "Right"
      ? { issue, worktree: worktreeResult.right }
      : { issue, worktreeError: formatError(worktreeResult.left) };
  }),
);
```

(`resolveProviderForCwd`, `resolveProjectIdForCwd`, and `git` are existing helpers in this file — read the surrounding code and reuse the exact names. `formatError` may be a small inline helper if none exists.)

- [ ] **Step 5: Wire the other four handlers**

`listIssueLabels` and `listIssueAssignees`: thin wrappers around `provider.listLabels` and `provider.listAssignees`.

`generateBranchName`: thin wrapper around `textGeneration.generateBranchName`, resolving `modelSelection` from server settings:

```ts
WsTextGenerationGenerateBranchNameRpc.toHandler(({ payload }) =>
  Effect.gen(function* () {
    const settings = yield* serverSettingsService.getSettings;
    const { branch } = yield* textGeneration.generateBranchName({
      cwd: payload.cwd,
      message: payload.message,
      modelSelection: settings.textGenerationModelSelection,
    });
    return { branch };
  }),
);
```

`generateIssueContent`: same pattern, `mode` determines the dispatch.

- [ ] **Step 6: Run tests**

```bash
bun run test apps/server/src/ws.test.ts
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/ws.ts apps/server/src
git commit -m "Route createIssue, listIssueLabels, listIssueAssignees, generateIssueContent, generateBranchName RPCs"
```

---

## Task 12: Web RPC client — `issueCreationRpc.ts`

**Files:**

- Create: `apps/web/src/lib/issueCreationRpc.ts`
- Test: `apps/web/src/lib/issueCreationRpc.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/issueCreationRpc.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  buildIssueLabelsQueryOptions,
  buildIssueAssigneesQueryOptions,
} from "./issueCreationRpc.ts";

describe("issueCreationRpc query keys", () => {
  it("issue labels key includes environmentId + cwd", () => {
    const options = buildIssueLabelsQueryOptions({
      environmentId: "env-1" as never,
      cwd: "/repo",
    });
    expect(options.queryKey).toEqual(["sourceControl", "issueLabels", "env-1", "/repo"]);
  });

  it("issue assignees key includes environmentId + cwd", () => {
    const options = buildIssueAssigneesQueryOptions({
      environmentId: "env-1" as never,
      cwd: "/repo",
    });
    expect(options.queryKey).toEqual(["sourceControl", "issueAssignees", "env-1", "/repo"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
bun run test apps/web/src/lib/issueCreationRpc.test.ts
```

Expected: file not found.

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/issueCreationRpc.ts`:

```ts
import type {
  EnvironmentId,
  SourceControlAssigneeCandidate,
  SourceControlCreateIssueInput,
  SourceControlIssueSummary,
  SourceControlLabel,
} from "@ryco/contracts";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { requireEnvironmentConnection } from "~/environments/runtime";
import { sourceControlContextQueryKeys } from "./sourceControlContextRpc.ts";

export const issueCreationQueryKeys = {
  labels: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["sourceControl", "issueLabels", environmentId ?? null, cwd] as const,
  assignees: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["sourceControl", "issueAssignees", environmentId ?? null, cwd] as const,
};

export function buildIssueLabelsQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
}) {
  return queryOptions({
    queryKey: issueCreationQueryKeys.labels(input.environmentId, input.cwd),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId) {
        throw new Error("Issue labels are unavailable.");
      }
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.sourceControl.listIssueLabels({ cwd: input.cwd });
    },
    enabled: input.environmentId !== null && input.cwd !== null,
    staleTime: 5 * 60_000,
  });
}

export function buildIssueAssigneesQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
}) {
  return queryOptions({
    queryKey: issueCreationQueryKeys.assignees(input.environmentId, input.cwd),
    queryFn: async () => {
      if (!input.cwd || !input.environmentId) {
        throw new Error("Issue assignees are unavailable.");
      }
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.sourceControl.listIssueAssignees({ cwd: input.cwd });
    },
    enabled: input.environmentId !== null && input.cwd !== null,
    staleTime: 5 * 60_000,
  });
}

export function useCreateIssueMutation(input: { environmentId: EnvironmentId }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SourceControlCreateIssueInput) => {
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.sourceControl.createIssue(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: sourceControlContextQueryKeys.all,
      });
    },
  });
}

export function useGenerateIssueContentMutation(input: { environmentId: EnvironmentId }) {
  return useMutation({
    mutationFn: (payload: {
      cwd: string;
      mode: "polish" | "title";
      rough?: string;
      body?: string;
      currentTitle?: string;
    }) => {
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.textGeneration.generateIssueContent(payload);
    },
  });
}

export function useGenerateBranchNameMutation(input: { environmentId: EnvironmentId }) {
  return useMutation({
    mutationFn: (payload: { cwd: string; message: string }) => {
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.textGeneration.generateBranchName(payload);
    },
  });
}
```

- [ ] **Step 4: Run tests**

```bash
bun run test apps/web/src/lib/issueCreationRpc.test.ts
```

Expected: pass.

- [ ] **Step 5: Run typecheck**

```bash
bun typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/issueCreationRpc.ts apps/web/src/lib/issueCreationRpc.test.ts
git commit -m "Add issueCreationRpc query/mutation hooks"
```

---

## Task 13: Web component — `IssueLabelPicker` and `IssueAssigneePicker`

**Files:**

- Create: `apps/web/src/components/issues/IssueLabelPicker.tsx`
- Create: `apps/web/src/components/issues/IssueAssigneePicker.tsx`

These are simple chip-style multi-select pickers backed by a popover. They don't need their own unit tests — they're exercised by the `NewIssueDialog` browser tests in Task 15.

- [ ] **Step 1: Implement `IssueLabelPicker.tsx`**

```tsx
import type { SourceControlLabel } from "@ryco/contracts";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Input } from "../ui/input";

interface IssueLabelPickerProps {
  available: ReadonlyArray<SourceControlLabel>;
  selected: ReadonlyArray<string>;
  onChange: (next: ReadonlyArray<string>) => void;
}

export function IssueLabelPicker(props: IssueLabelPickerProps) {
  const [query, setQuery] = useState("");
  const visible = props.available.filter((l) => l.name.toLowerCase().includes(query.toLowerCase()));
  const toggle = (name: string) => {
    const has = props.selected.includes(name);
    props.onChange(has ? props.selected.filter((n) => n !== name) : [...props.selected, name]);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {props.selected.map((name) => {
        const label = props.available.find((l) => l.name === name);
        return (
          <button
            key={name}
            type="button"
            onClick={() => toggle(name)}
            className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs"
            style={label?.color ? { borderColor: `#${label.color}` } : undefined}
          >
            {name}
          </button>
        );
      })}
      <Popover>
        <PopoverTrigger className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground">
          + add label
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter labels…"
            className="m-2 h-8 text-sm"
          />
          <div className="max-h-60 overflow-y-auto">
            {visible.map((label) => (
              <button
                key={label.name}
                type="button"
                onClick={() => toggle(label.name)}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-muted/60 ${
                  props.selected.includes(label.name) ? "bg-muted/80" : ""
                }`}
              >
                <span>{label.name}</span>
                {props.selected.includes(label.name) ? <span className="text-xs">✓</span> : null}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
```

- [ ] **Step 2: Implement `IssueAssigneePicker.tsx`** (same shape, `SourceControlAssigneeCandidate` instead of `SourceControlLabel`)

```tsx
import type { SourceControlAssigneeCandidate } from "@ryco/contracts";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Input } from "../ui/input";

interface IssueAssigneePickerProps {
  available: ReadonlyArray<SourceControlAssigneeCandidate>;
  selected: ReadonlyArray<string>;
  onChange: (next: ReadonlyArray<string>) => void;
}

export function IssueAssigneePicker(props: IssueAssigneePickerProps) {
  const [query, setQuery] = useState("");
  const visible = props.available.filter((a) =>
    a.login.toLowerCase().includes(query.toLowerCase()),
  );
  const toggle = (login: string) => {
    const has = props.selected.includes(login);
    props.onChange(has ? props.selected.filter((l) => l !== login) : [...props.selected, login]);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {props.selected.map((login) => (
        <button
          key={login}
          type="button"
          onClick={() => toggle(login)}
          className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs"
        >
          @{login}
        </button>
      ))}
      <Popover>
        <PopoverTrigger className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground">
          + assign
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter people…"
            className="m-2 h-8 text-sm"
          />
          <div className="max-h-60 overflow-y-auto">
            {visible.map((a) => (
              <button
                key={a.login}
                type="button"
                onClick={() => toggle(a.login)}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-muted/60 ${
                  props.selected.includes(a.login) ? "bg-muted/80" : ""
                }`}
              >
                <span>
                  @{a.login}{" "}
                  {a.displayName ? (
                    <span className="text-muted-foreground">— {a.displayName}</span>
                  ) : null}
                </span>
                {props.selected.includes(a.login) ? <span className="text-xs">✓</span> : null}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
```

- [ ] **Step 3: Run lint and typecheck**

```bash
bun lint && bun typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/issues
git commit -m "Add IssueLabelPicker and IssueAssigneePicker components"
```

---

## Task 14: Web component — `NewIssueDialog` reducer and view

**Files:**

- Create: `apps/web/src/components/issues/NewIssueDialog.tsx`
- Create: `apps/web/src/components/issues/newIssueDialogReducer.ts`
- Test: `apps/web/src/components/issues/newIssueDialogReducer.test.ts`

- [ ] **Step 1: Write the failing reducer tests**

Create `apps/web/src/components/issues/newIssueDialogReducer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { initialNewIssueState, newIssueDialogReducer } from "./newIssueDialogReducer.ts";

describe("newIssueDialogReducer", () => {
  it("starts with empty fields and worktree enabled", () => {
    expect(initialNewIssueState).toMatchObject({
      title: "",
      body: "",
      labels: [],
      assignees: [],
      worktreeEnabled: true,
      worktreeBranchName: null,
    });
  });

  it("setTitle / setBody / toggleLabel", () => {
    let s = initialNewIssueState;
    s = newIssueDialogReducer(s, { type: "setTitle", value: "Bug" });
    s = newIssueDialogReducer(s, { type: "setBody", value: "## Body" });
    s = newIssueDialogReducer(s, { type: "toggleLabel", name: "bug" });
    s = newIssueDialogReducer(s, { type: "toggleLabel", name: "bug" }); // off
    s = newIssueDialogReducer(s, { type: "toggleLabel", name: "frontend" });
    expect(s.title).toBe("Bug");
    expect(s.body).toBe("## Body");
    expect(s.labels).toEqual(["frontend"]);
  });

  it("aiPolishStarted/Succeeded/Failed transitions", () => {
    let s = initialNewIssueState;
    s = newIssueDialogReducer(s, { type: "aiPolishStarted" });
    expect(s.ai.polishStatus).toBe("running");
    s = newIssueDialogReducer(s, {
      type: "aiPolishSucceeded",
      result: { title: "Polished", body: "Body" },
    });
    expect(s.ai.polishStatus).toBe("idle");
    expect(s.title).toBe("Polished");
    expect(s.body).toBe("Body");
  });

  it("does not overwrite existing title on aiPolishSucceeded", () => {
    let s = newIssueDialogReducer(initialNewIssueState, {
      type: "setTitle",
      value: "User wrote this",
    });
    s = newIssueDialogReducer(s, { type: "aiPolishStarted" });
    s = newIssueDialogReducer(s, {
      type: "aiPolishSucceeded",
      result: { title: "AI title", body: "Body" },
    });
    expect(s.title).toBe("User wrote this");
    expect(s.body).toBe("Body");
  });

  it("submit is disabled when any AI op is running or title is empty", () => {
    expect(canSubmit(initialNewIssueState)).toBe(false);
    let s = newIssueDialogReducer(initialNewIssueState, { type: "setTitle", value: "Bug" });
    expect(canSubmit(s)).toBe(false); // worktreeEnabled and worktreeBranchName is null
    s = newIssueDialogReducer(s, { type: "branchGenerated", branch: "fix/bug" });
    expect(canSubmit(s)).toBe(true);
    s = newIssueDialogReducer(s, { type: "aiPolishStarted" });
    expect(canSubmit(s)).toBe(false);
  });
});

// helper imported from the same module under test
import { canSubmit } from "./newIssueDialogReducer.ts";
```

- [ ] **Step 2: Run to verify failure**

```bash
bun run test apps/web/src/components/issues/newIssueDialogReducer.test.ts
```

Expected: import errors.

- [ ] **Step 3: Implement the reducer**

Create `apps/web/src/components/issues/newIssueDialogReducer.ts`:

```ts
export interface NewIssueState {
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
  worktreeEnabled: boolean;
  worktreeBranchName: string | null;
  ai: {
    polishStatus: "idle" | "running" | "error";
    titleStatus: "idle" | "running" | "error";
    branchStatus: "idle" | "running" | "error";
    lastError: string | null;
  };
  submitStatus: "idle" | "submitting" | "error";
  submitError: string | null;
}

export const initialNewIssueState: NewIssueState = {
  title: "",
  body: "",
  labels: [],
  assignees: [],
  worktreeEnabled: true,
  worktreeBranchName: null,
  ai: {
    polishStatus: "idle",
    titleStatus: "idle",
    branchStatus: "idle",
    lastError: null,
  },
  submitStatus: "idle",
  submitError: null,
};

export type NewIssueAction =
  | { type: "setTitle"; value: string }
  | { type: "setBody"; value: string }
  | { type: "toggleLabel"; name: string }
  | { type: "toggleAssignee"; login: string }
  | { type: "setLabels"; labels: ReadonlyArray<string> }
  | { type: "setAssignees"; assignees: ReadonlyArray<string> }
  | { type: "setWorktreeEnabled"; value: boolean }
  | { type: "setWorktreeBranchName"; value: string }
  | { type: "branchGenerated"; branch: string }
  | { type: "aiPolishStarted" }
  | {
      type: "aiPolishSucceeded";
      result: { title?: string; body?: string };
    }
  | { type: "aiPolishFailed"; error: string }
  | { type: "aiTitleStarted" }
  | { type: "aiTitleSucceeded"; result: { title?: string } }
  | { type: "aiTitleFailed"; error: string }
  | { type: "aiBranchStarted" }
  | { type: "aiBranchFailed"; error: string }
  | { type: "submitStarted" }
  | { type: "submitFailed"; error: string };

export function newIssueDialogReducer(state: NewIssueState, action: NewIssueAction): NewIssueState {
  switch (action.type) {
    case "setTitle":
      return { ...state, title: action.value };
    case "setBody":
      return { ...state, body: action.value };
    case "toggleLabel": {
      const has = state.labels.includes(action.name);
      return {
        ...state,
        labels: has
          ? state.labels.filter((n) => n !== action.name)
          : [...state.labels, action.name],
      };
    }
    case "toggleAssignee": {
      const has = state.assignees.includes(action.login);
      return {
        ...state,
        assignees: has
          ? state.assignees.filter((l) => l !== action.login)
          : [...state.assignees, action.login],
      };
    }
    case "setLabels":
      return { ...state, labels: [...action.labels] };
    case "setAssignees":
      return { ...state, assignees: [...action.assignees] };
    case "setWorktreeEnabled":
      return { ...state, worktreeEnabled: action.value };
    case "setWorktreeBranchName":
      return { ...state, worktreeBranchName: action.value };
    case "branchGenerated":
      return {
        ...state,
        worktreeBranchName: action.branch,
        ai: { ...state.ai, branchStatus: "idle" },
      };
    case "aiPolishStarted":
      return { ...state, ai: { ...state.ai, polishStatus: "running", lastError: null } };
    case "aiPolishSucceeded":
      return {
        ...state,
        title: state.title === "" && action.result.title ? action.result.title : state.title,
        body: action.result.body ?? state.body,
        ai: { ...state.ai, polishStatus: "idle" },
      };
    case "aiPolishFailed":
      return {
        ...state,
        ai: { ...state.ai, polishStatus: "error", lastError: action.error },
      };
    case "aiTitleStarted":
      return { ...state, ai: { ...state.ai, titleStatus: "running" } };
    case "aiTitleSucceeded":
      return {
        ...state,
        title: action.result.title ?? state.title,
        ai: { ...state.ai, titleStatus: "idle" },
      };
    case "aiTitleFailed":
      return {
        ...state,
        ai: { ...state.ai, titleStatus: "error", lastError: action.error },
      };
    case "aiBranchStarted":
      return { ...state, ai: { ...state.ai, branchStatus: "running" } };
    case "aiBranchFailed":
      return {
        ...state,
        ai: { ...state.ai, branchStatus: "error", lastError: action.error },
      };
    case "submitStarted":
      return { ...state, submitStatus: "submitting", submitError: null };
    case "submitFailed":
      return { ...state, submitStatus: "error", submitError: action.error };
    default:
      return state;
  }
}

export function canSubmit(state: NewIssueState): boolean {
  if (state.title.trim() === "") return false;
  if (state.submitStatus === "submitting") return false;
  if (
    state.ai.polishStatus === "running" ||
    state.ai.titleStatus === "running" ||
    state.ai.branchStatus === "running"
  )
    return false;
  if (state.worktreeEnabled && state.worktreeBranchName === null) return false;
  return true;
}
```

- [ ] **Step 4: Run reducer tests**

```bash
bun run test apps/web/src/components/issues/newIssueDialogReducer.test.ts
```

Expected: all pass.

- [ ] **Step 5: Implement the dialog view**

Create `apps/web/src/components/issues/NewIssueDialog.tsx`:

```tsx
import type { EnvironmentId } from "@ryco/contracts";
import { useEffect, useReducer } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogPanel,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import {
  buildIssueAssigneesQueryOptions,
  buildIssueLabelsQueryOptions,
  useCreateIssueMutation,
  useGenerateBranchNameMutation,
  useGenerateIssueContentMutation,
} from "~/lib/issueCreationRpc.ts";
import { useResolvedProviderKind } from "~/lib/sourceControlDiscoveryState";
import { IssueLabelPicker } from "./IssueLabelPicker";
import { IssueAssigneePicker } from "./IssueAssigneePicker";
import { canSubmit, initialNewIssueState, newIssueDialogReducer } from "./newIssueDialogReducer";

export interface NewIssueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  environmentId: EnvironmentId;
  cwd: string;
  onCreated?: (issueNumber: number) => void;
}

export function NewIssueDialog(props: NewIssueDialogProps) {
  const [state, dispatch] = useReducer(newIssueDialogReducer, initialNewIssueState);

  const labelsQuery = useQuery(
    buildIssueLabelsQueryOptions({ environmentId: props.environmentId, cwd: props.cwd }),
  );
  const assigneesQuery = useQuery(
    buildIssueAssigneesQueryOptions({ environmentId: props.environmentId, cwd: props.cwd }),
  );

  const polish = useGenerateIssueContentMutation({ environmentId: props.environmentId });
  const branchGen = useGenerateBranchNameMutation({ environmentId: props.environmentId });
  const createIssue = useCreateIssueMutation({ environmentId: props.environmentId });

  // Auto-trigger branch name generation when body crosses 10 chars and worktree is on
  useEffect(() => {
    if (!state.worktreeEnabled) return;
    if (state.worktreeBranchName !== null) return;
    if (state.body.trim().length < 10) return;
    if (state.ai.branchStatus === "running") return;
    dispatch({ type: "aiBranchStarted" });
    branchGen
      .mutateAsync({ cwd: props.cwd, message: `${state.title}\n\n${state.body}` })
      .then((r) => dispatch({ type: "branchGenerated", branch: r.branch }))
      .catch((e: unknown) =>
        dispatch({ type: "aiBranchFailed", error: e instanceof Error ? e.message : "Failed" }),
      );
  }, [
    state.worktreeEnabled,
    state.worktreeBranchName,
    state.body,
    state.title,
    state.ai.branchStatus,
    props.cwd,
    branchGen,
  ]);

  const onPolish = async () => {
    dispatch({ type: "aiPolishStarted" });
    try {
      const r = await polish.mutateAsync({
        cwd: props.cwd,
        mode: "polish",
        rough: state.body,
        ...(state.title ? { currentTitle: state.title } : {}),
      });
      dispatch({ type: "aiPolishSucceeded", result: r });
    } catch (e) {
      dispatch({ type: "aiPolishFailed", error: e instanceof Error ? e.message : "Failed" });
    }
  };

  const onSuggestTitle = async () => {
    dispatch({ type: "aiTitleStarted" });
    try {
      const r = await polish.mutateAsync({
        cwd: props.cwd,
        mode: "title",
        body: state.body,
      });
      dispatch({ type: "aiTitleSucceeded", result: r });
    } catch (e) {
      dispatch({ type: "aiTitleFailed", error: e instanceof Error ? e.message : "Failed" });
    }
  };

  const onRegenerateBranch = async () => {
    dispatch({ type: "aiBranchStarted" });
    try {
      const r = await branchGen.mutateAsync({
        cwd: props.cwd,
        message: `${state.title}\n\n${state.body}`,
      });
      dispatch({ type: "branchGenerated", branch: r.branch });
    } catch (e) {
      dispatch({ type: "aiBranchFailed", error: e instanceof Error ? e.message : "Failed" });
    }
  };

  const onSubmit = async () => {
    dispatch({ type: "submitStarted" });
    try {
      const result = await createIssue.mutateAsync({
        cwd: props.cwd,
        title: state.title,
        body: state.body,
        ...(state.labels.length > 0 ? { labels: state.labels } : {}),
        ...(state.assignees.length > 0 ? { assignees: state.assignees } : {}),
        ...(state.worktreeEnabled && state.worktreeBranchName
          ? { worktree: { enabled: true, branchName: state.worktreeBranchName } }
          : {}),
      });
      props.onCreated?.(result.issue.number);
      props.onOpenChange(false);
    } catch (e) {
      dispatch({ type: "submitFailed", error: e instanceof Error ? e.message : "Failed" });
    }
  };

  // Defense in depth: even though IssuesTab gates the button by provider kind,
  // verify here as well so a future caller cannot bypass the check.
  const providerKind = useResolvedProviderKind(props.environmentId, props.cwd);
  if (providerKind !== "github") {
    return (
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <DialogPopup className="max-w-md p-6">
          <p className="text-sm text-muted-foreground">
            Issue creation is supported only on GitHub projects in this version.
          </p>
        </DialogPopup>
      </Dialog>
    );
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="flex max-h-[80vh] w-full max-w-2xl flex-col p-0">
        <DialogHeader className="border-border/60 border-b px-5 py-3">
          <DialogTitle>New issue</DialogTitle>
          <DialogDescription className="text-xs">{props.cwd}</DialogDescription>
        </DialogHeader>

        <DialogPanel className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span>Title</span>
              <button
                type="button"
                onClick={onSuggestTitle}
                disabled={state.body.length === 0 || state.ai.titleStatus === "running"}
                className="text-xs text-primary"
              >
                {state.ai.titleStatus === "running" ? "Suggesting…" : "✨ Suggest from body"}
              </button>
            </div>
            <Input
              value={state.title}
              onChange={(e) => dispatch({ type: "setTitle", value: e.target.value })}
              placeholder="Short summary"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span>Description</span>
              <button
                type="button"
                onClick={onPolish}
                disabled={state.body.length === 0 || state.ai.polishStatus === "running"}
                className="text-xs text-primary"
              >
                {state.ai.polishStatus === "running" ? "Polishing…" : "✨ Polish with AI"}
              </button>
            </div>
            <Textarea
              value={state.body}
              onChange={(e) => dispatch({ type: "setBody", value: e.target.value })}
              placeholder="Describe the issue, paste error logs, etc. — rough is fine, AI will polish it."
              className="min-h-[120px]"
            />
            {state.ai.polishStatus === "error" && state.ai.lastError ? (
              <p className="text-xs text-destructive">Polish failed: {state.ai.lastError}</p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Labels
              </div>
              <IssueLabelPicker
                available={labelsQuery.data ?? []}
                selected={state.labels}
                onChange={(next) => dispatch({ type: "setLabels", labels: next })}
              />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Assignees
              </div>
              <IssueAssigneePicker
                available={assigneesQuery.data ?? []}
                selected={state.assignees}
                onChange={(next) => dispatch({ type: "setAssignees", assignees: next })}
              />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={state.worktreeEnabled}
                onChange={(e) => dispatch({ type: "setWorktreeEnabled", value: e.target.checked })}
              />
              Create worktree on submit
            </label>
            {state.worktreeEnabled ? (
              <div className="mt-2 flex items-center gap-2">
                <Input
                  value={state.worktreeBranchName ?? ""}
                  onChange={(e) =>
                    dispatch({ type: "setWorktreeBranchName", value: e.target.value })
                  }
                  placeholder={
                    state.ai.branchStatus === "running"
                      ? "Generating…"
                      : "Branch name (auto-suggested)"
                  }
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={onRegenerateBranch}
                  disabled={state.body.length === 0 || state.ai.branchStatus === "running"}
                >
                  ↻
                </Button>
              </div>
            ) : null}
          </div>

          {state.submitError ? (
            <p className="text-sm text-destructive">{state.submitError}</p>
          ) : null}
        </DialogPanel>

        <DialogFooter className="border-border/60 border-t px-5 py-3">
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit(state)} onClick={() => void onSubmit()}>
            {state.submitStatus === "submitting" ? "Creating…" : "Create issue"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
```

(Imports for `Textarea` should match the existing UI library — if it's `Textarea` from `~/components/ui/textarea`, use that path. If not, mirror the existing `Input` usage in `NewWorktreeDialog.tsx`.)

- [ ] **Step 6: Run lint and typecheck**

```bash
bun lint && bun typecheck
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/issues
git commit -m "Add NewIssueDialog and reducer"
```

---

## Task 15: Wire `IssuesTab` `+` button and provider gating

**Files:**

- Modify: `apps/web/src/components/projectExplorer/IssuesTab.tsx`

- [ ] **Step 1: Locate the provider-kind hook**

In `apps/web/src/lib/sourceControlDiscoveryState.ts` (or `apps/web/src/sourceControlPresentation.ts`), find the hook or helper that exposes the current provider kind for a given `cwd`. Note the exact API.

- [ ] **Step 2: Add the `+` button + dialog mount**

Modify `apps/web/src/components/projectExplorer/IssuesTab.tsx`:

```tsx
import { PlusIcon, RotateCwIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { NewIssueDialog } from "../issues/NewIssueDialog";
// ... existing imports

export function IssuesTab(props: IssuesTabProps) {
  // ... existing hooks
  const [showNewIssue, setShowNewIssue] = useState(false);
  const providerKind = useResolvedProviderKind(props.environmentId, props.cwd); // existing hook

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-border/60 border-b px-4 py-2.5">
        <div className="relative flex-1">{/* existing search input */}</div>
        <StateFilterButtons value={props.stateFilter} onChange={props.onStateFilterChange} />
        {providerKind === "github" && props.environmentId && props.cwd ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => setShowNewIssue(true)}
            aria-label="New issue"
          >
            <PlusIcon className="size-3.5" />
          </Button>
        ) : null}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={() => listQuery.refetch()}
          disabled={listQuery.isFetching}
          aria-label="Refresh"
        >
          <RotateCwIcon className={listQuery.isFetching ? "size-3.5 animate-spin" : "size-3.5"} />
        </Button>
      </div>

      {/* existing list rendering */}

      {showNewIssue && props.environmentId && props.cwd ? (
        <NewIssueDialog
          open
          onOpenChange={setShowNewIssue}
          environmentId={props.environmentId}
          cwd={props.cwd}
          onCreated={() => listQuery.refetch()}
        />
      ) : null}
    </div>
  );
}
```

(Replace `useResolvedProviderKind` with whatever existing hook returns the provider kind.)

- [ ] **Step 3: Run lint and typecheck**

```bash
bun lint && bun typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/projectExplorer/IssuesTab.tsx
git commit -m "Wire + button in IssuesTab to open NewIssueDialog (GitHub only)"
```

---

## Task 16: Final verification — full test suite, lints, typecheck, manual smoke

**Files:**

- None.

- [ ] **Step 1: Run the full server test suite**

```bash
bun run test apps/server
```

Expected: all pass.

- [ ] **Step 2: Run the full web test suite**

```bash
bun run test apps/web
```

Expected: all pass.

- [ ] **Step 3: Run the contracts test suite**

```bash
bun run test packages/contracts
```

Expected: all pass.

- [ ] **Step 4: Run typecheck across the workspace**

```bash
bun typecheck
```

Expected: clean.

- [ ] **Step 5: Run lint and format**

```bash
bun lint
bun fmt
```

Expected: clean. Commit any formatting changes:

```bash
git add -A
git commit -m "Format issue creation dialog touchups"
```

(Skip the commit if `bun fmt` made no changes.)

- [ ] **Step 6: Manual smoke test**

Run the desktop app in dev mode:

```bash
bun run dev:desktop
```

Verify:

1. Open a GitHub-backed project.
2. Switch to the Issues tab.
3. Confirm the `+` button is visible next to Refresh.
4. Click `+`. Dialog opens.
5. Type rough notes in the description. Click `✨ Polish with AI`. Verify the body is rewritten and the title is filled (if you left the title empty).
6. Click `✨ Suggest from body`. Verify the title changes.
7. Wait or watch the worktree branch name field auto-populate. Click `↻` to regenerate. Edit it manually to verify the input accepts edits.
8. Add a label and an assignee from the pickers.
9. Click `Create issue`. Verify:
   - Dialog closes.
   - Issue list refreshes and the new issue appears.
   - A worktree was created with the expected branch name.
10. Reopen the dialog. Disable the worktree checkbox. Create another issue. Verify no worktree is created.
11. Open a non-GitHub project (e.g., GitLab if configured) and confirm the `+` button is **not** visible.

- [ ] **Step 7: Final commit if any docs need updating**

If the smoke test surfaced any user-facing change worth noting, append a short entry to `README.md`'s feature list. Otherwise skip.

```bash
git status
```

If clean, the implementation is complete.

---

## Spec coverage checklist

After implementing all tasks, confirm every spec section maps to at least one task:

- **Architecture diagram (spec §Architecture)** → Tasks 1, 2, 7, 9, 11.
- **Server contracts (spec §Server contracts)** → Tasks 1, 2, 3, 4, 5, 10.
- **GitHub implementation (spec §GitHub implementation)** → Task 8.
- **Web component design (spec §Web component design)** → Tasks 12, 13, 14, 15.
- **Error handling (spec §Error handling)** → Tasks 11 (partial worktree failure), 14 (AI error inline, submit error preserved).
- **Security (spec §Security)** → Task 8 (body via temp file), Task 4 (delimited prompt sections), Task 1/10 (Schema validation).
- **Testing (spec §Testing)** → Tasks 1, 4, 5, 6, 7, 8, 9, 11, 12, 14.
- **Acceptance criteria** → Task 16.
