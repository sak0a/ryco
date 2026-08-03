import "../../index.css";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { deriveContextWindowUsage } from "../../lib/contextWindow";
import { ComposerFooterPrimaryActions } from "./ComposerFooter";

describe("ComposerFooterPrimaryActions", () => {
  let mounted: Awaited<ReturnType<typeof render>> | null = null;

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    document.body.innerHTML = "";
  });

  it("shows the selected context limit before the first message", async () => {
    mounted = await render(
      <ComposerFooterPrimaryActions
        compact
        contextWindowUsage={deriveContextWindowUsage([], "200k")}
        contextWindowRateLimits={undefined}
        isPreparingWorktree={false}
        pendingAction={null}
        isRunning={false}
        showPlanFollowUpPrompt={false}
        promptHasText={false}
        isSendBusy={false}
        isConnecting={false}
        isEnvironmentUnavailable={false}
        hasSendableContent={false}
        onPreviousPendingQuestion={() => {}}
        onInterrupt={() => {}}
        onImplementPlanInNewThread={() => {}}
      />,
    );

    const ring = page.getByRole("button", { name: "Context window 0% used" });
    await expect.element(ring).toBeVisible();

    await ring.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("0%⋅0/200k context used");
    });
  });

  it("keeps an unknown initial context limit compact", async () => {
    mounted = await render(
      <ComposerFooterPrimaryActions
        compact
        contextWindowUsage={deriveContextWindowUsage([], undefined)}
        contextWindowRateLimits={undefined}
        isPreparingWorktree={false}
        pendingAction={null}
        isRunning={false}
        showPlanFollowUpPrompt={false}
        promptHasText={false}
        isSendBusy={false}
        isConnecting={false}
        isEnvironmentUnavailable={false}
        hasSendableContent={false}
        onPreviousPendingQuestion={() => {}}
        onInterrupt={() => {}}
        onImplementPlanInNewThread={() => {}}
      />,
    );

    const ring = page.getByRole("button", { name: "Context window 0 tokens used" });
    await expect.element(ring).toBeVisible();

    await ring.click();
    await vi.waitFor(() => {
      const usageRow = Array.from(document.querySelectorAll(".text-xs")).find(
        (element) => element.textContent === "0 context used",
      );
      expect(usageRow).toBeDefined();
    });
  });
});
