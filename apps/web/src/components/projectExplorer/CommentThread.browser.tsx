import "../../index.css";

import { page } from "vite-plus/test/browser";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { CommentComposer, type CommentQuoteInsertion } from "./CommentThread";

const quoteMarkdown = [
  "> @alice wrote in issue comment on 2026-03-14 10:05 UTC:",
  ">",
  "> Please add docs.",
].join("\n");

function renderComposer(props: {
  onSubmit?:
    | ((input: { readonly body: string; readonly clientMutationId: string }) => Promise<void>)
    | undefined;
  quoteInsertion?: CommentQuoteInsertion | null | undefined;
}) {
  return render(
    <CommentComposer
      placeholder="Write a comment"
      submitLabel="Comment"
      onSubmit={props.onSubmit ?? vi.fn(async () => undefined)}
      quoteInsertion={props.quoteInsertion}
    />,
  );
}

describe("CommentComposer", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("preserves the current draft, appends a quote, and focuses the textarea", async () => {
    const screen = await renderComposer({});
    try {
      const textarea = page.getByLabelText("Comment body");
      await textarea.fill("Existing draft");

      await screen.rerender(
        <CommentComposer
          placeholder="Write a comment"
          submitLabel="Comment"
          onSubmit={vi.fn(async () => undefined)}
          quoteInsertion={{ id: 1, markdown: quoteMarkdown }}
        />,
      );

      await expect.element(textarea).toHaveValue(`Existing draft\n\n${quoteMarkdown}\n\n`);
      await expect
        .poll(() => document.activeElement?.getAttribute("aria-label"))
        .toBe("Comment body");
    } finally {
      await screen.unmount();
    }
  });

  it("submits Markdown without trimming meaningful leading whitespace", async () => {
    let submittedBody: string | null = null;
    const screen = await renderComposer({
      onSubmit: async ({ body }) => {
        submittedBody = body;
      },
    });

    try {
      await page.getByLabelText("Comment body").fill("    code block\n");
      await page.getByRole("button", { name: "Comment" }).click();
      await expect.poll(() => submittedBody).toBe("    code block");
    } finally {
      await screen.unmount();
    }
  });
});
