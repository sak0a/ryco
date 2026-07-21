// Production CSS is part of the behavior under test: sheet row heights and
// destructive styling drive the touch-target assertions.
import "../../../index.css";

import type { ContextMenuItem } from "@ryco/contracts";
import { page, userEvent } from "vite-plus/test/browser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import {
  __resetContextMenuSheetForTests,
  presentContextMenuSheet,
} from "../../../contextMenuSheetState";
import { getPresentationTier, syncDocumentPresentationTier } from "../../../lib/presentationTier";
import { __resetLocalApiForTests, readLocalApi } from "../../../localApi";
import { ContextMenuActionSheetHost } from "./ContextMenuActionSheetHost";

/**
 * The desktop context-menu inventory, mirrored from every non-Electron
 * `api.contextMenu.show(...)` producer in the app. The table asserts that
 * each descriptor set the desktop DOM menu can show has a touch path on the
 * phone tier: every leaf action becomes a >=44px action-sheet row.
 */
const DESKTOP_CONTEXT_MENU_INVENTORY: ReadonlyArray<{
  readonly producer: string;
  readonly items: readonly ContextMenuItem<string>[];
}> = [
  {
    producer: "sidebar thread multi-select (useSidebarThreadActions)",
    items: [
      { id: "mark-unread", label: "Mark unread (2)" },
      { id: "delete", label: "Delete (2)", destructive: true },
    ],
  },
  {
    producer: "chat file link (ChatMarkdown)",
    items: [
      { id: "open", label: "Open in editor" },
      { id: "copy-relative", label: "Copy relative path" },
      { id: "copy-full", label: "Copy full path" },
    ],
  },
  {
    producer: "terminal selection (ThreadTerminalDrawer)",
    items: [{ id: "add-to-chat", label: "Add to chat" }],
  },
  {
    producer: "terminal tab (ThreadTerminalDrawer)",
    items: [{ id: "close-tab", label: "Close Terminal 1", destructive: true }],
  },
  {
    producer: "archived thread (SettingsPanels)",
    items: [
      { id: "unarchive", label: "Unarchive" },
      { id: "delete", label: "Delete", destructive: true },
    ],
  },
];

function sheetPopup(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="sheet-popup"]');
}

function sheetRow(label: string): HTMLButtonElement | null {
  const popup = sheetPopup();
  if (!popup) return null;
  return (
    [...popup.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === label,
    ) ?? null
  );
}

let mounted: Awaited<ReturnType<typeof render>> | null = null;

