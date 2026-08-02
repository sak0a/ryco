import "../../index.css";

import type { ProviderInstanceEntry } from "@ryco/client-runtime/state/composer";
import type { ThreadInboxEntry } from "@ryco/client-runtime/state/threads";
import { FolderIcon, MonitorIcon } from "lucide-react";
import { useState } from "react";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { describe, expect, it, vi } from "vite-plus/test";

import { CommandDialog, CommandDialogPopup } from "../ui/command";
import { SidebarProvider } from "../ui/sidebar";
import { InboxFilterCombobox } from "./inbox/InboxFilterCombobox";
import { SidebarInboxFilters } from "./inbox/SidebarInboxFilters";
import { SidebarInboxRow } from "./inbox/SidebarInboxRow";
import { SidebarGlobalSearch } from "./SidebarGlobalSearch";
import { SidebarViewToggle } from "./SidebarViewToggle";

describe("SidebarGlobalSearch", () => {
  it("stays available across views and opens the command palette", async () => {
    function Harness() {
      const [view, setView] = useState<"workspace" | "inbox">("workspace");
      return (
        <SidebarProvider>
          <CommandDialog>
            <SidebarGlobalSearch shortcutLabel="⌘ K" />
            <SidebarViewToggle onChange={setView} value={view} />
            <CommandDialogPopup>
              <div data-testid="shared-search-popup">Global search</div>
            </CommandDialogPopup>
          </CommandDialog>
        </SidebarProvider>
      );
    }

    await render(<Harness />);

    await expect
      .element(page.getByRole("button", { name: "Search Ryco" }))
      .toHaveTextContent("⌘ K");
    await page.getByRole("tab", { name: "Inbox" }).click();
    await page.getByRole("button", { name: "Search Ryco" }).click();
    await expect.element(page.getByTestId("shared-search-popup")).toBeVisible();
  });
});

describe("SidebarViewToggle", () => {
  it("exposes the selected view and switches with a click", async () => {
    const onChange = vi.fn();
    await render(<SidebarViewToggle value="workspace" onChange={onChange} />);

    await expect
      .element(page.getByRole("tab", { name: "Workspace" }))
      .toHaveAttribute("aria-selected", "true");
    const selected = document.querySelector<HTMLElement>("#sidebar-workspace-tab");
    const unselected = document.querySelector<HTMLElement>("#sidebar-inbox-tab");
    expect(selected).toBeTruthy();
    expect(unselected).toBeTruthy();
    expect(getComputedStyle(selected!).borderTopWidth).toBe("1px");
    expect(getComputedStyle(selected!).backgroundColor).not.toBe(
      getComputedStyle(unselected!).backgroundColor,
    );
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
  it("keeps distinct resting and current card surfaces without hover reflow", async () => {
    await render(
      <div className="w-72">
        <SidebarInboxRow
          entry={makeEntry("active")}
          onNavigate={vi.fn()}
          onSettle={vi.fn().mockResolvedValue(true)}
          onUnsettle={vi.fn().mockResolvedValue(true)}
          showEnvironment={false}
        />
        <SidebarInboxRow
          entry={{ ...makeEntry("active"), current: true, key: "environment-local:thread-2" }}
          onNavigate={vi.fn()}
          onSettle={vi.fn().mockResolvedValue(true)}
          onUnsettle={vi.fn().mockResolvedValue(true)}
          showEnvironment={false}
        />
      </div>,
    );

    const resting = document.querySelector<HTMLElement>(
      '[data-thread-key="environment-local:thread-1"]',
    );
    const current = document.querySelector<HTMLElement>(
      '[data-thread-key="environment-local:thread-2"]',
    );
    expect(resting).toBeTruthy();
    expect(current).toBeTruthy();
    const restingStyle = getComputedStyle(resting!);
    const currentStyle = getComputedStyle(current!);
    expect(restingStyle.borderTopWidth).toBe("1px");
    expect(restingStyle.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(currentStyle.backgroundColor).not.toBe(restingStyle.backgroundColor);

    const beforeHover = resting!.getBoundingClientRect();
    await page.getByText("Ship Inbox").first().hover();
    const afterHover = resting!.getBoundingClientRect();
    expect(afterHover.width).toBe(beforeHover.width);
    expect(afterHover.height).toBe(beforeHover.height);
  });

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

    await page.getByText("Ship Inbox").hover();
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

    const providerIndicator = document.querySelector<HTMLElement>(
      '[data-testid="inbox-row-provider"]',
    );
    const row = document.querySelector<HTMLElement>(
      '[data-thread-key="environment-local:thread-1"]',
    );
    const navigationButton = row?.querySelector<HTMLElement>(
      'button:not([data-testid="inbox-row-action-slot"])',
    );
    expect(providerIndicator).toBeTruthy();
    expect(row).toBeTruthy();
    expect(navigationButton).toBeTruthy();
    expect(navigationButton?.getBoundingClientRect().left).toBe(
      row!.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(row!).borderLeftWidth),
    );
    const providerLeftBeforeHover = providerIndicator?.getBoundingClientRect().left;

    await expect.element(page.getByText("Ryco")).toBeVisible();
    await expect.element(page.getByText("Error")).toBeVisible();
    await page.getByText("Ship Inbox").hover();
    await expect.element(page.getByText("Codex Work · GPT-5.6")).toBeVisible();
    await expect.element(page.getByText("Provider connection failed")).toBeVisible();
    await expect.element(page.getByText("Inbox worktree", { exact: true })).toBeVisible();
    expect(providerIndicator?.getBoundingClientRect().left).toBe(providerLeftBeforeHover);
  });
});

