import { EnvironmentId } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeUsageSourceId } from "./usageSourceIdentity.ts";

describe("makeUsageSourceId", () => {
  const environmentId = EnvironmentId.make("environment-a");

  it("deduplicates the same physical source across environment connections", () => {
    const first = makeUsageSourceId({
      provider: "claude",
      canonicalRoot: "/home/user/.claude/projects",
      volumeId: "1:42",
      hostname: "workstation",
      environmentId,
    });
    const second = makeUsageSourceId({
      provider: "claude",
      canonicalRoot: "/home/user/.claude/projects",
      volumeId: "1:42",
      hostname: "workstation",
      environmentId: EnvironmentId.make("environment-b"),
    });
    expect(first).toEqual(second);
    expect(first.deduplicationKind).toBe("physical");
  });

  it("falls back to environment identity when directory stat is unavailable", () => {
    const first = makeUsageSourceId({
      provider: "codex",
      canonicalRoot: "/missing/.codex",
      volumeId: "",
      hostname: "workstation",
      environmentId,
    });
    const second = makeUsageSourceId({
      provider: "codex",
      canonicalRoot: "/missing/.codex",
      volumeId: "",
      hostname: "workstation",
      environmentId: EnvironmentId.make("environment-b"),
    });
    expect(first.sourceId).not.toBe(second.sourceId);
    expect(first.deduplicationKind).toBe("environment-only");
  });
});
