import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Layer, Option } from "effect";
import { SOURCE_CONTROL_DETAIL_BODY_MAX_BYTES } from "@ryco/contracts";

import * as BitbucketApi from "./BitbucketApi.ts";
import * as BitbucketSourceControlProvider from "./BitbucketSourceControlProvider.ts";

function makeProvider(bitbucket: Partial<BitbucketApi.BitbucketApiShape>) {
  return BitbucketSourceControlProvider.make().pipe(
    Effect.provide(Layer.mock(BitbucketApi.BitbucketApi)(bitbucket)),
  );
}

it.effect("maps Bitbucket PR summaries into provider-neutral change requests", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      getPullRequest: () =>
        Effect.succeed({
          number: 42,
          title: "Add Bitbucket provider",
          url: "https://bitbucket.org/pingdotgg/ryco/pull-requests/42",
          baseRefName: "main",
          headRefName: "feature/source-control",
          state: "open",
          updatedAt: Option.none(),
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
      provider: "bitbucket",
      number: 42,
      title: "Add Bitbucket provider",
      url: "https://bitbucket.org/pingdotgg/ryco/pull-requests/42",
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

it.effect("lists Bitbucket PRs through provider-neutral input names", () =>
  Effect.gen(function* () {
    let listInput: Parameters<BitbucketApi.BitbucketApiShape["listPullRequests"]>[0] | null = null;
    const provider = yield* makeProvider({
      listPullRequests: (input) => {
        listInput = input;
        return Effect.succeed([]);
      },
    });

    yield* provider.listChangeRequests({
      cwd: "/repo",
      headSelector: "feature/provider",
      state: "all",
      limit: 10,
    });

    assert.deepStrictEqual(listInput, {
      cwd: "/repo",
      headSelector: "feature/provider",
      state: "all",
      limit: 10,
    });
  }),
);

it.effect("creates Bitbucket PRs through provider-neutral input names", () =>
  Effect.gen(function* () {
    let createInput: Parameters<BitbucketApi.BitbucketApiShape["createPullRequest"]>[0] | null =
      null;
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

it.effect("uses Bitbucket API repository detection for default branch lookup", () =>
  Effect.gen(function* () {
    let cwdInput: string | null = null;
    const provider = yield* makeProvider({
      getDefaultBranch: (input) => {
        cwdInput = input.cwd;
        return Effect.succeed("main");
      },
    });

    const defaultBranch = yield* provider.getDefaultBranch({ cwd: "/repo" });

    assert.strictEqual(defaultBranch, "main");
    assert.strictEqual(cwdInput, "/repo");
  }),
);

it.effect("listIssues maps bitbucket issue summaries to provider: bitbucket", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      listIssues: () =>
        Effect.succeed([
          {
            number: 42,
            title: "Bug",
            url: "https://bitbucket.org/owner/repo/issues/42",
            state: "open" as const,
            author: "alice",
            updatedAt: Option.some("2026-01-02T00:00:00.000Z"),
            labels: ["bug"],
          },
        ]),
    });
    const issues = yield* provider.listIssues({ cwd: "/repo", state: "open" });
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0]?.provider, "bitbucket");
    assert.strictEqual(issues[0]?.number, 42);
    assert.strictEqual(issues[0]?.title, "Bug");
    assert.strictEqual(issues[0]?.state, "open");
    assert.strictEqual(issues[0]?.author, "alice");
    assert.deepStrictEqual(
      issues[0]?.updatedAt,
      Option.some(DateTime.fromDateUnsafe(new Date("2026-01-02T00:00:00.000Z"))),
    );
  }),
);

