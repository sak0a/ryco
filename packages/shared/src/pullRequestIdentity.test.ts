import { EnvironmentId } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  decodePullRequestId,
  encodePullRequestId,
  normalizePullRequestHost,
  normalizePullRequestRepositoryPath,
} from "./pullRequestIdentity.ts";

const environmentId = EnvironmentId.make("env-local");

describe("pull request identity", () => {
  it("round-trips and normalizes every repository-aware identity component", () => {
    const id = encodePullRequestId({
      environmentId,
      provider: "gitlab",
      host: "GitLab.Example.COM.",
      repositoryPath: "/Group/Platform/Ryco.git/",
      number: 42,
    });

    expect(id).not.toContain("=");
    expect(decodePullRequestId(id)).toEqual({
      id,
      environmentId,
      provider: "gitlab",
      host: "gitlab.example.com",
      repositoryPath: "group/platform/ryco",
      number: 42,
    });
  });

  it("cannot collide by environment, provider, host, repository, or number", () => {
    const base = {
      environmentId,
      provider: "github" as const,
      host: "github.com",
      repositoryPath: "ryco/ryco",
      number: 42,
    };
    const ids = [
      encodePullRequestId(base),
      encodePullRequestId({ ...base, environmentId: EnvironmentId.make("env-remote") }),
      encodePullRequestId({ ...base, provider: "forgejo" }),
      encodePullRequestId({ ...base, host: "code.example.com" }),
      encodePullRequestId({ ...base, repositoryPath: "other/ryco" }),
      encodePullRequestId({ ...base, number: 43 }),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rejects ambiguous identity inputs", () => {
    expect(() => normalizePullRequestHost("https://github.com/ryco/ryco")).toThrow();
    expect(() => normalizePullRequestRepositoryPath("ryco")).toThrow();
    expect(() => normalizePullRequestRepositoryPath("ryco/../private")).toThrow();
    expect(() =>
      encodePullRequestId({
        environmentId,
        provider: "github",
        host: "github.com",
        repositoryPath: "ryco/ryco",
        number: 0,
      }),
    ).toThrow();
  });
});
