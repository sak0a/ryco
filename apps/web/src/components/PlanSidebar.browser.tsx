import "../index.css";

import { EnvironmentId } from "@ryco/contracts";
import { page } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import PlanSidebar from "./PlanSidebar";
import type { ThreadSubagentView } from "../threadWorkspaceViewModel";

describe("PlanSidebar checks tooltip", () => {
  it("keeps the sidebar content-sized when overview content is short", async () => {
    const host = document.createElement("div");
    host.style.width = "380px";
    host.style.height = "640px";
    document.body.append(host);

    const mounted = await render(
      <PlanSidebar
        activePlan={null}
        activeProposedPlan={null}
        subagents={[
          {
            key: "subagent:researcher",
            name: "Researcher",
            accentColor: "#2563eb",
            status: "running",
            tool: "spawnAgent",
            detail: "Inspect one task.",
            providerThreadIds: ["child-thread-1"],
            startedAt: "2026-06-04T10:00:00.000Z",
            updatedAt: "2026-06-04T10:00:00.000Z",
            entries: [],
            messages: [],
          },
        ]}
        environmentId={EnvironmentId.make("environment-local")}
        markdownCwd={undefined}
        workspaceRoot={undefined}
        mode="sidebar"
      />,
      { container: host },
    );

    try {
      const sidebar = host.firstElementChild as HTMLElement | null;

      expect(sidebar).not.toBeNull();
      expect(sidebar!.getBoundingClientRect().height).toBeGreaterThan(40);
      expect(sidebar!.getBoundingClientRect().height).toBeLessThan(260);
    } finally {
      await mounted.unmount();
      host.remove();
    }
  });

  it("scrolls the overview sidebar when many subagents are visible", async () => {
    const host = document.createElement("div");
    host.style.width = "380px";
    host.style.height = "360px";
    document.body.append(host);

    const subagents: ThreadSubagentView[] = Array.from({ length: 30 }, (_, index) => ({
      key: `subagent:${index}`,
      name: `Researcher ${index + 1}`,
      accentColor: "#2563eb",
      status: index % 3 === 0 ? "finished" : "running",
      tool: "spawnAgent",
      detail: `Inspect task ${index + 1} and report progress.`,
      providerThreadIds: [`child-thread-${index}`],
      startedAt: "2026-06-04T10:00:00.000Z",
      updatedAt: "2026-06-04T10:00:00.000Z",
      entries: [],
      messages: [],
    }));

    const mounted = await render(
      <PlanSidebar
        activePlan={null}
        activeProposedPlan={null}
        subagents={subagents}
        environmentId={EnvironmentId.make("environment-local")}
        markdownCwd={undefined}
        workspaceRoot={undefined}
        mode="sidebar"
      />,
      { container: host },
    );

    try {
      const viewport = document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');

      expect(viewport).not.toBeNull();
      expect(viewport!.clientHeight).toBeGreaterThan(0);
      expect(viewport!.scrollHeight).toBeGreaterThan(viewport!.clientHeight);

      viewport!.scrollTop = viewport!.scrollHeight;
      await new Promise((resolve) => requestAnimationFrame(resolve));

      expect(viewport!.scrollTop).toBeGreaterThan(0);
    } finally {
      await mounted.unmount();
      host.remove();
    }
  });

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

      const viewport = document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
      expect(viewport).not.toBeNull();
      expect(viewport!.className).toContain("[scrollbar-gutter:stable]");
    } finally {
      await mounted.unmount();
    }
  });
});
