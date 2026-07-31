import type { ProviderInstanceEntry } from "@ryco/client-runtime/state/composer";
import type { ThreadInboxEntry } from "@ryco/client-runtime/state/threads";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { describe, expect, it, vi } from "vite-plus/test";

import { SidebarInboxRow } from "./inbox/SidebarInboxRow";
import { SidebarViewToggle } from "./SidebarViewToggle";

describe("SidebarViewToggle", () => {
  it("exposes the selected view and switches with a click", async () => {
    const onChange = vi.fn();
    await render(<SidebarViewToggle value="workspace" onChange={onChange} />);

    await expect
      .element(page.getByRole("tab", { name: "Workspace" }))
      .toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Inbox" }).click();

    expect(onChange).toHaveBeenCalledWith("inbox");
  });

  it("supports arrow-key switching", async () => {
    const onChange = vi.fn();
    await render(<SidebarViewToggle value="workspace" onChange={onChange} />);

    await page.getByRole("tab", { name: "Workspace" }).click();
    await userEvent.keyboard("{ArrowRight}");

    expect(onChange).toHaveBeenCalledWith("inbox");
  });
});

describe("SidebarInboxRow", () => {
  it("moves a settled row back to Active", async () => {
    const onUnsettle = vi.fn().mockResolvedValue(true);
    await render(
      <SidebarInboxRow
        entry={makeEntry("settled")}
        onNavigate={vi.fn()}
        onSettle={vi.fn().mockResolvedValue(true)}
        onUnsettle={onUnsettle}
        showEnvironment
      />,
    );

    await page.getByRole("button", { name: "Move to Active: Ship Inbox" }).click();
    expect(onUnsettle).toHaveBeenCalledOnce();
  });

  it("keeps settlement unavailable while an approval is pending", async () => {
    await render(
      <SidebarInboxRow
        entry={makeEntry("active", "pending-approval")}
        onNavigate={vi.fn()}
        onSettle={vi.fn().mockResolvedValue(true)}
        onUnsettle={vi.fn().mockResolvedValue(true)}
        showEnvironment={false}
      />,
    );

    await expect
      .element(page.getByRole("button", { name: "Settle thread: Ship Inbox" }))
      .toBeDisabled();
  });

  it("shows rich project, workspace, provider, model, and failure details on hover", async () => {
    const entry = {
      ...makeEntry("active"),
      thread: {
        title: "Ship Inbox",
        modelSelection: { instanceId: "codex", model: "gpt-5.6-codex" },
        session: null,
        error: "Provider connection failed",
        branch: "feat/inbox",
        worktreePath: "/repo/inbox",
      },
      project: {
        id: "project-1",
        environmentId: "environment-local",
        name: "Ryco",
        cwd: "/repo",
        defaultModelSelection: null,
        scripts: [],
      },
      worktree: {
        title: "Inbox worktree",
        branch: "feat/inbox",
        worktreePath: "/repo/inbox",
        prState: "open",
      },
    } as unknown as ThreadInboxEntry;
    const providerEntry = {
      instanceId: "codex",
      driverKind: "codex",
      displayName: "Codex Work",
      models: [{ slug: "gpt-5.6-codex", name: "GPT-5.6 Codex", shortName: "GPT-5.6" }],
    } as unknown as ProviderInstanceEntry;

    await render(
      <SidebarInboxRow
        entry={entry}
        onNavigate={vi.fn()}
        onSettle={vi.fn().mockResolvedValue(true)}
        onUnsettle={vi.fn().mockResolvedValue(true)}
        providerEntryByInstanceId={new Map([["codex", providerEntry]])}
        showEnvironment
      />,
    );

    await expect.element(page.getByText("Ryco")).toBeVisible();
    await expect.element(page.getByText("Error")).toBeVisible();
    await page.getByText("Ship Inbox").hover();
    await expect.element(page.getByText("Codex Work · GPT-5.6")).toBeVisible();
    await expect.element(page.getByText("Provider connection failed")).toBeVisible();
    await expect.element(page.getByText("Inbox worktree", { exact: true })).toBeVisible();
  });
});

function makeEntry(
  classification: "active" | "settled",
  blocker: ThreadInboxEntry["lifecycle"]["settlementBlocker"] = null,
): ThreadInboxEntry {
  return {
    key: "environment-local:thread-1",
    ref: { environmentId: "environment-local", threadId: "thread-1" },
    thread: null,
    draft: null,
    title: "Ship Inbox",
    createdAt: "2026-07-31T10:00:00.000Z",
    project: null,
    worktree: null,
    environment: {
      environmentId: "environment-local",
      label: "Local",
      threadSettlementSupported: true,
      connected: true,
      mutationReady: true,
      shellCurrent: true,
    },
    lifecycle: {
      classification,
      eligibility: blocker ? { canSettle: false, blocker } : { canSettle: true, blocker: null },
      effectiveSettlementTimestamp:
        classification === "settled" ? "2026-07-31T11:00:00.000Z" : null,
      settlementBlocker: blocker,
    },
    mutationEnabled: true,
    mutationBlocker: null,
    pinned: false,
    current: false,
    isDraft: false,
  } as ThreadInboxEntry;
}
