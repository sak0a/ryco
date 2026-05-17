import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Layer, Option } from "effect";

import * as ForgejoApi from "./ForgejoApi.ts";
import * as ForgejoSourceControlProvider from "./ForgejoSourceControlProvider.ts";

function makeProvider(forgejo: Partial<ForgejoApi.ForgejoApiShape>) {
  return ForgejoSourceControlProvider.make().pipe(
    Effect.provide(
      Layer.mock(ForgejoApi.ForgejoApi)({
        detectProviderFromRemoteUrl: () => null,
        ...forgejo,
      }),
    ),
  );
}

it.effect("maps Forgejo PR summaries into provider-neutral change requests", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      getPullRequest: () =>
        Effect.succeed({
          number: 42,
          title: "Add Forgejo provider",
          url: "https://codeberg.org/pingdotgg/ryco/pulls/42",
          baseRefName: "main",
          headRefName: "feature/source-control",
          headLabel: "fork:feature/source-control",
          state: "open",
          updatedAt: Option.none(),
          isCrossRepository: true,
          isDraft: false,
          author: "alice",
          commentsCount: 2,
          headRepositoryNameWithOwner: "fork/ryco",
          headRepositoryOwnerLogin: "fork",
          headRepositoryCloneUrl: "https://codeberg.org/fork/ryco.git",
          headRepositorySshUrl: "git@codeberg.org:fork/ryco.git",
        }),
    });

    const changeRequest = yield* provider.getChangeRequest({
      cwd: "/repo",
      reference: "42",
    });

    assert.deepStrictEqual(changeRequest, {
      provider: "forgejo",
      number: 42,
      title: "Add Forgejo provider",
      url: "https://codeberg.org/pingdotgg/ryco/pulls/42",
      baseRefName: "main",
      headRefName: "feature/source-control",
      state: "open",
      updatedAt: Option.none(),
      isCrossRepository: true,
      isDraft: false,
      author: "alice",
      commentsCount: 2,
      headRepositoryNameWithOwner: "fork/ryco",
      headRepositoryOwnerLogin: "fork",
    });
  }),
);

it.effect("creates Forgejo PRs through provider-neutral input names", () =>
  Effect.gen(function* () {
    let createInput: Parameters<ForgejoApi.ForgejoApiShape["createPullRequest"]>[0] | null = null;
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
      source: {
        owner: "owner",
        refName: "feature/provider",
      },
      title: "Provider PR",
      bodyFile: "/tmp/body.md",
    });
  }),
);

it.effect("listIssues maps Forgejo issue summaries to provider: forgejo", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      listIssues: () =>
        Effect.succeed([
          {
            number: 42,
            title: "Bug",
            url: "https://codeberg.org/owner/repo/issues/42",
            state: "open" as const,
            author: "alice",
            updatedAt: Option.some("2026-01-02T00:00:00.000Z"),
            labels: [{ name: "bug", color: "cc0000" }],
            assignees: ["bob"],
            commentsCount: 3,
          },
        ]),
    });

    const issues = yield* provider.listIssues({ cwd: "/repo", state: "open" });

    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0]?.provider, "forgejo");
    assert.strictEqual(issues[0]?.number, 42);
    assert.strictEqual(issues[0]?.author, "alice");
    assert.deepStrictEqual(issues[0]?.labels, [{ name: "bug", color: "cc0000" }]);
    assert.deepStrictEqual(issues[0]?.assignees, ["bob"]);
    assert.deepStrictEqual(
      issues[0]?.updatedAt,
      Option.some(DateTime.fromDateUnsafe(new Date("2026-01-02T00:00:00.000Z"))),
    );
  }),
);

it.effect("getChangeRequestDetail returns Forgejo body, comments, commits, and files", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      getPullRequestDetail: () =>
        Effect.succeed({
          number: 99,
          title: "Add feature",
          url: "https://codeberg.org/owner/repo/pulls/99",
          baseRefName: "main",
          headRefName: "feature/add",
          headLabel: "owner:feature/add",
          state: "open" as const,
          updatedAt: Option.none(),
          author: "alice",
          commentsCount: 1,
          headRepositoryNameWithOwner: "owner/repo",
          headRepositoryOwnerLogin: "owner",
          headRepositoryCloneUrl: "https://codeberg.org/owner/repo.git",
          headRepositorySshUrl: "git@codeberg.org:owner/repo.git",
          body: "PR body text",
          comments: [{ author: "reviewer", body: "looks good", createdAt: "2026-03-01T10:00:00Z" }],
          commits: [
            {
              oid: "abcdef1234567890",
              shortOid: "abcdef123456",
              messageHeadline: "Add support",
              author: "alice",
            },
          ],
          additions: 10,
          deletions: 2,
          changedFiles: 1,
          files: [{ path: "src/forgejo.ts", additions: 10, deletions: 2 }],
        }),
    });

    const detail = yield* provider.getChangeRequestDetail({ cwd: "/repo", reference: "99" });

    assert.strictEqual(detail.provider, "forgejo");
    assert.strictEqual(detail.number, 99);
    assert.strictEqual(detail.body, "PR body text");
    assert.strictEqual(detail.comments[0]?.author, "reviewer");
    assert.strictEqual(detail.commits?.[0]?.shortOid, "abcdef123456");
    assert.strictEqual(detail.additions, 10);
    assert.strictEqual(detail.deletions, 2);
    assert.strictEqual(detail.changedFiles, 1);
    assert.deepStrictEqual(detail.files, [{ path: "src/forgejo.ts", additions: 10, deletions: 2 }]);
  }),
);

it.effect("getChangeRequestDiff forwards Forgejo diffs", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      getPullRequestDiff: () => Effect.succeed("diff --git a/file b/file\n"),
    });

    const diff = yield* provider.getChangeRequestDiff({ cwd: "/repo", reference: "99" });

    assert.strictEqual(diff, "diff --git a/file b/file\n");
  }),
);

describe("ForgejoSourceControlProvider stubs (Phase 1 of issue creation)", () => {
  it.effect("createIssue fails with 'Not implemented' SourceControlProviderError", () =>
    Effect.gen(function* () {
      const provider = yield* makeProvider({});
      const result = yield* provider
        .createIssue({ cwd: "/repo", title: "x", body: "" })
        .pipe(Effect.flip);
      assert.strictEqual(result.operation, "createIssue");
      assert.include(result.detail, "Not implemented");
    }),
  );

  it.effect("listLabels fails with 'Not implemented'", () =>
    Effect.gen(function* () {
      const provider = yield* makeProvider({});
      const result = yield* provider.listLabels({ cwd: "/repo" }).pipe(Effect.flip);
      assert.include(result.detail, "Not implemented");
    }),
  );

  it.effect("listAssignees fails with 'Not implemented'", () =>
    Effect.gen(function* () {
      const provider = yield* makeProvider({});
      const result = yield* provider.listAssignees({ cwd: "/repo" }).pipe(Effect.flip);
      assert.include(result.detail, "Not implemented");
    }),
  );
});
