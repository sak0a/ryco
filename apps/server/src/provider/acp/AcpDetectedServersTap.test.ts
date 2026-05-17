import { describe, expect, it } from "vitest";
import { AcpDetailSuffixDedup } from "./AcpDetectedServersTap.ts";

describe("AcpDetailSuffixDedup", () => {
  it("returns the new suffix on each cumulative growth", () => {
    const dedup = new AcpDetailSuffixDedup();
    expect(dedup.consume("call-1", "Local: http://")).toBe("Local: http://");
    expect(dedup.consume("call-1", "Local: http://localhost")).toBe("localhost");
    expect(dedup.consume("call-1", "Local: http://localhost:5173/\nready")).toBe(":5173/\nready");
  });

  it("returns null when detail length did not change", () => {
    const dedup = new AcpDetailSuffixDedup();
    dedup.consume("call-1", "abcdef");
    expect(dedup.consume("call-1", "abcdef")).toBeNull();
  });

  it("re-feeds full detail when the cumulative text shrinks", () => {
    const dedup = new AcpDetailSuffixDedup();
    dedup.consume("call-1", "Local: http://localhost:5173/");
    expect(dedup.consume("call-1", "restarted")).toBe("restarted");
    expect(dedup.consume("call-1", "restarted now")).toBe(" now");
  });

  it("scopes per toolCallId", () => {
    const dedup = new AcpDetailSuffixDedup();
    expect(dedup.consume("call-a", "alpha")).toBe("alpha");
    expect(dedup.consume("call-b", "beta")).toBe("beta");
    expect(dedup.consume("call-a", "alpha-extra")).toBe("-extra");
    expect(dedup.consume("call-b", "beta-extra")).toBe("-extra");
  });

  it("reset clears the per-key length so the next consume is a full feed", () => {
    const dedup = new AcpDetailSuffixDedup();
    dedup.consume("call-1", "abc");
    dedup.reset("call-1");
    expect(dedup.consume("call-1", "abcdef")).toBe("abcdef");
  });

  it("integrates with a tracker stub: only the suffix is sent on a growing sequence", () => {
    const dedup = new AcpDetailSuffixDedup();
    const fed: string[] = [];
    const feed = (text: string) => fed.push(text);

    const updates = [
      "running vite\n",
      "running vite\nVITE v5.0.0\n",
      "running vite\nVITE v5.0.0\nLocal: http://localhost:5173/\n",
    ];

    for (const detail of updates) {
      const suffix = dedup.consume("tool-1", detail);
      if (suffix !== null) feed(suffix);
    }

    expect(fed).toEqual(["running vite\n", "VITE v5.0.0\n", "Local: http://localhost:5173/\n"]);
  });
});
