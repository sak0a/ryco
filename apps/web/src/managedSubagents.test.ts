import { describe, expect, it } from "vite-plus/test";

import { clampManagedSubagentCount } from "./managedSubagents";

describe("clampManagedSubagentCount", () => {
  it("keeps managed subagent launches within the supported range", () => {
    expect(clampManagedSubagentCount(0)).toBe(1);
    expect(clampManagedSubagentCount(Number.NaN)).toBe(1);
    expect(clampManagedSubagentCount(2.9)).toBe(2);
    expect(clampManagedSubagentCount(10)).toBe(4);
  });
});
