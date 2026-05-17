import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DetectedServer } from "@ryco/contracts";
import { DetectedServersPanelView } from "./DetectedServersPanel.tsx";

const make = (overrides: Partial<DetectedServer>): DetectedServer => ({
  id: "s",
  threadId: "t",
  source: "pty",
  framework: "vite",
  status: "live",
  url: "http://localhost:5173",
  startedAt: new Date() as unknown as DetectedServer["startedAt"],
  lastSeenAt: new Date() as unknown as DetectedServer["lastSeenAt"],
  ...overrides,
});

const noop = () => {};

const renderView = (
  servers: DetectedServer[],
  activeId: string | null = null,
  handlers: Partial<{
    onSelect: (id: string) => void;
    onOpen: (id: string) => void;
    onCopy: (url: string) => void;
    onStop: (id: string) => void;
  }> = {},
) =>
  renderToStaticMarkup(
    <DetectedServersPanelView
      servers={servers}
      activeId={activeId}
      active={activeId ? (servers.find((s) => s.id === activeId) ?? null) : null}
      onSelect={handlers.onSelect ?? noop}
      onOpen={handlers.onOpen ?? noop}
      onCopy={handlers.onCopy ?? noop}
      onStop={handlers.onStop ?? noop}
    />,
  );

describe("DetectedServersPanelView", () => {
  it("renders the empty-state message when servers is empty", () => {
    const markup = renderView([]);
    expect(markup).toContain("No servers detected yet");
  });

  it("renders one row per server (matching the size of the input list)", () => {
    const markup = renderView([
      make({ id: "a", framework: "vite" }),
      make({ id: "b", framework: "next" }),
      make({ id: "c", framework: "remix" }),
    ]);
    expect(markup).toContain("vite");
    expect(markup).toContain("next");
    expect(markup).toContain("remix");
    expect((markup.match(/aria-label="Stop"/g) ?? []).length).toBe(3);
  });

  it("highlights the row whose id matches activeId via the appended bg-accent class", () => {
    // bg-accent appears once per row in the always-on `hover:bg-accent` token,
    // plus an additional bare `bg-accent` token on the active row only.
    const markupActive = renderView([make({ id: "a" }), make({ id: "b" })], "b");
    const markupNone = renderView([make({ id: "a" }), make({ id: "b" })], null);
    expect((markupActive.match(/\bbg-accent\b/g) ?? []).length).toBe(3);
    expect((markupNone.match(/\bbg-accent\b/g) ?? []).length).toBe(2);
  });

  it("vi noop sanity (placeholder for future onStop handler verification)", () => {
    const onStop = vi.fn();
    renderView([make({ id: "a" })], null, { onStop });
    // Static markup doesn't trigger handlers; this asserts the wiring shape only.
    expect(onStop).not.toHaveBeenCalled();
  });
});
