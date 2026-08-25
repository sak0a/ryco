import "../../index.css";

import type { EnvironmentApi } from "@ryco/contracts";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@ryco/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../../environmentApi";
import { InboxSidebar } from "./InboxSidebar";

const ENVIRONMENT_ID = EnvironmentId.make("environment-hover-card");
const PROJECT_ID = ProjectId.make("project-hover-card");
const THREAD_ID = ThreadId.make("thread-hover-card");

describe("Inbox sidebar settlement", () => {
  afterEach(() => {
    __resetEnvironmentApiOverridesForTests();
    document.body.innerHTML = "";
  });

  it("anchors detail information to the row's right and dispatches scoped settlement", async () => {
    await page.viewport(1_280, 800);
    const dispatchCommand = vi.fn(async (_command: unknown) => undefined);
    __setEnvironmentApiOverrideForTests(ENVIRONMENT_ID, {
      orchestration: { dispatchCommand },
    } as unknown as EnvironmentApi);
    const host = document.createElement("div");
    host.style.width = "320px";
    host.style.height = "720px";
    document.body.append(host);

    const mounted = await render(
      <InboxSidebar
        projects={[
          {
            environmentId: ENVIRONMENT_ID,
            id: PROJECT_ID,
            name: "Ryco",
            cwd: "/repo/ryco",
            defaultModelSelection: null,
            scripts: [],
          },
        ]}
        worktrees={[]}
        threads={[
          {
            environmentId: ENVIRONMENT_ID,
            id: THREAD_ID,
            projectId: PROJECT_ID,
            title: "Hover target",
            modelSelection: {
              instanceId: ProviderInstanceId.make("codex"),
              model: "gpt-5.4",
            },
            interactionMode: "default",
            session: null,
            createdAt: "2026-08-25T00:00:00.000Z",
            archivedAt: null,
            updatedAt: "2026-08-25T00:00:00.000Z",
            latestTurn: null,
            branch: "feat/settle",
            worktreePath: null,
            latestUserMessageAt: null,
            hasPendingApprovals: false,
            hasPendingUserInput: false,
            hasActionableProposedPlan: false,
          },
        ]}
        environments={[
          {
            environmentId: ENVIRONMENT_ID,
            label: "This device",
            connectionState: "connected",
            stale: false,
            role: "owner",
            trust: "not-required",
            deliveryUnknown: false,
            threadSettlementSupported: true,
            mutationReady: true,
            shellCurrent: true,
          },
        ]}
        deliveryUnknownThreadKeys={new Set()}
        localQueuedThreadKeys={new Set()}
        activeThreadKey={null}
        onOpenThread={() => undefined}
      />,
      { container: host },
    );

    try {
      const row = page.getByTestId("inbox-thread-row");
      await row.hover();
      await vi.waitFor(() => {
        expect(document.querySelector('[data-slot="tooltip-popup"]')).not.toBeNull();
      });
      const rowElement = document.querySelector<HTMLElement>('[data-testid="inbox-thread-row"]')!;
      const popup = document.querySelector<HTMLElement>('[data-slot="tooltip-popup"]')!;
      expect(
        [...rowElement.children].some(
          (child) => child.classList.contains("absolute") && child.classList.contains("left-0"),
        ),
      ).toBe(false);
      expect(popup.textContent).toContain("Hover target");
      expect(popup.textContent).toContain("This device");
      expect(popup.textContent).toContain("feat/settle");
      expect(popup.textContent).toContain("Codex · gpt-5.4");
      expect(popup.getBoundingClientRect().width).toBeLessThanOrEqual(290);
      expect(popup.getBoundingClientRect().left).toBeGreaterThanOrEqual(
        rowElement.getBoundingClientRect().right,
      );

      await page.getByRole("button", { name: "Settle Hover target" }).click();
      await vi.waitFor(() => expect(dispatchCommand).toHaveBeenCalledTimes(1));
      expect(dispatchCommand.mock.calls[0]![0]).toMatchObject({
        type: "thread.settle",
        threadId: THREAD_ID,
      });
    } finally {
      await mounted.unmount();
      host.remove();
    }
  });
});