it.effect("getIssue truncates body when over 8 KB", () =>
  Effect.gen(function* () {
    const bigBody = "x".repeat(SOURCE_CONTROL_DETAIL_BODY_MAX_BYTES + 100);
    const provider = yield* makeProvider({
      getIssue: () =>
        Effect.succeed({
          number: 7,
          title: "Big",
          url: "https://bitbucket.org/owner/repo/issues/7",
          state: "open" as const,
          author: "bob",
          updatedAt: Option.none(),
          labels: [],
          body: bigBody,
          comments: [],
        }),
    });
    const detail = yield* provider.getIssue({ cwd: "/repo", reference: "7" });
    assert.strictEqual(detail.truncated, true);
    assert.strictEqual(detail.provider, "bitbucket");
    assert.ok(Buffer.byteLength(detail.body, "utf8") <= SOURCE_CONTROL_DETAIL_BODY_MAX_BYTES);
  }),
);

it.effect("searchIssues forwards query to api.searchIssues", () =>
  Effect.gen(function* () {
    let captured: string | undefined;
    const provider = yield* makeProvider({
      searchIssues: (input) => {
        captured = input.query;
        return Effect.succeed([]);
      },
    });
    yield* provider.searchIssues({ cwd: "/repo", query: "memory leak" });
    assert.strictEqual(captured, "memory leak");
  }),
);

it.effect("searchChangeRequests forwards query to api.searchPullRequests", () =>
  Effect.gen(function* () {
    let captured: string | undefined;
    const provider = yield* makeProvider({
      searchPullRequests: (input) => {
        captured = input.query;
        return Effect.succeed([]);
      },
    });
    yield* provider.searchChangeRequests({ cwd: "/repo", query: "fix" });
    assert.strictEqual(captured, "fix");
  }),
);

it.effect("getChangeRequestDetail returns body and comments", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      getPullRequestDetail: () =>
        Effect.succeed({
          number: 99,
          title: "Add feature",
          url: "https://bitbucket.org/owner/repo/pull-requests/99",
          baseRefName: "main",
          headRefName: "feature/add",
          state: "open" as const,
          updatedAt: Option.none(),
          author: "alice",
          commentsCount: 2,
          body: "PR body text",
          comments: [{ author: "reviewer", body: "looks good", createdAt: "2026-03-01T10:00:00Z" }],
          reviewers: ["reviewer"],
          participants: [{ displayName: "reviewer", role: "REVIEWER", approved: true }],
          tasksCount: 1,
          linkedWorkItemKeys: ["S3-123"],
        }),
    });
    const detail = yield* provider.getChangeRequestDetail({ cwd: "/repo", reference: "99" });
    assert.strictEqual(detail.provider, "bitbucket");
    assert.strictEqual(detail.number, 99);
    assert.strictEqual(detail.body, "PR body text");
    assert.strictEqual(detail.comments.length, 1);
    assert.strictEqual(detail.comments[0]?.author, "reviewer");
    assert.strictEqual(detail.comments[0]?.body, "looks good");
    assert.strictEqual(detail.author, "alice");
    assert.strictEqual(detail.commentsCount, 2);
    assert.deepStrictEqual(detail.reviewers, ["reviewer"]);
    assert.deepStrictEqual(detail.participants?.[0], {
      displayName: "reviewer",
      role: "REVIEWER",
      approved: true,
    });
    assert.strictEqual(detail.tasksCount, 1);
    assert.deepStrictEqual(detail.linkedWorkItemKeys, ["S3-123"]);
    assert.strictEqual(detail.truncated, false);
  }),
);

it.effect("getChangeRequestDiff forwards to api.getPullRequestDiff", () =>
  Effect.gen(function* () {
    let capturedReference: string | undefined;
    const provider = yield* makeProvider({
      getPullRequestDiff: (input) => {
        capturedReference = input.reference;
        return Effect.succeed("diff --git a/a b/a");
      },
    });
    const diff = yield* provider.getChangeRequestDiff({ cwd: "/repo", reference: "99" });
    assert.strictEqual(capturedReference, "99");
    assert.include(diff, "diff --git");
  }),
);

describe("BitbucketSourceControlProvider stubs (Phase 1 of issue creation)", () => {
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
