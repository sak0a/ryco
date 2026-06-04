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
});
