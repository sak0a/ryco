import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { DateTime, Effect, Layer, Option } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { SOURCE_CONTROL_DETAIL_BODY_MAX_BYTES } from "@ryco/contracts";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitHubCli from "./GitHubCli.ts";
import * as GitHubSourceControlProvider from "./GitHubSourceControlProvider.ts";

const processResult = (stdout: string): VcsProcess.VcsProcessOutput => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

function makeProvider(github: Partial<GitHubCli.GitHubCliShape>) {
  return GitHubSourceControlProvider.make().pipe(
    Effect.provide(Layer.mock(GitHubCli.GitHubCli)(github)),
    Effect.provide(NodeServices.layer),
  );
}

it.effect("maps GitHub PR summaries into provider-neutral change requests", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      getPullRequest: () =>
        Effect.succeed({
          number: 42,
          title: "Add GitHub provider",
          url: "https://github.com/pingdotgg/ryco/pull/42",
          baseRefName: "main",
          headRefName: "feature/source-control",
          state: "open",
          isCrossRepository: true,
          headRepositoryNameWithOwner: "fork/ryco",
          headRepositoryOwnerLogin: "fork",
        }),
    });

    const changeRequest = yield* provider.getChangeRequest({
      cwd: "/repo",
      reference: "42",
    });

    assert.deepStrictEqual(changeRequest, {
      provider: "github",
      number: 42,
      title: "Add GitHub provider",
      url: "https://github.com/pingdotgg/ryco/pull/42",
      baseRefName: "main",
      headRefName: "feature/source-control",
      state: "open",
      updatedAt: Option.none(),
      isCrossRepository: true,
      headRepositoryNameWithOwner: "fork/ryco",
      headRepositoryOwnerLogin: "fork",
    });
  }),
);

it.effect("uses gh json listing for non-open change request state queries", () =>
  Effect.gen(function* () {
    let executeArgs: ReadonlyArray<string> = [];
    const provider = yield* makeProvider({
      execute: (input) => {
        executeArgs = input.args;
        return Effect.succeed(
          processResult(
            JSON.stringify([
              {
                number: 7,
                title: "Merged work",
                url: "https://github.com/pingdotgg/ryco/pull/7",
                baseRefName: "main",
                headRefName: "feature/merged",
                state: "merged",
                updatedAt: "2026-01-02T00:00:00.000Z",
              },
            ]),
          ),
        );
      },
    });

    const changeRequests = yield* provider.listChangeRequests({
      cwd: "/repo",
      headSelector: "feature/merged",
      state: "all",
      limit: 10,
    });

    assert.deepStrictEqual(executeArgs, [
      "pr",
      "list",
      "--head",
      "feature/merged",
      "--state",
      "all",
      "--limit",
      "10",
      "--json",
      "number,title,url,baseRefName,headRefName,state,mergedAt,updatedAt,isCrossRepository,isDraft,author,assignees,labels,comments,headRepository,headRepositoryOwner",
    ]);
    assert.strictEqual(changeRequests[0]?.provider, "github");
    assert.strictEqual(changeRequests[0]?.state, "merged");
    assert.deepStrictEqual(
      changeRequests[0]?.updatedAt,
      Option.some(DateTime.makeUnsafe("2026-01-02T00:00:00.000Z")),
    );
  }),
);

it.effect("treats empty non-open change request listing output as no results", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      execute: () => Effect.succeed(processResult("")),
    });

    const changeRequests = yield* provider.listChangeRequests({
      cwd: "/repo",
      headSelector: "feature/empty",
      state: "all",
      limit: 10,
    });

    assert.deepStrictEqual(changeRequests, []);
  }),
);

it.effect("creates GitHub PRs through provider-neutral input names", () =>
  Effect.gen(function* () {
    let createInput: Parameters<GitHubCli.GitHubCliShape["createPullRequest"]>[0] | null = null;
    const provider = yield* makeProvider({
      createPullRequest: (input) => {
        createInput = input;
        return Effect.void;
      },
    });

    yield* provider.createChangeRequest({
      cwd: "/repo",
      baseRefName: "main",
      headSelector: "owner:feature/provider",
      title: "Provider PR",
      bodyFile: "/tmp/body.md",
    });

    assert.deepStrictEqual(createInput, {
      cwd: "/repo",
      baseBranch: "main",
      headSelector: "owner:feature/provider",
      title: "Provider PR",
      bodyFile: "/tmp/body.md",
    });
  }),
);

