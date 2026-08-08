import { EnvironmentId } from "@ryco/contracts";
import { encodePullRequestId } from "@ryco/shared/pullRequestIdentity";
import { describe, expect, it } from "vite-plus/test";

import { parsePullRequestRouteSearch } from "./pullRequestRouteSearch.ts";

describe("pull request route search", () => {
  it("normalizes invalid search state and clamps pane width", () => {
    expect(
      parsePullRequestRouteSearch({ view: "nope", state: "all", tab: "diff", listWidth: 900 }),
    ).toMatchObject({ view: "latest", q: "", tab: "conversation", listWidth: 560 });
  });

  it("preserves canonical selection and filters", () => {
    const pullRequestId = encodePullRequestId({
      environmentId: EnvironmentId.make("local"),
      provider: "github",
      host: "github.com",
      repositoryPath: "ryco/app",
      number: 42,
    });
    expect(
      parsePullRequestRouteSearch({
        view: "failing",
        q: " retry ",
        provider: "github",
        repository: "ryco/app",
        state: "open",
        check: "failing",
        pr: pullRequestId,
        tab: "checks",
        focus: "true",
        listWidth: 390,
      }),
    ).toEqual({
      view: "failing",
      q: "retry",
      provider: "github",
      repository: "ryco/app",
      state: "open",
      check: "failing",
      pr: pullRequestId,
      tab: "checks",
      focus: true,
      listWidth: 390,
    });
  });

  it("rejects a branded-looking but non-canonical selection", () => {
    expect(parsePullRequestRouteSearch({ pr: "pr_not-canonical" }).pr).toBeUndefined();
  });
});
