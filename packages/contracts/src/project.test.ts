import { describe, expect, it } from "vite-plus/test";
import { Schema } from "effect";

import {
  ProjectReadFileResult,
  ProjectWriteFileError,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project.ts";

describe("workspace file editing contracts", () => {
  it("decodes editable file metadata", () => {
    const decoded = Schema.decodeUnknownSync(ProjectReadFileResult)({
      relativePath: "src/app.ts",
      contents: "export {};\n",
      version: `sha256:${"a".repeat(64)}`,
      encoding: "utf8-bom",
      lineEnding: "crlf",
    });

    expect(decoded).toEqual({
      relativePath: "src/app.ts",
      contents: "export {};\n",
      version: `sha256:${"a".repeat(64)}`,
      encoding: "utf8-bom",
      lineEnding: "crlf",
    });
  });

  it("keeps legacy unguarded writes valid", () => {
    expect(
      Schema.decodeUnknownSync(ProjectWriteFileInput)({
        cwd: "/repo",
        relativePath: "notes.md",
        contents: "# Notes\n",
      }),
    ).toEqual({
      cwd: "/repo",
      relativePath: "notes.md",
      contents: "# Notes\n",
    });
  });

  it("decodes guarded writes and versioned results", () => {
    const expectedVersion = `sha256:${"b".repeat(64)}`;
    expect(
      Schema.decodeUnknownSync(ProjectWriteFileInput)({
        cwd: "/repo",
        relativePath: "src/app.ts",
        contents: "export const value = 1;\n",
        expectedVersion,
        encoding: "utf8",
        lineEnding: "lf",
      }),
    ).toEqual({
      cwd: "/repo",
      relativePath: "src/app.ts",
      contents: "export const value = 1;\n",
      expectedVersion,
      encoding: "utf8",
      lineEnding: "lf",
    });
    expect(
      Schema.decodeUnknownSync(ProjectWriteFileResult)({
        relativePath: "src/app.ts",
        version: expectedVersion,
      }),
    ).toEqual({ relativePath: "src/app.ts", version: expectedVersion });
  });

  it("carries a typed guarded-write failure reason", () => {
    const error = Schema.decodeUnknownSync(ProjectWriteFileError)({
      _tag: "ProjectWriteFileError",
      message: "Workspace file changed after it was opened.",
      reason: "conflict",
    });

    expect(error._tag).toBe("ProjectWriteFileError");
    expect(error.reason).toBe("conflict");
  });
});
