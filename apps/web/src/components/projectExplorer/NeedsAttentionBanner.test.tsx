import { describe, expect, it, vi } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";

import type { ItemAction } from "./itemActions";
import { NeedsAttentionBanner } from "./NeedsAttentionBanner";

const conflictAction: ItemAction = {
  kind: "pr-conflicts",
  badge: "Conflicts",
  summary: "This branch has merge conflicts with main",
  label: "Resolve in agent thread",
  severity: "warning",
};

const checksAction: ItemAction = {
  kind: "pr-checks",
  badge: "CI failing",
  summary: "build failing",
  label: "Fix checks",
  severity: "error",
};

describe("NeedsAttentionBanner", () => {
  it("renders nothing without actions", () => {
    const markup = renderToStaticMarkup(
      <NeedsAttentionBanner actions={[]} busyActionKind={null} onRun={vi.fn()} />,
    );
    expect(markup).toBe("");
  });

  it("renders one row per action with badges and buttons", () => {
    const markup = renderToStaticMarkup(
      <NeedsAttentionBanner
        actions={[conflictAction, checksAction]}
        busyActionKind={null}
        onRun={vi.fn()}
      />,
    );
    expect(markup).toContain("Conflicts");
    expect(markup).toContain("This branch has merge conflicts with main");
    expect(markup).toContain("Resolve in agent thread");
    expect(markup).toContain("CI failing");
    expect(markup).toContain("Fix checks");
  });

  it("disables the other buttons while one action is busy", () => {
    const markup = renderToStaticMarkup(
      <NeedsAttentionBanner
        actions={[conflictAction, checksAction]}
        busyActionKind="pr-checks"
        onRun={vi.fn()}
      />,
    );
    expect(markup).toContain("disabled");
    expect(markup).toContain("animate-spin");
  });
});
