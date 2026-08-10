import type { ProjectReadFileResult } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildThreadFileScreenModel,
  shouldReadWorkspaceFile,
  WORKSPACE_SOURCE_HIGHLIGHT_MAX_LINES,
  type ThreadFileScreenInput,
} from "./threadFileModel";

const IDLE_READ = { data: null, error: null, isLoading: false } as const;

function readResult(contents: string, relativePath = "src/a.ts"): ProjectReadFileResult {
  return { relativePath, contents, version: "v1", encoding: "utf8", lineEnding: "lf" };
}

function input(overrides: Partial<ThreadFileScreenInput> = {}): ThreadFileScreenInput {
  return {
    path: "src/a.ts",
    line: null,
    bootstrapComplete: true,
    thread: { worktreePath: null },
    project: { cwd: "/work/project" },
    worktree: null,
    readState: IDLE_READ,
    connectionUiState: "connected",
    markdownRendererAvailable: false,
    viewModeOverride: null,
    ...overrides,
  };
}

describe("buildThreadFileScreenModel routing states", () => {
  it("rejects a path the route param could not normalize", () => {
    const model = buildThreadFileScreenModel(input({ path: null }));
    expect(model.body).toEqual({ state: "invalid-path" });
    expect(model.header).toMatchObject({ title: "File", pathLabel: "" });
    expect(model.header.toggle.visible).toBe(false);
  });

  it("waits for the shell snapshot before declaring the thread rootless", () => {
    const rootless = { thread: { worktreePath: null }, project: null, worktree: null };
    expect(
      buildThreadFileScreenModel(input({ ...rootless, bootstrapComplete: false })).body,
    ).toEqual({ state: "loading" });
    expect(
      buildThreadFileScreenModel(input({ ...rootless, bootstrapComplete: true })).body,
    ).toEqual({ state: "no-workspace" });
  });

  it("titles the screen with the basename and keeps the full path for the subtitle", () => {
    expect(buildThreadFileScreenModel(input({ path: "src/deep/App.tsx" })).header).toMatchObject({
      title: "App.tsx",
      pathLabel: "src/deep/App.tsx",
    });
  });
});

describe("buildThreadFileScreenModel pre-fetch classification", () => {
  it("refuses images and known binaries without asking the node", () => {
    expect(buildThreadFileScreenModel(input({ path: "assets/logo.png" })).body).toEqual({
      state: "unsupported",
      reason: "image",
    });
    expect(buildThreadFileScreenModel(input({ path: "dist/bundle.zip" })).body).toEqual({
      state: "unsupported",
      reason: "binary",
    });
    expect(shouldReadWorkspaceFile("image")).toBe(false);
    expect(shouldReadWorkspaceFile("binary")).toBe(false);
  });

  it("still reads an unknown extension — the node is the authority", () => {
    expect(shouldReadWorkspaceFile("text")).toBe(true);
    expect(shouldReadWorkspaceFile("markdown")).toBe(true);
    expect(buildThreadFileScreenModel(input({ path: "Makefile" })).body).toEqual({
      state: "loading",
    });
  });
});

describe("buildThreadFileScreenModel read failures", () => {
  it("maps every refusal the node can return", () => {
    const cases = [
      ["File is too large to preview (999999 bytes). Limit is 524288 bytes.", "oversized"],
      ["Binary files cannot be previewed.", "binary"],
      ["Only UTF-8 text files can be previewed.", "encoding"],
      ["Only regular files can be previewed.", "not-file"],
      ["ENOENT: no such file or directory, open 'src/a.ts'", "missing"],
      ["the node fell over", "error"],
    ] as const;

    for (const [message, reason] of cases) {
      const model = buildThreadFileScreenModel(
        input({ readState: { ...IDLE_READ, error: new Error(message) } }),
      );
      // The raw message is kept so the screen can show what the node actually
      // said under the mapped copy.
      expect(model.body, message).toEqual({ state: "unavailable", reason, detail: message });
    }
  });

  it("prefers the offline dead-end over the socket error it produced", () => {
    expect(
      buildThreadFileScreenModel(
        input({
          readState: { ...IDLE_READ, error: new Error("socket closed") },
          connectionUiState: "offline",
        }),
      ).body,
    ).toEqual({ state: "offline-empty" });
  });

  it("flags a degraded connection without hiding the file", () => {
    const model = buildThreadFileScreenModel(
      input({
        readState: { ...IDLE_READ, data: readResult("a\n") },
        connectionUiState: "reconnecting",
      }),
    );
    expect(model.offlineNotice).toBe(true);
    expect(model.body.state).toBe("source");
  });
});

