import { EnvironmentId } from "@ryco/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import PlanSidebar from "./PlanSidebar";

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");

describe("PlanSidebar", () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, "localStorage");
  });
  it("summarizes changes as an aggregate diffstat (no per-file rows)", () => {
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
    // Status Board lanes mount collapsed, so the panel shows the rolled-up
    // diffstat and file count only. The committed /
    // uncommitted bucket split is asserted at its own layer, in
    // overviewChanges.logic.test.ts.
    expect(markup).toContain("+37");
    expect(markup).toContain("−6");
    expect(markup).toContain("2 files");
    // Aggregate totals, never per-file rows.
    expect(markup).not.toContain("PlanSidebar.tsx");
    expect(markup).not.toContain("Overview");
  });

  it("summarizes pull request checks and merge conflicts in Status Board lanes", () => {
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
    expect(markup).toContain("1/2");
    expect(markup).toContain("conflict");
    expect(markup).not.toContain("lint");
    expect(markup).not.toContain("e2e (smoke)");
  });
});
