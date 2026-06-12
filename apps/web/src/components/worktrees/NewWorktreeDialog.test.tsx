import type { WorkItemSummary } from "@ryco/contracts";
import { WorktreeId } from "@ryco/contracts";
import { Option } from "effect";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { WorkItemSummaryPanel } from "./NewWorktreeDialog";

const workItem: WorkItemSummary = {
  provider: "jira",
  key: "KAN-4",
  title: "SUPER TOLL",
  url: "https://ryco-app.atlassian.net/browse/KAN-4",
  state: "open",
  issueType: "Task",
  assignee: null,
  updatedAt: Option.none(),
};

describe("WorkItemSummaryPanel", () => {
  it("shows selectable existing Jira branches", () => {
    const markup = renderToStaticMarkup(
      <WorkItemSummaryPanel
        baseBranch="main"
        branchMode="ai"
        branchName=""
        cwd="/repo"
        dialogOpen
        environmentId={null}
        existingWorktreeId={null}
        generationError={null}
        isGenerating={false}
        linkedBranches={[]}
        linkedBranchesError={null}
        linkedBranchesLoading={false}
        linkedWorktrees={[
          {
            id: WorktreeId.make("worktree-kan-4"),
            branch: "feature/KAN-4-existing-b",
            title: null,
            worktreePath: "/tmp/KAN-4-existing-b",
            archivedAt: null,
          },
        ]}
        selection={workItem}
        selectedExistingBranchName="feature/KAN-4-existing-a"
        workItemBranchChoices={[
          {
            branchName: "feature/KAN-4-existing-a",
            label: "feature/KAN-4-existing-a",
            description: "Local branch",
            hasWorktree: false,
          },
          {
            branchName: "feature/KAN-4-existing-b",
            label: "feature/KAN-4-existing-b",
            description: "/tmp/KAN-4-existing-b",
            hasWorktree: true,
          },
        ]}
        onBaseBranchChange={() => undefined}
        onBranchModeChange={() => undefined}
        onBranchNameChange={() => undefined}
        onDefaultBranchDiscovered={() => undefined}
        onGenerateBranchName={() => undefined}
        onSelectExistingBranchName={() => undefined}
      />,
    );

    expect(markup).toContain("Branch already exists for this Jira ticket");
    expect(markup).toContain("feature/KAN-4-existing-a");
    expect(markup).toContain("feature/KAN-4-existing-b");
  });
});
