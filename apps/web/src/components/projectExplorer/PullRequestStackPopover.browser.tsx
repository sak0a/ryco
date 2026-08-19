import "../../index.css";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { PullRequestStackPopover } from "./PullRequestStackPopover";

const stack = {
  number: 7,
  size: 3,
  position: 2,
  baseRefName: "main",
  entries: [
    {
      position: 1,
      number: 41,
      title: "Foundation",
      url: "https://github.com/acme/widgets/pull/41",
      headRefName: "feature/41",
      baseRefName: "main",
      state: "open" as const,
      isDraft: false,
      mergeability: "mergeable" as const,
      mergeStateStatus: "CLEAN",
    },
    {
      position: 2,
      number: 42,
      title: "Middle",
      url: "https://github.com/acme/widgets/pull/42",
      headRefName: "feature/42",
      baseRefName: "feature/41",
      state: "open" as const,
      isDraft: false,
      mergeability: "mergeable" as const,
      mergeStateStatus: "CLEAN",
    },
    {
      position: 3,
      number: 43,
      title: "Top",
      url: "https://github.com/acme/widgets/pull/43",
      headRefName: "feature/43",
      baseRefName: "feature/42",
      state: "open" as const,
      isDraft: false,
      mergeability: "unknown" as const,
      mergeStateStatus: "UNKNOWN",
    },
  ],
};

describe("PullRequestStackPopover", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("displays entries top-to-bottom and navigates inside the dialog", async () => {
    const onSelectPullRequest = vi.fn();
    const screen = await render(
      <PullRequestStackPopover
        stack={stack}
        currentNumber={42}
        onSelectPullRequest={onSelectPullRequest}
      />,
    );
    try {
      await page.getByRole("button", { name: "View stack #7, pull request 2 of 3" }).click();
      const popup = await vi.waitFor(() => {
        const element = document.querySelector<HTMLElement>('[data-slot="popover-popup"]');
        expect(element).not.toBeNull();
        return element!;
      });
      const rows = [...popup.querySelectorAll<HTMLButtonElement>("button")];
      expect(rows.map((row) => row.textContent)).toEqual([
        expect.stringContaining("Top"),
        expect.stringContaining("Middle"),
        expect.stringContaining("Foundation"),
      ]);
      expect(rows[1]?.getAttribute("aria-current")).toBe("page");

      rows[0]?.click();
      await expect.poll(() => onSelectPullRequest.mock.calls).toEqual([[43]]);
    } finally {
      await screen.unmount();
    }
  });
});
