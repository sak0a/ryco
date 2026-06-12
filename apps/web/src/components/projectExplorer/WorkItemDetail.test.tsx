import type { VcsRef } from "@ryco/contracts";
import { WorktreeId } from "@ryco/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { LinkedLocalWorkItemSection } from "./WorkItemDetail";

function ref(name: string): VcsRef {
  return {
    name,
    current: false,
    isDefault: false,
    isRemote: false,
    worktreePath: null,
  };
}

describe("LinkedLocalWorkItemSection", () => {
  it("renders linked branches and worktrees for a Jira ticket detail", () => {
    const markup = renderToStaticMarkup(
      <LinkedLocalWorkItemSection
        branches={[ref("feature/KAN-4-super-toll")]}
        branchesLoading={false}
        worktrees={[
          {
            id: WorktreeId.make("worktree-kan-4"),
            branch: "feature/KAN-4-follow-up",
            title: null,
            worktreePath: "/tmp/KAN-4-follow-up",
            archivedAt: null,
          },
        ]}
      />,
    );

    expect(markup).toContain("Local links");
    expect(markup).toContain("feature/KAN-4-super-toll");
    expect(markup).toContain("feature/KAN-4-follow-up");
  });
});