describe("buildThreadFileScreenModel source view", () => {
  it("drops the terminator newline but keeps interior blank lines", () => {
    const model = buildThreadFileScreenModel(
      input({ readState: { ...IDLE_READ, data: readResult("one\n\nthree\n") } }),
    );
    expect(model.body).toMatchObject({ state: "source", lines: ["one", "", "three"] });
  });

  it("normalizes CRLF and lone CR defensively", () => {
    const model = buildThreadFileScreenModel(
      input({ readState: { ...IDLE_READ, data: readResult("one\r\ntwo\rthree") } }),
    );
    expect(model.body).toMatchObject({ state: "source", lines: ["one", "two", "three"] });
  });

  it("reports an empty file as empty rather than as one blank line", () => {
    expect(
      buildThreadFileScreenModel(input({ readState: { ...IDLE_READ, data: readResult("") } })).body,
    ).toEqual({ state: "empty-file" });
  });

  it("anchors the deep-linked line and clamps one that points past the end", () => {
    const readState = { ...IDLE_READ, data: readResult("one\ntwo\nthree\n") };
    expect(buildThreadFileScreenModel(input({ readState, line: 2 })).body).toMatchObject({
      initialLineIndex: 1,
    });
    expect(buildThreadFileScreenModel(input({ readState, line: 900 })).body).toMatchObject({
      initialLineIndex: 2,
    });
    expect(buildThreadFileScreenModel(input({ readState, line: null })).body).toMatchObject({
      initialLineIndex: null,
    });
  });

  it("measures the longest line so the screen can size its scroll surface", () => {
    const model = buildThreadFileScreenModel(
      input({ readState: { ...IDLE_READ, data: readResult("ab\nabcdef\nabc") } }),
    );
    expect(model.body).toMatchObject({ maxLineLength: 6, highlightable: true });
  });

  it("stops offering tokens for a file no one reads token colors in", () => {
    const huge = `${"x\n".repeat(WORKSPACE_SOURCE_HIGHLIGHT_MAX_LINES + 1)}`;
    expect(
      buildThreadFileScreenModel(input({ readState: { ...IDLE_READ, data: readResult(huge) } }))
        .body,
    ).toMatchObject({ highlightable: false });
  });
});

describe("buildThreadFileScreenModel markdown mode", () => {
  const markdown = { ...IDLE_READ, data: readResult("# Title\n", "docs/readme.md") };

  it("previews Markdown by default only where the native renderer exists", () => {
    const withRenderer = buildThreadFileScreenModel(
      input({ path: "docs/readme.md", readState: markdown, markdownRendererAvailable: true }),
    );
    expect(withRenderer.viewMode).toBe("preview");
    expect(withRenderer.body).toEqual({ state: "markdown", contents: "# Title\n" });
    expect(withRenderer.header.toggle).toEqual({ visible: true, mode: "preview" });

    const withoutRenderer = buildThreadFileScreenModel(
      input({ path: "docs/readme.md", readState: markdown, markdownRendererAvailable: false }),
    );
    expect(withoutRenderer.viewMode).toBe("source");
    expect(withoutRenderer.body.state).toBe("source");
    // Nothing to switch to, so no control that pretends otherwise.
    expect(withoutRenderer.header.toggle.visible).toBe(false);
  });

  it("honours an override made for this file", () => {
    const model = buildThreadFileScreenModel(
      input({
        path: "docs/readme.md",
        readState: markdown,
        markdownRendererAvailable: true,
        viewModeOverride: { path: "docs/readme.md", mode: "source" },
      }),
    );
    expect(model.viewMode).toBe("source");
    expect(model.body.state).toBe("source");
    expect(model.header.toggle).toEqual({ visible: true, mode: "source" });
  });

  it("drops an override the moment another file is opened", () => {
    const model = buildThreadFileScreenModel(
      input({
        path: "docs/readme.md",
        readState: markdown,
        markdownRendererAvailable: true,
        viewModeOverride: { path: "docs/other.md", mode: "source" },
      }),
    );
    expect(model.viewMode).toBe("preview");
    expect(model.body.state).toBe("markdown");
  });

  it("never offers the toggle on a non-Markdown file", () => {
    const model = buildThreadFileScreenModel(
      input({
        readState: { ...IDLE_READ, data: readResult("const a = 1\n") },
        markdownRendererAvailable: true,
      }),
    );
    expect(model.header.toggle.visible).toBe(false);
  });

  it("hides the toggle until there is something to toggle between", () => {
    expect(
      buildThreadFileScreenModel(input({ path: "docs/readme.md", markdownRendererAvailable: true }))
        .header.toggle.visible,
    ).toBe(false);
  });
});
