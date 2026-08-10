import { describe, expect, it } from "vite-plus/test";

import {
  classifyWorkspaceFilePath,
  classifyWorkspaceFileReadError,
  resolveWorkspaceFileViewMode,
  WORKSPACE_FILE_PREVIEW_MAX_BYTES,
} from "./previewClassification.ts";

describe("classifyWorkspaceFilePath", () => {
  it("recognizes markdown", () => {
    for (const path of ["README.md", "docs/a.mdx", "a.markdown", "a.MDOWN"]) {
      expect(classifyWorkspaceFilePath(path), path).toBe("markdown");
    }
  });

  it("recognizes images so the screen never issues a read", () => {
    for (const path of [
      "a.avif",
      "a.bmp",
      "a.gif",
      "a.heic",
      "a.ico",
      "a.jpeg",
      "a.JPG",
      "assets/logo.png",
      "a.svg",
      "a.tiff",
      "a.webp",
    ]) {
      expect(classifyWorkspaceFilePath(path), path).toBe("image");
    }
  });

  it("recognizes curated binary families", () => {
    for (const path of [
      "dist/app.zip",
      "dist/app.tar",
      "dist/app.tar.gz",
      "dist/app.tgz",
      "a.bz2",
      "a.xz",
      "a.zst",
      "a.7z",
      "a.rar",
      "a.jar",
      "media/song.mp3",
      "media/clip.mp4",
      "a.m4a",
      "a.mov",
      "a.avi",
      "a.mkv",
      "a.wav",
      "a.flac",
      "a.ogg",
      "a.webm",
      "fonts/Inter.ttf",
      "fonts/Inter.otf",
      "fonts/Inter.woff",
      "fonts/Inter.woff2",
      "fonts/Inter.eot",
      "doc.pdf",
      "doc.doc",
      "doc.docx",
      "sheet.xls",
      "sheet.xlsx",
      "deck.ppt",
      "deck.pptx",
      "bin/app.exe",
      "bin/app.dll",
      "bin/app.so",
      "bin/app.dylib",
      "bin/libfoo.a",
      "bin/main.o",
      "bin/blob.bin",
      "bin/blob.dat",
      "data/app.sqlite",
      "data/app.db",
      "pkg/mod.wasm",
      "Main.class",
      "mod.pyc",
      ".DS_Store",
      "src/.ds_store",
    ]) {
      expect(classifyWorkspaceFilePath(path), path).toBe("binary");
    }
  });

  it("defaults unknown and extensionless names to text, leaving the node as the authority", () => {
    for (const path of [
      "src/index.ts",
      "Makefile",
      "Dockerfile",
      ".gitignore",
      "a.unknownext",
      "notes.",
    ]) {
      expect(classifyWorkspaceFilePath(path), path).toBe("text");
    }
  });

  it("pins the preview ceiling to the node's limit", () => {
    expect(WORKSPACE_FILE_PREVIEW_MAX_BYTES).toBe(524_288);
  });
});

describe("resolveWorkspaceFileViewMode", () => {
  it("previews markdown only when a renderer exists", () => {
    expect(
      resolveWorkspaceFileViewMode({
        path: "README.md",
        kind: "markdown",
        markdownRendererAvailable: true,
        override: null,
      }),
    ).toBe("preview");

    expect(
      resolveWorkspaceFileViewMode({
        path: "README.md",
        kind: "markdown",
        markdownRendererAvailable: false,
        override: null,
      }),
    ).toBe("source");

    expect(
      resolveWorkspaceFileViewMode({
        path: "src/index.ts",
        kind: "text",
        markdownRendererAvailable: true,
        override: null,
      }),
    ).toBe("source");
  });

  it("honors an override for its own file and drops it for any other", () => {
    expect(
      resolveWorkspaceFileViewMode({
        path: "README.md",
        kind: "markdown",
        markdownRendererAvailable: true,
        override: { path: "README.md", mode: "source" },
      }),
    ).toBe("source");

    expect(
      resolveWorkspaceFileViewMode({
        path: "docs/guide.md",
        kind: "markdown",
        markdownRendererAvailable: true,
        override: { path: "README.md", mode: "source" },
      }),
    ).toBe("preview");
  });
});

describe("classifyWorkspaceFileReadError", () => {
  it("maps every failure the node reports", () => {
    expect(
      classifyWorkspaceFileReadError(
        "File is too large to preview (1048576 bytes). Limit is 524288 bytes.",
      ),
    ).toBe("oversized");
    expect(classifyWorkspaceFileReadError("Binary files cannot be previewed.")).toBe("binary");
    expect(classifyWorkspaceFileReadError("Only UTF-8 text files can be previewed.")).toBe(
      "encoding",
    );
    expect(classifyWorkspaceFileReadError("Only regular files can be previewed.")).toBe("not-file");
    expect(classifyWorkspaceFileReadError("ENOENT: no such file or directory, open 'a.ts'")).toBe(
      "missing",
    );
    expect(classifyWorkspaceFileReadError("File not found")).toBe("missing");
  });

  it("ignores casing and wrapping text", () => {
    expect(
      classifyWorkspaceFileReadError("readFile failed: BINARY FILES CANNOT BE PREVIEWED."),
    ).toBe("binary");
  });

  it("degrades unknown, empty and absent messages to the generic state", () => {
    expect(classifyWorkspaceFileReadError("Connection lost")).toBe("error");
    expect(classifyWorkspaceFileReadError("")).toBe("error");
    expect(classifyWorkspaceFileReadError(null)).toBe("error");
    expect(classifyWorkspaceFileReadError(undefined)).toBe("error");
  });
});
