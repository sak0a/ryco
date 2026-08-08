import {
  EnvironmentId,
  ProjectId,
  type ChangeRequest,
  type RepositoryIdentity,
} from "@ryco/contracts";
import { decodePullRequestId } from "@ryco/shared/pullRequestIdentity";
import { DateTime, Option } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { normalizeProviderPullRequest } from "./PullRequestProviderNormalization.ts";

const repositoryIdentity: RepositoryIdentity = {
  canonicalKey: "gitlab.example.com/platform/tools/ryco",
  locator: {
    source: "git-remote",
    remoteName: "origin",
    remoteUrl: "ssh://git@gitlab.example.com/platform/tools/ryco.git",
  },
  rootPath: "/tmp/ryco",
  displayName: "platform/tools/ryco",
  provider: "gitlab",
  owner: "platform",
  name: "ryco",
  remotes: [],
};

const changeRequest: ChangeRequest = {
  provider: "gitlab",
  number: 42,
  title: "Add the pull request inbox",
  url: "https://gitlab.example.com/platform/tools/ryco/-/merge_requests/42",
  state: "open",
  isDraft: false,
  baseRefName: "main",
  headRefName: "feature/inbox",
  reviewers: ["alex"],
  reviewDisposition: "review-required",
  checkRollup: [],
  updatedAt: Option.some(DateTime.makeUnsafe("2026-08-08T11:00:00Z")),
};

describe("pull request provider normalization", () => {
  it("combines verified provider and repository context into a canonical record", () => {
    const normalized = normalizeProviderPullRequest({
      environmentId: EnvironmentId.make("env-local"),
      projectId: ProjectId.make("project-a"),
      cwd: "/tmp/ryco",
      repositoryIdentity,
      provider: "gitlab",
      changeRequest,
      observedAt: DateTime.makeUnsafe("2026-08-08T12:00:00Z"),
      refreshGeneration: 7,
    });

    expect(decodePullRequestId(normalized.record.identity.id)).toMatchObject({
      environmentId: "env-local",
      provider: "gitlab",
      host: "gitlab.example.com",
      repositoryPath: "platform/tools/ryco",
      number: 42,
    });
    expect(normalized.record.review).toMatchObject({
      disposition: "review-required",
      requestedReviewers: ["alex"],
    });
    expect(normalized.accessTarget.projectId).toBe("project-a");
  });

  it("rejects a provider response from a different host", () => {
    expect(() =>
      normalizeProviderPullRequest({
        environmentId: EnvironmentId.make("env-local"),
        cwd: "/tmp/ryco",
        repositoryIdentity,
        provider: "gitlab",
        changeRequest: { ...changeRequest, url: "https://gitlab.attacker.test/merge_requests/42" },
        observedAt: DateTime.makeUnsafe("2026-08-08T12:00:00Z"),
        refreshGeneration: 7,
      }),
    ).toThrow(/host/i);
  });
});
