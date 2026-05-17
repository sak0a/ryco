import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DetectedServer } from "@ryco/contracts";
import { DetectedServerRow } from "./DetectedServerRow.tsx";

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

const renderRow = (server: DetectedServer, active = false) =>
  renderToStaticMarkup(
    <DetectedServerRow
      server={server}
      active={active}
      onSelect={noop}
      onOpen={noop}
      onCopy={noop}
      onStop={noop}
    />,
  );

describe("DetectedServerRow", () => {
  it.each([
    ["predicted", "bg-blue-500/20"],
    ["candidate", "bg-yellow-500/20"],
    ["confirmed", "bg-cyan-500/20"],
    ["live", "bg-green-500/20"],
    ["restarting", "bg-orange-500/20"],
    ["exited", "bg-muted"],
    ["crashed", "bg-red-500/20"],
  ] as const)("status pill class for %s contains %s", (status, cls) => {
    const markup = renderRow(make({ status }));
    expect(markup).toContain(cls);
  });

  it("hides Open and Copy buttons when the server has no url", () => {
    const markup = renderRow(make({ url: undefined }));
    expect(markup).not.toContain('aria-label="Open in browser"');
    expect(markup).not.toContain('aria-label="Copy URL"');
  });

  it("renders Open and Copy buttons when the server has a url", () => {
    const markup = renderRow(make({ url: "http://localhost:5173" }));
    expect(markup).toContain('aria-label="Open in browser"');
    expect(markup).toContain('aria-label="Copy URL"');
  });

  // The Tailwind class `disabled:opacity-30` itself contains the word "disabled",
  // so we look for the standalone `disabled=""` HTML attribute instead.
  const stopBtnDisabled = (markup: string): boolean =>
    /aria-label="Stop"[^>]* disabled=""/.test(markup);

  it("disables the Stop button when the server has exited", () => {
    expect(stopBtnDisabled(renderRow(make({ status: "exited" })))).toBe(true);
  });

  it("disables the Stop button when the server has crashed", () => {
    expect(stopBtnDisabled(renderRow(make({ status: "crashed" })))).toBe(true);
  });

  it("does not disable the Stop button for a live server", () => {
    expect(stopBtnDisabled(renderRow(make({ status: "live" })))).toBe(false);
  });

  it("appends the bg-accent class when active=true (atop the always-on hover variant)", () => {
    // The base button class ends with "hover:bg-accent". When active, the
    // bare "bg-accent" class is appended after it.
    const active = renderRow(make({}), true);
    const inactive = renderRow(make({}), false);
    expect(active.match(/\bbg-accent\b/g) ?? []).toHaveLength(2);
    expect(inactive.match(/\bbg-accent\b/g) ?? []).toHaveLength(1);
  });
});
