import "../index.css";

import { EnvironmentId } from "@ryco/contracts";
import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import PlanSidebar from "./PlanSidebar";

describe("PlanSidebar checks tooltip", () => {
  it("opens latest check details from an all-passed summary row", async () => {
    const mounted = await render(
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

    try {
      await page.getByText("All checks passed").hover();

      await vi.waitFor(
        () => {
          const tooltip = document.querySelector<HTMLElement>('[data-slot="tooltip-popup"]');
          expect(tooltip).not.toBeNull();
          expect(tooltip?.textContent).toContain("Latest checks");
          expect(tooltip?.textContent).toContain("Branch");
          expect(tooltip?.textContent).toContain("Skipped");
          expect(tooltip?.textContent).toContain("Pull Request / Quality");
          expect(tooltip?.textContent).toContain("Succeeded");
        },
        { timeout: 1_000, interval: 16 },
      );
    } finally {
      await mounted.unmount();
    }
  });
});
