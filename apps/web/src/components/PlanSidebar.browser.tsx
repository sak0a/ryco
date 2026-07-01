import "../index.css";

import { EnvironmentId } from "@ryco/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { render } from "vitest-browser-react";

import PlanSidebar from "./PlanSidebar";
import { APPEARANCE_PREFERENCES_STORAGE_KEY } from "../themes/appearancePreferences";
import type { ThreadSubagentView } from "../threadWorkspaceViewModel";

describe("PlanSidebar overview panel", () => {
  // PlanSidebar reads `panelLayout` from persisted appearance preferences; keep
  // these cases on the default (stack) layout regardless of prior tests.
  beforeEach(() => {
    localStorage.removeItem(APPEARANCE_PREFERENCES_STORAGE_KEY);
  });
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
            status: "running",
            origin: null,
            capability: null,
            tool: "spawnAgent",
            detail: "Inspect one task.",
            providerThreadIds: ["child-thread-1"],
            providerSessionIds: [],
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
      status: index % 3 === 0 ? "finished" : "running",
      origin: null,
      capability: null,
      tool: "spawnAgent",
      detail: `Inspect task ${index + 1} and report progress.`,
      providerThreadIds: [`child-thread-${index}`],
      providerSessionIds: [],
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
      // The Subagents section is collapsed by default (matching the lab); expand
      // it so the long agent list overflows the viewport. Target it by label so
      // the test doesn't depend on section ordering.
      const subagentsHeader =
        Array.from(host.querySelectorAll<HTMLElement>("button[aria-expanded]")).find((button) =>
          (button.textContent ?? "").includes("Subagents"),
        ) ?? null;
      expect(subagentsHeader).not.toBeNull();
      subagentsHeader!.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));

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

  it("renders pull request checks inline in an expanded section", async () => {
    const host = document.createElement("div");
    host.style.width = "380px";
    host.style.height = "640px";
    document.body.append(host);

    const mounted = await render(
      <PlanSidebar
        activePlan={null}
        activeProposedPlan={null}
        pullRequest={{
          number: 124,
          title: "Consolidate chat right panel",
          state: "open",
          checkStatus: null,
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
      { container: host },
    );

    try {
      const text = host.textContent ?? "";
      expect(text).toContain("#124");
      expect(text).toContain("Branch");
      expect(text).toContain("Pull Request / Quality");

      const viewport = document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
      expect(viewport).not.toBeNull();
      expect(viewport!.className).toContain("[scrollbar-gutter:stable]");
    } finally {
      await mounted.unmount();
      host.remove();
    }
  });
});
