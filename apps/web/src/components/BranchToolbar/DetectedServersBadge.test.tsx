import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { DetectedServersBadge } from "./DetectedServersBadge.tsx";
import type { DetectedServer } from "@ryco/contracts";

const make = (overrides: Partial<DetectedServer>): DetectedServer => ({
  id: "s",
  threadId: "t",
  source: "pty",
  framework: "vite",
  status: "live",
  startedAt: new Date() as any,
  lastSeenAt: new Date() as any,
  ...overrides,
});

describe("DetectedServersBadge", () => {
  it("renders nothing when no servers", () => {
    const markup = renderToStaticMarkup(<DetectedServersBadge servers={[]} onClick={() => {}} />);
    expect(markup).toBe("");
  });

  it("renders count when 1+ servers", () => {
    const markup = renderToStaticMarkup(
      <DetectedServersBadge servers={[make({})]} onClick={() => {}} />,
    );
    expect(markup).toContain(">1<");
  });

  it("applies pulsing data-state when any server is predicted or candidate", () => {
    const markup = renderToStaticMarkup(
      <DetectedServersBadge servers={[make({ status: "candidate" })]} onClick={() => {}} />,
    );
    expect(markup).toContain('data-state="pulsing"');
  });

  it("no pulsing data-state when all servers are live", () => {
    const markup = renderToStaticMarkup(
      <DetectedServersBadge servers={[make({ status: "live" })]} onClick={() => {}} />,
    );
    expect(markup).not.toContain('data-state="pulsing"');
  });
});