it.effect("listIssues returns summaries with provider: github", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      listIssues: () =>
        Effect.succeed([
          {
            number: 42,
            title: "Bug report",
            url: "https://github.com/owner/repo/issues/42",
            state: "open" as const,
            author: "alice",
            updatedAt: Option.some("2026-01-02T00:00:00.000Z"),
            labels: [{ name: "bug" }],
            assignees: [],
            commentsCount: 0,
          },
        ]),
    });

    const issues = yield* provider.listIssues({ cwd: "/repo", state: "open" });

    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0]?.provider, "github");
    assert.strictEqual(issues[0]?.number, 42);
    assert.strictEqual(issues[0]?.title, "Bug report");
    assert.strictEqual(issues[0]?.state, "open");
    assert.strictEqual(issues[0]?.author, "alice");
    assert.deepStrictEqual(
      issues[0]?.updatedAt,
      Option.some(DateTime.fromDateUnsafe(new Date("2026-01-02T00:00:00.000Z"))),
    );
  }),
);

it.effect("getIssue returns truncated details when body exceeds 8 KB", () =>
  Effect.gen(function* () {
    const bigBody = "x".repeat(SOURCE_CONTROL_DETAIL_BODY_MAX_BYTES + 100);
    const provider = yield* makeProvider({
      getIssue: () =>
        Effect.succeed({
          number: 7,
          title: "Large issue",
          url: "https://github.com/owner/repo/issues/7",
          state: "open" as const,
          author: "bob",
          updatedAt: Option.none(),
          labels: [],
          assignees: [],
          commentsCount: 0,
          body: bigBody,
          comments: [],
        }),
    });

    const detail = yield* provider.getIssue({ cwd: "/repo", reference: "7" });

    assert.strictEqual(detail.truncated, true);
    assert.strictEqual(detail.provider, "github");
    assert.ok(Buffer.byteLength(detail.body, "utf8") <= SOURCE_CONTROL_DETAIL_BODY_MAX_BYTES);
  }),
);

it.effect("searchIssues passes query through to cli.searchIssues", () =>
  Effect.gen(function* () {
    let capturedQuery: string | undefined;
    const provider = yield* makeProvider({
      searchIssues: (input) => {
        capturedQuery = input.query;
        return Effect.succeed([]);
      },
    });

    yield* provider.searchIssues({ cwd: "/repo", query: "memory leak" });

    assert.strictEqual(capturedQuery, "memory leak");
  }),
);

it.effect("searchChangeRequests passes query through to cli.searchPullRequests", () =>
  Effect.gen(function* () {
    let capturedQuery: string | undefined;
    const provider = yield* makeProvider({
      searchPullRequests: (input) => {
        capturedQuery = input.query;
        return Effect.succeed([]);
      },
    });

    yield* provider.searchChangeRequests({ cwd: "/repo", query: "fix memory" });

    assert.strictEqual(capturedQuery, "fix memory");
  }),
);

it.effect("getChangeRequestDetail returns body and comments", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      getPullRequestDetail: () =>
        Effect.succeed({
          number: 99,
          title: "Add feature",
          url: "https://github.com/owner/repo/pull/99",
          baseRefName: "main",
          headRefName: "feature/add",
          state: "open" as const,
          isCrossRepository: false,
          author: null,
          assignees: [],
          labels: [],
          commentsCount: 1,
          body: "PR body text",
          comments: [
            { author: "reviewer", body: "Looks good!", createdAt: "2026-03-01T10:00:00Z" },
          ],
          linkedIssueNumbers: [],
          reviewers: [],
          commits: [],
          additions: 0,
          deletions: 0,
          changedFiles: 0,
          files: [],
        }),
    });

    const detail = yield* provider.getChangeRequestDetail({ cwd: "/repo", reference: "99" });

    assert.strictEqual(detail.provider, "github");
    assert.strictEqual(detail.number, 99);
    assert.strictEqual(detail.body, "PR body text");
    assert.strictEqual(detail.comments.length, 1);
    assert.strictEqual(detail.comments[0]?.author, "reviewer");
    assert.strictEqual(detail.comments[0]?.body, "Looks good!");
    assert.strictEqual(detail.truncated, false);
  }),
);

