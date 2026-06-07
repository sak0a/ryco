import { describe, expect, it } from "vitest";

import { basenameOfPath, inferEntryKindFromPath } from "./pathEntry";

describe("pathEntry", () => {
  it("returns the final path segment", () => {
    expect(basenameOfPath("/tmp/project/package.json")).toBe("package.json");
    expect(basenameOfPath("README.md")).toBe("README.md");
  });

  it("infers likely entry kind from path shape", () => {
    expect(inferEntryKindFromPath("package.json")).toBe("file");
    expect(inferEntryKindFromPath(".github")).toBe("directory");
    expect(inferEntryKindFromPath("src")).toBe("directory");
  });
});