describe("ContextMenuActionSheetHost", () => {
  beforeAll(() => {
    syncDocumentPresentationTier();
  });

  beforeEach(async () => {
    await page.viewport(390, 844);
    await vi.waitFor(() => {
      expect(getPresentationTier()).toBe("phone");
    });
  });

  afterEach(async () => {
    __resetContextMenuSheetForTests();
    await mounted?.unmount();
    mounted = null;
    await __resetLocalApiForTests();
    document.body.innerHTML = "";
    await page.viewport(1_280, 720);
  });

  it("presents every desktop context-menu descriptor set with touch-sized rows and resolves the tapped action", async () => {
    mounted = await render(<ContextMenuActionSheetHost />);

    for (const entry of DESKTOP_CONTEXT_MENU_INVENTORY) {
      const resolution = presentContextMenuSheet(entry.items);

      for (const item of entry.items) {
        const row = await vi.waitFor(() => {
          const found = sheetRow(item.label);
          expect(found, `${entry.producer}: row "${item.label}"`).not.toBeNull();
          return found!;
        });
        expect(
          row.getBoundingClientRect().height,
          `${entry.producer}: touch target for "${item.label}"`,
        ).toBeGreaterThanOrEqual(44);
        if (item.destructive) {
          expect(row.className).toContain("text-destructive");
        }
      }

      const [firstItem] = entry.items;
      sheetRow(firstItem!.label)!.click();
      await expect(resolution).resolves.toBe(firstItem!.id);
      await vi.waitFor(() => {
        expect(sheetPopup()).toBeNull();
      });
    }
  });

  it("drills into submenus and back instead of relying on hover", async () => {
    mounted = await render(<ContextMenuActionSheetHost />);

    const resolution = presentContextMenuSheet([
      { id: "project-overview", label: "Project overview" },
      {
        id: "settings:submenu",
        label: "Project settings",
        children: [
          { id: "settings:alpha", label: "Alpha (this project)" },
          { id: "settings:beta", label: "Beta" },
        ],
      },
    ]);

    await vi.waitFor(() => {
      expect(sheetRow("Project settings")).not.toBeNull();
    });
    sheetRow("Project settings")!.click();

    await vi.waitFor(() => {
      expect(sheetRow("Alpha (this project)")).not.toBeNull();
    });
    // Drill-in moves focus to the first row of the new level (Back).
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(sheetRow("Back"));
    });
    // Back returns to the top level without settling the request and moves
    // focus to the level's first row.
    sheetRow("Back")!.click();
    await vi.waitFor(() => {
      expect(sheetRow("Project overview")).not.toBeNull();
    });
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(sheetRow("Project overview"));
    });
    sheetRow("Project settings")!.click();
    await vi.waitFor(() => {
      expect(sheetRow("Beta")).not.toBeNull();
    });
    sheetRow("Beta")!.click();
    await expect(resolution).resolves.toBe("settings:beta");
  });

  it("traps focus while open and resolves null on Escape", async () => {
    mounted = await render(<ContextMenuActionSheetHost />);

    const resolution = presentContextMenuSheet([
      { id: "one", label: "First action" },
      { id: "two", label: "Second action" },
    ]);

    const popup = await vi.waitFor(() => {
      const found = sheetPopup();
      expect(found).not.toBeNull();
      return found!;
    });
    await vi.waitFor(() => {
      expect(popup.contains(document.activeElement)).toBe(true);
    });
    for (let index = 0; index < 6; index += 1) {
      await userEvent.keyboard("{Tab}");
      expect(popup.contains(document.activeElement)).toBe(true);
    }

    await userEvent.keyboard("{Escape}");
    await expect(resolution).resolves.toBeNull();
    await vi.waitFor(() => {
      expect(sheetPopup()).toBeNull();
    });
  });

  it("routes localApi context menus through the sheet on the phone tier and keeps the DOM fallback on desktop", async () => {
    mounted = await render(<ContextMenuActionSheetHost />);

    // Phone tier: api.contextMenu.show(...) presents the bottom sheet.
    const phoneApi = readLocalApi();
    expect(phoneApi).toBeDefined();
    const phoneResolution = phoneApi!.contextMenu.show([
      { id: "open", label: "Open in editor" },
      { id: "copy-full", label: "Copy full path" },
    ] as const);
    await vi.waitFor(() => {
      expect(sheetRow("Open in editor")).not.toBeNull();
    });
    sheetRow("Open in editor")!.click();
    await expect(phoneResolution).resolves.toBe("open");

    // Desktop tier: the same call keeps the existing DOM fallback menu.
    await page.viewport(1_280, 720);
    await vi.waitFor(() => {
      expect(getPresentationTier()).toBe("desktop");
    });
    const desktopResolution = phoneApi!.contextMenu.show(
      [
        { id: "open", label: "Open in editor" },
        { id: "copy-full", label: "Copy full path" },
      ] as const,
      { x: 40, y: 40 },
    );
    const fallbackButton = await vi.waitFor(() => {
      expect(sheetPopup()).toBeNull();
      const button = [
        ...document.querySelectorAll<HTMLButtonElement>(".z-\\[10000\\] button"),
      ].find((candidate) => candidate.textContent?.trim() === "Open in editor");
      expect(button).toBeDefined();
      return button!;
    });
    fallbackButton.click();
    await expect(desktopResolution).resolves.toBe("open");
  });
});