it.effect("createIssue writes body to temp file and returns issue summary", () =>
  Effect.gen(function* () {
    let capturedCwd: string | null = null;
    let capturedTitle: string | null = null;
    let capturedBodyFile: string | null = null;
    let capturedLabels: ReadonlyArray<string> | null = null;
    let capturedAssignees: ReadonlyArray<string> | null = null;
    let capturedGetIssueRef: string | null = null;

    const provider = yield* makeProvider({
      createIssue: (input) => {
        capturedCwd = input.cwd;
        capturedTitle = input.title;
        capturedBodyFile = input.bodyFile;
        capturedLabels = input.labels ?? null;
        capturedAssignees = input.assignees ?? null;
        return Effect.succeed({ url: "https://github.com/owner/repo/issues/55", number: 55 });
      },
      getIssue: (input) => {
        capturedGetIssueRef = input.reference;
        return Effect.succeed({
          number: 55,
          title: "New bug",
          url: "https://github.com/owner/repo/issues/55",
          state: "open" as const,
          author: "carol",
          updatedAt: Option.none(),
          labels: [{ name: "bug" }],
          assignees: ["dave"],
          commentsCount: 0,
          body: "Bug description",
          comments: [],
        });
      },
    });

    const summary = yield* provider.createIssue({
      cwd: "/repo",
      title: "New bug",
      body: "Bug description",
      labels: ["bug"],
      assignees: ["dave"],
    });

    assert.strictEqual(capturedCwd, "/repo");
    assert.strictEqual(capturedTitle, "New bug");
    assert.ok(capturedBodyFile !== null && capturedBodyFile !== "");
    assert.deepStrictEqual(capturedLabels, ["bug"]);
    assert.deepStrictEqual(capturedAssignees, ["dave"]);
    assert.strictEqual(capturedGetIssueRef, "55");
    assert.strictEqual(summary.provider, "github");
    assert.strictEqual(summary.number, 55);
    assert.strictEqual(summary.title, "New bug");
  }),
);

it.effect("createIssue maps GitHubCliError to SourceControlProviderError", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      createIssue: () =>
        Effect.fail(
          new GitHubCli.GitHubCliError({
            operation: "createIssue",
            detail: "gh: unauthorized",
          }),
        ),
    });

    const result = yield* provider
      .createIssue({ cwd: "/repo", title: "Bug", body: "desc" })
      .pipe(Effect.flip);

    assert.strictEqual(result.operation, "createIssue");
    assert.strictEqual(result.provider, "github");
    assert.ok(result.detail.includes("gh: unauthorized"));
  }),
);

it.effect("listLabels returns labels from cli", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      listLabels: () =>
        Effect.succeed([
          { name: "bug", color: "d73a4a" },
          { name: "enhancement", color: "a2eeef", description: "New feature" },
        ]),
    });

    const labels = yield* provider.listLabels({ cwd: "/repo" });

    assert.strictEqual(labels.length, 2);
    assert.strictEqual(labels[0]?.name, "bug");
    assert.strictEqual(labels[0]?.color, "d73a4a");
    assert.strictEqual(labels[1]?.name, "enhancement");
    assert.strictEqual(labels[1]?.description, "New feature");
  }),
);

it.effect("listLabels maps GitHubCliError to SourceControlProviderError", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      listLabels: () =>
        Effect.fail(
          new GitHubCli.GitHubCliError({
            operation: "listLabels",
            detail: "network error",
          }),
        ),
    });

    const result = yield* provider.listLabels({ cwd: "/repo" }).pipe(Effect.flip);

    assert.strictEqual(result.operation, "listLabels");
    assert.strictEqual(result.provider, "github");
  }),
);

it.effect("listAssignees returns candidates from cli", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      listAssignees: () =>
        Effect.succeed([
          { login: "alice", name: "Alice Smith", avatarUrl: "https://example.com/alice.png" },
          { login: "bob" },
        ]),
    });

    const assignees = yield* provider.listAssignees({ cwd: "/repo" });

    assert.strictEqual(assignees.length, 2);
    assert.strictEqual(assignees[0]?.login, "alice");
    assert.strictEqual(assignees[0]?.displayName, "Alice Smith");
    assert.strictEqual(assignees[0]?.avatarUrl, "https://example.com/alice.png");
    assert.strictEqual(assignees[1]?.login, "bob");
    assert.strictEqual(assignees[1]?.displayName, undefined);
  }),
);

it.effect("listAssignees maps GitHubCliError to SourceControlProviderError", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      listAssignees: () =>
        Effect.fail(
          new GitHubCli.GitHubCliError({
            operation: "listAssignees",
            detail: "api rate limit",
          }),
        ),
    });

    const result = yield* provider.listAssignees({ cwd: "/repo" }).pipe(Effect.flip);

    assert.strictEqual(result.operation, "listAssignees");
    assert.strictEqual(result.provider, "github");
  }),
);
