import "../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const { codeToHtmlMock, getSharedHighlighterMock, openInPreferredEditorMock, readLocalApiMock } =
  vi.hoisted(() => {
    const codeToHtmlMock = vi.fn((code: string) => `<pre class="shiki"><code>${code}</code></pre>`);
    return {
      codeToHtmlMock,
      getSharedHighlighterMock: vi.fn(async () => ({
        codeToHtml: codeToHtmlMock,
      })),
      openInPreferredEditorMock: vi.fn(async () => "vscode"),
      readLocalApiMock: vi.fn(() => ({
        server: { getConfig: vi.fn(async () => ({ availableEditors: ["vscode"] })) },
        shell: { openInEditor: vi.fn(async () => undefined) },
      })),
    };
  });

vi.mock("../editorPreferences", () => ({
  openInPreferredEditor: openInPreferredEditorMock,
}));

vi.mock("../localApi", () => ({
  ensureLocalApi: vi.fn(() => {
    throw new Error("ensureLocalApi not implemented in browser test");
  }),
  readLocalApi: readLocalApiMock,
}));

vi.mock("@pierre/diffs", () => ({
  getSharedHighlighter: getSharedHighlighterMock,
}));

import ChatMarkdown from "./ChatMarkdown";

describe("ChatMarkdown", () => {
  afterEach(() => {
    openInPreferredEditorMock.mockClear();
    readLocalApiMock.mockClear();
    getSharedHighlighterMock.mockClear();
    codeToHtmlMock.mockClear();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("rewrites file uri hrefs into direct paths before rendering", async () => {
    const filePath =
      "/Users/yashsingh/p/sco/claude-code-extract/src/utils/permissions/PermissionRule.ts";
    const screen = await render(
      <ChatMarkdown text={`[PermissionRule.ts](file://${filePath})`} cwd="/repo/project" />,
    );

    try {
      const link = page.getByRole("link", { name: "PermissionRule.ts" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", filePath);

      await link.click();

      await vi.waitFor(() => {
        expect(openInPreferredEditorMock).toHaveBeenCalledWith(expect.anything(), filePath);
      });
    } finally {
      await screen.unmount();
    }
  });

  it("keeps line anchors working after rewriting file uri hrefs", async () => {
    const filePath =
      "/Users/yashsingh/p/sco/claude-code-extract/src/utils/permissions/PermissionRule.ts";
    const screen = await render(
      <ChatMarkdown text={`[PermissionRule.ts:1](file://${filePath}#L1)`} cwd="/repo/project" />,
    );

    try {
      const link = page.getByRole("link", { name: "PermissionRule.ts · L1" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", `${filePath}#L1`);

      await link.click();

      await vi.waitFor(() => {
        expect(openInPreferredEditorMock).toHaveBeenCalledWith(expect.anything(), `${filePath}:1`);
      });
    } finally {
      await screen.unmount();
    }
  });

  it("shows column information inline when present", async () => {
    const filePath =
      "/Users/yashsingh/p/sco/claude-code-extract/src/utils/permissions/PermissionRule.ts";
    const screen = await render(
      <ChatMarkdown text={`[PermissionRule.ts](file://${filePath}#L1C7)`} cwd="/repo/project" />,
    );

    try {
      const link = page.getByRole("link", { name: "PermissionRule.ts · L1:C7" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", `${filePath}#L1C7`);

      await link.click();

      await vi.waitFor(() => {
        expect(openInPreferredEditorMock).toHaveBeenCalledWith(
          expect.anything(),
          `${filePath}:1:7`,
        );
      });
    } finally {
      await screen.unmount();
    }
  });

  it("disambiguates duplicate file basenames inline", async () => {
    const firstPath = "/Users/yashsingh/p/ryco/apps/web/src/components/chat/MessagesTimeline.tsx";
    const secondPath = "/Users/yashsingh/p/ryco/apps/web/src/components/MessagesTimeline.tsx";
    const screen = await render(
      <ChatMarkdown
        text={`See [MessagesTimeline.tsx](file://${firstPath}) and [MessagesTimeline.tsx](file://${secondPath}).`}
        cwd="/repo/project"
      />,
    );

    try {
      await expect
        .element(page.getByRole("link", { name: "MessagesTimeline.tsx · components/chat" }))
        .toBeInTheDocument();
      await expect
        .element(page.getByRole("link", { name: "MessagesTimeline.tsx · src/components" }))
        .toBeInTheDocument();
    } finally {
      await screen.unmount();
    }
  });

  it("keeps normal web links unchanged", async () => {
    const screen = await render(
      <ChatMarkdown text="[OpenAI](https://openai.com/docs)" cwd="/repo/project" />,
    );

    try {
      const link = page.getByRole("link", { name: "OpenAI" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", "https://openai.com/docs");
      await expect.element(link).toHaveAttribute("target", "_blank");
    } finally {
      await screen.unmount();
    }
  });

  it("renders streaming code blocks without starting the Shiki highlighter", async () => {
    const screen = await render(
      <ChatMarkdown text={"```ts\nconst value = 1;\n```"} cwd="/repo/project" isStreaming />,
    );

    try {
      const codeBlock = document.querySelector("pre code.language-ts");
      expect(codeBlock?.textContent).toBe("const value = 1;\n");
      expect(document.querySelector(".chat-markdown-shiki")).toBeNull();
      expect(getSharedHighlighterMock).not.toHaveBeenCalled();
      expect(codeToHtmlMock).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });

  it("uses Shiki for finalized code blocks", async () => {
    const screen = await render(
      <ChatMarkdown text={"```ts\nconst finalValue = 1;\n```"} cwd="/repo/project" />,
    );

    try {
      await vi.waitFor(() => {
        expect(getSharedHighlighterMock).toHaveBeenCalledTimes(1);
      });
      expect(codeToHtmlMock).toHaveBeenCalledWith(
        "const finalValue = 1;\n",
        expect.objectContaining({ lang: "ts" }),
      );
      expect(document.querySelector(".chat-markdown-shiki")).not.toBeNull();
    } finally {
      await screen.unmount();
    }
  });
});
