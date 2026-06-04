import { EnvironmentId } from "@ryco/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PlanSidebar from "./PlanSidebar";
import { buildOverviewChangesItem } from "./overviewChanges.logic";

describe("PlanSidebar", () => {
  it("renders committed PR changes separately from uncommitted local changes", () => {
    const changesItem = buildOverviewChangesItem({
      local: {
        fileCount: 2,
        insertions: 7,
        deletions: 1,
      },
      pullRequest: {
        changedFiles: 9,
        additions: 30,
        deletions: 5,
        isLoading: false,
      },
    });

    const markup = renderToStaticMarkup(
      <PlanSidebar
        activePlan={null}
        activeProposedPlan={null}
        overviewItems={[{ ...changesItem, icon: "changes" }]}
        environmentId={EnvironmentId.make("environment-local")}
        markdownCwd={undefined}
        workspaceRoot={undefined}
        timestampFormat="locale"
        onClose={() => {}}
      />,
    );

    expect(markup).toContain("PR + local");
    expect(markup).toContain("Committed");
    expect(markup).toContain("9 files");
    expect(markup).toContain("+30");
    expect(markup).toContain("-5");
    expect(markup).toContain("Uncommitted");
    expect(markup).toContain("2 files");
    expect(markup).toContain("+7");
    expect(markup).toContain("-1");
  });

  it("renders a focusable latest-checks tooltip trigger", () => {
    const markup = renderToStaticMarkup(
      <PlanSidebar
        activePlan={null}
        activeProposedPlan={null}
        pullRequest={{
          number: 124,
          title: "Consolidate chat right panel",
          checkStatus: {
            kind: "passed",
            tone: "success",
            icon: "check",
            label: "All checks passed",
            shortLabel: "passed",
            description: "All checks passed.",
            ariaLabel: "All checks passed.",
            className: "",
            iconClassName: "",
            dotClassName: "",
            isTerminal: true,
            isRefreshable: false,
            failedChecks: [],
          },
          checksLoading: false,
          hasMergeConflicts: false,
          activeCheckCount: 0,
          runs: [],
          latestRuns: [
            {
              id: "run:1:job:branch",
              name: "Branch",
              statusLabel: "Skipped",
              statusKind: "passed",
              tone: "success",
            },
            {
              id: "run:1:job:quality",
              name: "Pull Request / Quality",
              statusLabel: "Succeeded",
              statusKind: "passed",
              tone: "success",
            },
          ],
        }}
        environmentId={EnvironmentId.make("environment-local")}
        markdownCwd={undefined}
        workspaceRoot={undefined}
        timestampFormat="locale"
        onClose={() => {}}
      />,
    );

    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain("Show latest checks");
    expect(markup).toContain('data-slot="tooltip-trigger"');
    expect(markup).toContain("cursor-pointer");
    expect(markup).toContain("hover:bg-muted/45");
    expect(markup).toContain("focus-visible:bg-muted/45");
  });
});
