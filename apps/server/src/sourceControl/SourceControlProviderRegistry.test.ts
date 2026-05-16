import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { DateTime, Effect, Layer, Option, Ref } from "effect";

import { ServerConfig } from "../config.ts";
import type * as VcsDriver from "../vcs/VcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as AzureDevOpsCli from "./AzureDevOpsCli.ts";
import * as BitbucketApi from "./BitbucketApi.ts";
import * as ForgejoApi from "./ForgejoApi.ts";
import * as GitHubCli from "./GitHubCli.ts";
import * as GitLabCli from "./GitLabCli.ts";
import * as SourceControlProviderRegistry from "./SourceControlProviderRegistry.ts";

const TEST_EPOCH = DateTime.makeUnsafe("1970-01-01T00:00:00.000Z");

function makeRegistry(input: {
  readonly remotes: ReadonlyArray<{
    readonly name: string;
    readonly url: string;
  }>;
  readonly githubCli?: Partial<GitHubCli.GitHubCliShape>;
}) {
  const driver = {
    listRemotes: () =>
      Effect.succeed({
        remotes: input.remotes.map((remote) => ({
          ...remote,
          pushUrl: Option.none(),
          isPrimary: remote.name === "origin",
        })),
        freshness: {
          source: "live-local" as const,
          observedAt: TEST_EPOCH,
          expiresAt: Option.none(),
        },
      }),
  } satisfies Partial<VcsDriver.VcsDriverShape>;

  const registryLayer = Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
    get: () => Effect.succeed(driver as unknown as VcsDriver.VcsDriverShape),
    resolve: () =>
      Effect.succeed({
        kind: "git",
        repository: {
          kind: "git",
          rootPath: "/repo",
          metadataPath: null,
          freshness: {
            source: "live-local" as const,
            observedAt: TEST_EPOCH,
            expiresAt: Option.none(),
          },
        },
        driver: driver as unknown as VcsDriver.VcsDriverShape,
      }),
  });

  return SourceControlProviderRegistry.make().pipe(
    Effect.provide(
      Layer.mergeAll(
        registryLayer,
        Layer.mock(AzureDevOpsCli.AzureDevOpsCli)({}),
        Layer.mock(BitbucketApi.BitbucketApi)({}),
        Layer.mock(ForgejoApi.ForgejoApi)({
          detectProviderFromRemoteUrl: () => null,
          probeAuth: Effect.succeed({
            status: "unauthenticated",
            account: Option.none(),
            host: Option.some("codeberg.org"),
            detail: Option.none(),
          }),
        }),
        Layer.mock(GitHubCli.GitHubCli)(input.githubCli ?? {}),
        Layer.mock(GitLabCli.GitLabCli)({}),
        Layer.mock(VcsProcess.VcsProcess)({}),
        NodeServices.layer,
        ServerConfig.layerTest(process.cwd(), { prefix: "s3-source-control-registry-test-" }).pipe(
          Layer.provide(NodeServices.layer),
        ),
      ),
    ),
  );
}

it.effect("routes GitHub remotes to the GitHub provider", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: "git@github.com:pingdotgg/ryco.git" }],
    });

    const provider = yield* registry.resolve({ cwd: "/repo" });

    assert.strictEqual(provider.kind, "github");
  }),
);

it.effect("routes directly by provider kind for remote-first workflows", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [],
    });

    const provider = yield* registry.get("github");

    assert.strictEqual(provider.kind, "github");
  }),
);

it.effect("routes GitLab remotes to the GitLab provider", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: "git@gitlab.com:group/project.git" }],
    });

    const provider = yield* registry.resolve({ cwd: "/repo" });

    assert.strictEqual(provider.kind, "gitlab");
  }),
);

it.effect("routes Bitbucket remotes to the Bitbucket provider", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: "git@bitbucket.org:pingdotgg/ryco.git" }],
    });

    const provider = yield* registry.resolve({ cwd: "/repo" });

    assert.strictEqual(provider.kind, "bitbucket");
  }),
);

it.effect("routes Forgejo remotes to the Forgejo provider", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: "git@codeberg.org:pingdotgg/ryco.git" }],
    });

    const provider = yield* registry.resolve({ cwd: "/repo" });

    assert.strictEqual(provider.kind, "forgejo");
  }),
);

