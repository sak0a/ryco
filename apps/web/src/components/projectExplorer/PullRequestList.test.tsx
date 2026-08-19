import type { ChangeRequest } from "@ryco/contracts";
import { Option } from "effect";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { PullRequestList } from "./PullRequestList";

function pullRequest(stackSummary?: ChangeRequest["stackSummary"]): ChangeRequest {
  return {
    provider: "github",
    number: 42,
    title: "Middle of the stack",
    url: "https://github.com/acme/ryco/pull/42",
    baseRefName: "stack/foundation",
    headRefName: "stack/middle",
    state: "open",
    updatedAt: Option.none(),
    ...(stackSummary ? { stackSummary } : {}),
  };
}

describe("PullRequestList", () => {
  it("renders an accessible stack position badge only for stacked pull requests", () => {
    const stacked = renderToStaticMarkup(
      <PullRequestList
        items={[pullRequest({ number: 7, size: 3, position: 2, baseRefName: "main" })]}
        isLoading={false}
        emptyText="Empty"
        onSelect={() => undefined}
      />,
    );
    const standalone = renderToStaticMarkup(
      <PullRequestList
        items={[pullRequest()]}
        isLoading={false}
        emptyText="Empty"
        onSelect={() => undefined}
      />,
    );
    const nonGitHub = renderToStaticMarkup(
      <PullRequestList
        items={[
          {
            ...pullRequest({ number: 7, size: 3, position: 2, baseRefName: "main" }),
            provider: "gitlab",
          },
        ]}
        isLoading={false}
        emptyText="Empty"
        onSelect={() => undefined}
      />,
    );
    expect(stacked).toContain('aria-label="Stack #7, pull request 2 of 3"');
    expect(stacked).toContain("2/3");
    expect(standalone).not.toContain("Stack #");
    expect(nonGitHub).not.toContain("Stack #");
  });
});
