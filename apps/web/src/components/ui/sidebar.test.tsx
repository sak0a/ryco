import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  Sidebar,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuSubButton,
  SidebarProvider,
} from "./sidebar";

function renderSidebarButton(className?: string) {
  return renderToStaticMarkup(
    <SidebarProvider>
      <SidebarMenuButton className={className}>Projects</SidebarMenuButton>
    </SidebarProvider>,
  );
}

describe("sidebar interactive cursors", () => {
  it("uses a pointer cursor for menu buttons by default", () => {
    const html = renderSidebarButton();

    expect(html).toContain('data-slot="sidebar-menu-button"');
    expect(html).toContain("cursor-pointer");
  });

  it("lets project drag handles override the default pointer cursor", () => {
    const html = renderSidebarButton("cursor-grab");

    expect(html).toContain("cursor-grab");
    expect(html).not.toContain("cursor-pointer");
  });

  it("uses a pointer cursor for menu actions", () => {
    const html = renderToStaticMarkup(
      <SidebarMenuAction aria-label="Create thread">
        <span>+</span>
      </SidebarMenuAction>,
    );

    expect(html).toContain('data-slot="sidebar-menu-action"');
    expect(html).toContain("cursor-pointer");
  });

  it("uses a pointer cursor for submenu buttons", () => {
    const html = renderToStaticMarkup(
      <SidebarMenuSubButton render={<button type="button" />}>Show more</SidebarMenuSubButton>,
    );

    expect(html).toContain('data-slot="sidebar-menu-sub-button"');
    expect(html).toContain("cursor-pointer");
  });
});

function renderSidebar(props: { maximized?: boolean }) {
  return renderToStaticMarkup(
    <SidebarProvider>
      <Sidebar side="right" resizable {...props}>
        <span>Workspace</span>
      </Sidebar>
    </SidebarProvider>,
  );
}

describe("maximized sidebar geometry", () => {
  it("keeps the off-canvas geometry by default", () => {
    const html = renderSidebar({});

    expect(html).toContain('data-slot="sidebar-gap"');
    expect(html).toContain("fixed");
    expect(html).toContain("w-(--sidebar-width)");
    expect(html).not.toContain('data-maximized="true"');
  });

  it("drops the fixed geometry and the reserved gap while maximized", () => {
    const html = renderSidebar({ maximized: true });

    expect(html).toContain('data-maximized="true"');
    // The gap element still renders (the DOM shape is stable so panel content
    // never remounts) but reserves nothing.
    expect(html).toContain('data-slot="sidebar-gap"');
    expect(html).toContain("hidden");
    expect(html).not.toContain("fixed");
    // Sized by the parent instead of the sidebar width variable.
    expect(html).toContain("flex-1");
  });
});