it.effect("routes Azure DevOps remotes to the Azure DevOps provider", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: "https://dev.azure.com/acme/project/_git/repo" }],
    });

    const provider = yield* registry.resolve({ cwd: "/repo" });

    assert.strictEqual(provider.kind, "azure-devops");
  }),
);

it.effect("falls back to a non-origin remote when origin is not configured", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry({
      remotes: [{ name: "upstream", url: "https://dev.azure.com/acme/project/_git/repo" }],
    });

    const provider = yield* registry.resolve({ cwd: "/repo" });

    assert.strictEqual(provider.kind, "azure-devops");
  }),
);

it.effect("dispatches listIssues to the GitHub provider for GitHub remotes", () =>
  Effect.gen(function* () {
    const called = yield* Ref.make(false);
    const registry = yield* makeRegistry({
      remotes: [{ name: "origin", url: "git@github.com:pingdotgg/ryco.git" }],
      githubCli: {
        listIssues: (_input) => Effect.tap(Effect.succeed([]), () => Ref.set(called, true)),
      },
    });

    const provider = yield* registry.resolve({ cwd: "/repo" });
    yield* provider.listIssues({ cwd: "/repo", state: "open" });

    assert.strictEqual(yield* Ref.get(called), true);
  }),
);

it.effect(
  "dispatches getIssue, searchIssues, searchChangeRequests, and getChangeRequestDetail to the GitHub provider",
  () =>
    Effect.gen(function* () {
      const getIssueCalled = yield* Ref.make(false);
      const searchIssuesCalled = yield* Ref.make(false);
      const searchChangeRequestsCalled = yield* Ref.make(false);
      const getChangeRequestDetailCalled = yield* Ref.make(false);

      const registry = yield* makeRegistry({
        remotes: [{ name: "origin", url: "git@github.com:pingdotgg/ryco.git" }],
        githubCli: {
          getIssue: (_input) =>
            Effect.tap(
              Effect.succeed({
                number: 1,
                title: "Test issue",
                url: "https://github.com/pingdotgg/ryco/issues/1",
                state: "open" as const,
                author: null,
                updatedAt: Option.none(),
                labels: [],
                assignees: [],
                commentsCount: 0,
                body: "body",
                comments: [],
              }),
              () => Ref.set(getIssueCalled, true),
            ),
          searchIssues: (_input) =>
            Effect.tap(Effect.succeed([]), () => Ref.set(searchIssuesCalled, true)),
          searchPullRequests: (_input) =>
            Effect.tap(Effect.succeed([]), () => Ref.set(searchChangeRequestsCalled, true)),
          getPullRequestDetail: (_input) =>
            Effect.tap(
              Effect.succeed({
                number: 1,
                title: "Test PR",
                url: "https://github.com/pingdotgg/ryco/pull/1",
                baseRefName: "main",
                headRefName: "feature/test",
                author: null,
                assignees: [],
                labels: [],
                commentsCount: 0,
                body: "body",
                comments: [],
                linkedIssueNumbers: [],
                reviewers: [],
                commits: [],
                additions: 0,
                deletions: 0,
                changedFiles: 0,
                files: [],
              }),
              () => Ref.set(getChangeRequestDetailCalled, true),
            ),
        },
      });

      const provider = yield* registry.resolve({ cwd: "/repo" });

      yield* provider.getIssue({ cwd: "/repo", reference: "1" });
      yield* provider.searchIssues({ cwd: "/repo", query: "bug" });
      yield* provider.searchChangeRequests({ cwd: "/repo", query: "fix" });
      yield* provider.getChangeRequestDetail({ cwd: "/repo", reference: "1" });

      assert.strictEqual(yield* Ref.get(getIssueCalled), true, "getIssue should be called");
      assert.strictEqual(yield* Ref.get(searchIssuesCalled), true, "searchIssues should be called");
      assert.strictEqual(
        yield* Ref.get(searchChangeRequestsCalled),
        true,
        "searchChangeRequests should be called",
      );
      assert.strictEqual(
        yield* Ref.get(getChangeRequestDetailCalled),
        true,
        "getChangeRequestDetail should be called",
      );
    }),
);
