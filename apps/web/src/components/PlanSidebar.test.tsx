import { EnvironmentId } from "@ryco/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import PlanSidebar from "./PlanSidebar";

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");

describe("PlanSidebar", () => {
  it("summarizes changes into committed / uncommitted buckets (no per-file rows)", () => {
    const markup = renderToStaticMarkup(
      <PlanSidebar
        activePlan={null}
        activeProposedPlan={null}
        changes={{
          files: [
            {
              path: "apps/web/src/components/PlanSidebar.tsx",
              insertions: 30,
              deletions: 5,
              category: "committed",
            },
            {
              path: "packages/contracts/src/git.ts",
              insertions: 7,
              deletions: 1,
              category: "local",
            },
          ],
          insertions: 37,
          deletions: 6,
          refName: "feat/overview-panel-layouts",
          aheadCount: 2,
          behindCount: 0,
        }}
        branchControl={<div>branch</div>}
        environmentId={ENVIRONMENT_ID}
        markdownCwd={undefined}
        workspaceRoot={undefined}
      />,
    );

    expect(markup).toContain("Changes");
    expect(markup).toContain("Committed");
    expect(markup).toContain("Uncommitted");
    // Bucket totals, not per-file rows.
    expect(markup).toContain("+30");
    expect(markup).toContain("+7");
    expect(markup).not.toContain("PlanSidebar.tsx");
    expect(markup).not.toContain("Overview");
  });

  it("renders the pull request with inline checks and a merge-conflict banner", () => {
    const markup = renderToStaticMarkup(
      <PlanSidebar
        activePlan={null}
        activeProposedPlan={null}
        pullRequest={{
          number: 124,
          title: "Consolidate chat right panel",
          state: "open",
          checkStatus: null,
          checksLoading: false,
          hasMergeConflicts: true,
          activeCheckCount: 0,
          runs: [],
          latestRuns: [
            {
              id: "run:lint",
              name: "lint",
              statusLabel: "Succeeded",
              statusKind: "passed",
              tone: "success",
            },
            {
              id: "run:e2e",
              name: "e2e (smoke)",
              statusLabel: "Failed",
              statusKind: "failed",
              tone: "failure",
            },
          ],
        }}
        environmentId={ENVIRONMENT_ID}
        markdownCwd={undefined}
        workspaceRoot={undefined}
      />,
    );

    expect(markup).toContain("#124");
    expect(markup).toContain("Consolidate chat right panel");
    expect(markup).toContain("lint");
    expect(markup).toContain("e2e (smoke)");
    expect(markup).toContain("Merge conflict");
  });
});
