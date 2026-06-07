import { describe, expect, it } from "vitest";

import { resolveDiffOpenInEditorTarget } from "./DiffPanel.openInEditor.logic";

describe("resolveDiffOpenInEditorTarget", () => {
  it("uses the new-file line number for added lines", () => {
    expect(
      resolveDiffOpenInEditorTarget({
        cwd: "/repo",
        filePath: "src/app.ts",
        lineNumber: 12,
        lineType: "change-addition",
      }),
    ).toBe("/repo/src/app.ts:12");
  });

  it("uses the old-file line number for deleted lines", () => {
    expect(
      resolveDiffOpenInEditorTarget({
        cwd: "/repo",
        filePath: "src/app.ts",
        lineNumber: 7,
        lineType: "change-deletion",
      }),
    ).toBe("/repo/src/app.ts:7");
  });

  it("uses the provided line number for context lines", () => {
    expect(
      resolveDiffOpenInEditorTarget({
        cwd: "/repo",
        filePath: "src/app.ts",
        lineNumber: 20,
        lineType: "context",
      }),
    ).toBe("/repo/src/app.ts:20");
  });

  it("omits a column and line suffix when no line number is present", () => {
    expect(
      resolveDiffOpenInEditorTarget({
        cwd: "/repo",
        filePath: "src/app.ts",
      }),
    ).toBe("/repo/src/app.ts");
  });
});
