import { describe, expect, it } from "vite-plus/test";

import {
  detectPreviewFileKind,
  filterPreviewProjectEntries,
  inferPreviewLanguage,
  PREVIEW_FILE_SIZE_LIMIT_BYTES,
  resolvePreviewSizeGuard,
} from "./PreviewPanel.logic";

describe("detectPreviewFileKind", () => {
  it("detects image previews by extension and MIME type", () => {
    for (const filePath of [
      "assets/logo.png",
      "assets/photo.jpg",
      "assets/animation.gif",
      "assets/card.webp",
      "assets/icon.svg",
    ]) {
      expect(detectPreviewFileKind({ filePath })).toBe("image");
    }
    expect(detectPreviewFileKind({ filePath: "download", mimeType: "image/png" })).toBe("image");
  });

  it("detects text previews by extension and MIME type", () => {
    for (const filePath of ["src/app.ts", "README.md", "scripts/tool.py", "data/config.json"]) {
      expect(detectPreviewFileKind({ filePath })).toBe("text");
    }
    expect(
      detectPreviewFileKind({ filePath: "LICENSE", mimeType: "text/plain; charset=utf-8" }),
    ).toBe("text");
  });

  it("falls back to binary for unknown file types", () => {
    expect(detectPreviewFileKind({ filePath: "dist/app.bin" })).toBe("binary");
    expect(
      detectPreviewFileKind({ filePath: "archive", mimeType: "application/octet-stream" }),
    ).toBe("binary");
  });
});

describe("inferPreviewLanguage", () => {
  it("maps common extensions to highlighter languages", () => {
    expect(inferPreviewLanguage("src/App.tsx")).toBe("tsx");
    expect(inferPreviewLanguage("src/index.ts")).toBe("ts");
    expect(inferPreviewLanguage("README.md")).toBe("markdown");
    expect(inferPreviewLanguage("scripts/migrate.py")).toBe("python");
    expect(inferPreviewLanguage("Dockerfile")).toBe("dockerfile");
    expect(inferPreviewLanguage(".gitignore")).toBe("ini");
  });

  it("falls back to plain text for unknown extensions", () => {
    expect(inferPreviewLanguage("notes.custom")).toBe("text");
  });
});

describe("resolvePreviewSizeGuard", () => {
  it("allows fetching files at or below the preview limit", () => {
    expect(resolvePreviewSizeGuard(PREVIEW_FILE_SIZE_LIMIT_BYTES)).toEqual({
      state: "within-limit",
      shouldFetch: true,
      sizeBytes: PREVIEW_FILE_SIZE_LIMIT_BYTES,
      limitBytes: PREVIEW_FILE_SIZE_LIMIT_BYTES,
    });
  });

  it("blocks fetching and exposes warning state for files above the preview limit", () => {
    expect(resolvePreviewSizeGuard(PREVIEW_FILE_SIZE_LIMIT_BYTES + 1)).toEqual({
      state: "too-large",
      shouldFetch: false,
      sizeBytes: PREVIEW_FILE_SIZE_LIMIT_BYTES + 1,
      limitBytes: PREVIEW_FILE_SIZE_LIMIT_BYTES,
    });
  });
});

describe("filterPreviewProjectEntries", () => {
  const entries = [
    { path: "src", kind: "directory" as const },
    { path: "src/app.ts", kind: "file" as const },
    { path: "src/components", kind: "directory" as const },
    { path: "src/components/PreviewPanel.tsx", kind: "file" as const },
    { path: "docs", kind: "directory" as const },
    { path: "docs/readme.md", kind: "file" as const },
    { path: "assets/logo.png", kind: "file" as const },
  ];

  it("returns every entry for blank searches", () => {
    expect(filterPreviewProjectEntries(entries, "   ")).toBe(entries);
  });

  it("filters entries by path tokens", () => {
    expect(filterPreviewProjectEntries(entries, "preview tsx").map((entry) => entry.path)).toEqual([
      "src/components/PreviewPanel.tsx",
    ]);
  });

  it("keeps descendants when a matching directory is filtered", () => {
    expect(filterPreviewProjectEntries(entries, "components").map((entry) => entry.path)).toEqual([
      "src/components",
      "src/components/PreviewPanel.tsx",
    ]);
  });
});
