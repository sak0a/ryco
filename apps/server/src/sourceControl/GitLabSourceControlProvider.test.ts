import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Layer, Option } from "effect";
import { SOURCE_CONTROL_DETAIL_BODY_MAX_BYTES } from "@ryco/contracts";

import * as GitLabCli from "./GitLabCli.ts";
import * as GitLabSourceControlProvider from "./GitLabSourceControlProvider.ts";

function makeProvider(gitlab: Partial<GitLabCli.GitLabCliShape>) {
  return GitLabSourceControlProvider.make().pipe(
    Effect.provide(Layer.mock(GitLabCli.GitLabCli)(gitlab)),
  );
}

it.effect("maps GitLab MR summaries into provider-neutral change requests", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      getMergeRequest: () =>
        Effect.succeed({
          number: 42,
          title: "Add GitLab provider",
          url: "https://gitlab.com/pingdotgg/ryco/-/merge_requests/42",
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
      provider: "gitlab",
      number: 42,
      title: "Add GitLab provider",
      url: "https://gitlab.com/pingdotgg/ryco/-/merge_requests/42",
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

it.effect("lists GitLab MRs through provider-neutral input names", () =>
  Effect.gen(function* () {
    let listInput: Parameters<GitLabCli.GitLabCliShape["listMergeRequests"]>[0] | null = null;
    const provider = yield* makeProvider({
      listMergeRequests: (input) => {
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

it.effect("creates GitLab MRs through provider-neutral input names", () =>
  Effect.gen(function* () {
    let createInput: Parameters<GitLabCli.GitLabCliShape["createMergeRequest"]>[0] | null = null;
    const provider = yield* makeProvider({
      createMergeRequest: (input) => {
        createInput = input;
        return Effect.void;
      },
    });

    yield* provider.createChangeRequest({
      cwd: "/repo",
      baseRefName: "main",
      headSelector: "owner:feature/provider",
      title: "Provider MR",
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
      title: "Provider MR",
      bodyFile: "/tmp/body.md",
    });
  }),
);

it.effect("listIssues maps GitLab summaries to provider: gitlab", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      listIssues: () =>
        Effect.succeed([
          {
            number: 42,
            title: "Bug",
            url: "https://gitlab.com/owner/repo/-/issues/42",
            state: "open" as const,
            author: "alice",
            updatedAt: Option.some("2026-01-02T00:00:00.000Z"),
            labels: ["bug"],
          },
        ]),
    });
    const issues = yield* provider.listIssues({ cwd: "/repo", state: "open" });
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0]?.provider, "gitlab");
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
          url: "https://gitlab.com/owner/repo/-/issues/7",
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
    assert.strictEqual(detail.provider, "gitlab");
    assert.ok(Buffer.byteLength(detail.body, "utf8") <= SOURCE_CONTROL_DETAIL_BODY_MAX_BYTES);
  }),
);

it.effect("searchIssues forwards query to cli.searchIssues", () =>
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

it.effect("searchChangeRequests forwards query to cli.searchMergeRequests", () =>
  Effect.gen(function* () {
    let captured: string | undefined;
    const provider = yield* makeProvider({
      searchMergeRequests: (input) => {
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
      getMergeRequestDetail: () =>
        Effect.succeed({
          number: 99,
          title: "Add feature",
          url: "https://gitlab.com/owner/repo/-/merge_requests/99",
          baseRefName: "main",
          headRefName: "feature/add",
          state: "open" as const,
          updatedAt: Option.none(),
          body: "MR body text",
          comments: [{ author: "reviewer", body: "looks good", createdAt: "2026-03-01T10:00:00Z" }],
        }),
    });
    const detail = yield* provider.getChangeRequestDetail({ cwd: "/repo", reference: "99" });
    assert.strictEqual(detail.provider, "gitlab");
    assert.strictEqual(detail.number, 99);
    assert.strictEqual(detail.body, "MR body text");
    assert.strictEqual(detail.comments.length, 1);
    assert.strictEqual(detail.comments[0]?.author, "reviewer");
    assert.strictEqual(detail.comments[0]?.body, "looks good");
    assert.strictEqual(detail.truncated, false);
  }),
);

describe("GitLabSourceControlProvider stubs (Phase 1 of issue creation)", () => {
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