describe("InboxFilterCombobox", () => {
  it("shows option artwork and selects a project without a native select", async () => {
    function Harness() {
      const [value, setValue] = useState("all");
      return (
        <InboxFilterCombobox
          allArtwork={<FolderIcon data-testid="all-projects-artwork" />}
          allLabel="Project"
          category="project"
          onChange={setValue}
          options={[
            {
              value: "ryco",
              label: "Ryco",
              artwork: <FolderIcon data-testid="ryco-project-artwork" />,
            },
          ]}
          value={value}
        />
      );
    }

    await render(<Harness />);
    expect(document.querySelector("select")).toBeNull();
    const trigger = page.getByTitle("Project: Project");
    await expect.element(trigger).toHaveAttribute("aria-label", "Filter by project: Project");
    await trigger.click();
    await expect.element(page.getByTestId("ryco-project-artwork")).toBeVisible();
    await page.getByRole("option", { name: "Ryco" }).click();
    await expect.element(page.getByTitle("Project: Ryco")).toBeVisible();
    await page.getByTitle("Project: Ryco").click();
    const selectedOption = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (option) => option.textContent?.includes("Ryco"),
    );
    const selectedArtwork = selectedOption?.querySelector<HTMLElement>(
      '[data-testid="ryco-project-artwork"]',
    );
    const selectedIndicator = selectedOption?.querySelector<HTMLElement>(
      '[data-slot="combobox-item-indicator"]',
    );
    expect(selectedArtwork).toBeTruthy();
    expect(selectedIndicator).toBeTruthy();
    expect(selectedIndicator!.getBoundingClientRect().left).toBeGreaterThan(
      selectedArtwork!.getBoundingClientRect().right,
    );
  });

  it("adds option search for long lists and supports keyboard selection", async () => {
    function Harness() {
      const [value, setValue] = useState("all");
      return (
        <InboxFilterCombobox
          allArtwork={<MonitorIcon />}
          allLabel="Environment"
          category="environment"
          onChange={setValue}
          options={Array.from({ length: 7 }, (_, index) => ({
            value: `environment-${index + 1}`,
            label: `Environment ${index + 1}`,
            artwork: <MonitorIcon />,
          }))}
          value={value}
        />
      );
    }

    await render(<Harness />);
    const trigger = page.getByTitle("Environment: Environment");
    await trigger.click();
    const search = page.getByRole("combobox", { name: "Search environment options" });
    await expect.element(search).toBeVisible();
    await search.fill("Environment 7");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect.element(page.getByTitle("Environment: Environment 7")).toBeVisible();
  });

  it("collapses only its label below the compact container threshold", async () => {
    function Harness() {
      const [wide, setWide] = useState(false);
      return (
        <>
          <button onClick={() => setWide(true)} type="button">
            Widen
          </button>
          <div style={{ width: wide ? "6rem" : "5rem" }}>
            <InboxFilterCombobox
              allArtwork={<FolderIcon data-testid="compact-project-artwork" />}
              allLabel="Project"
              category="project"
              onChange={vi.fn()}
              options={[]}
              value="all"
            />
          </div>
        </>
      );
    }

    await render(<Harness />);
    const trigger = page.getByTitle("Project: Project");
    await expect.element(trigger).toHaveAttribute("aria-label", "Filter by project: Project");
    expect(
      document.querySelector<HTMLElement>('[title="Project: Project"]')?.getBoundingClientRect()
        .height,
    ).toBe(24);
    await expect.element(page.getByTestId("compact-project-artwork")).toBeVisible();
    await expect.element(page.getByTestId("inbox-filter-chevron")).toBeVisible();
    await expect.element(page.getByTestId("inbox-filter-label")).not.toBeVisible();
    await page.getByRole("button", { name: "Widen" }).click();
    await expect.element(page.getByTestId("inbox-filter-label")).toBeVisible();
  });
});

describe("SidebarInboxFilters", () => {
  it("centers the local thread-search input inside its wrapper", async () => {
    await render(
      <SidebarInboxFilters
        environment="all"
        environmentOptions={[]}
        onEnvironmentChange={vi.fn()}
        onProjectChange={vi.fn()}
        onTextChange={vi.fn()}
        onWorktreeChange={vi.fn()}
        project="all"
        projectOptions={[]}
        text=""
        worktree="all"
        worktreeOptions={[]}
      />,
    );

    const input = document.querySelector<HTMLInputElement>('[aria-label="Search Inbox"]');
    const wrapper = input?.parentElement;
    const icon = document.querySelector<HTMLElement>('[data-testid="inbox-search-icon"]');
    expect(input).toBeTruthy();
    expect(wrapper).toBeTruthy();
    expect(icon).toBeTruthy();
    expect(input!.getBoundingClientRect().height).toBe(wrapper!.getBoundingClientRect().height);
    expect(input!.getBoundingClientRect().height).toBe(28);
    expect(Number.parseFloat(getComputedStyle(input!).lineHeight)).toBe(28);
    expect(Number.parseFloat(getComputedStyle(input!).paddingLeft)).toBeGreaterThanOrEqual(
      icon!.getBoundingClientRect().right - input!.getBoundingClientRect().left + 4,
    );
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
