import "../index.css";

import { page, userEvent } from "vite-plus/test/browser";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { useState } from "react";
import { render } from "vitest-browser-react";

import { PreviewFileEditor } from "./PreviewFileEditor";
import { PREVIEW_FILE_UNSAFE_CSS } from "./PreviewFileStyles";

function EditorHarness() {
  const [contents, setContents] = useState("const answer = 41;\n");
  return (
    <div className="h-[420px]">
      <PreviewFileEditor
        cacheKey="preview-editor-browser-test"
        className="block min-h-full"
        contents={contents}
        filePath="src/app.ts"
        language="typescript"
        onChange={setContents}
        options={{
          disableFileHeader: true,
          overflow: "scroll",
          theme: "pierre-light",
          themeType: "light",
          unsafeCSS: PREVIEW_FILE_UNSAFE_CSS,
        }}
      />
      <output aria-label="Current file contents">{contents}</output>
      <button type="button" onClick={() => setContents("const answer = 41;\n")}>
        Reset contents
      </button>
    </div>
  );
}

describe("PreviewFileEditor", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("forwards edits from the real rich editor surface", async () => {
    const mounted = await render(<EditorHarness />);
    const editor = page.getByRole("textbox");

    await expect.element(editor).toBeInTheDocument();
    await userEvent.tripleClick(editor);
    await userEvent.keyboard("const answer = 42;");
    await expect
      .element(page.getByLabelText("Current file contents"))
      .toHaveTextContent("const answer = 42;");

    await page.getByRole("button", { name: "Reset contents" }).click();
    await expect.element(editor).toHaveTextContent("const answer = 41;");

    await mounted.unmount();
  });

  it("uses identical typography for rendered text and caret measurement", async () => {
    const mounted = await render(<EditorHarness />);
    const editor = page.getByRole("textbox");

    await expect.element(editor).toBeInTheDocument();
    const editable = editor.element() as HTMLElement;
    const renderedLine = editable.querySelector<HTMLElement>("[data-line]");
    expect(renderedLine).not.toBeNull();

    const editableStyle = getComputedStyle(editable);
    const renderedLineStyle = getComputedStyle(renderedLine as HTMLElement);
    expect(editableStyle.fontFamily).toBe(renderedLineStyle.fontFamily);
    expect(editableStyle.fontSize).toBe(renderedLineStyle.fontSize);
    expect(editableStyle.lineHeight).toBe(renderedLineStyle.lineHeight);
    expect(editableStyle.letterSpacing).toBe(renderedLineStyle.letterSpacing);

    await userEvent.tripleClick(editor);
    await userEvent.keyboard("XX");
    await expect.element(editor).toHaveTextContent("XX");
    await vi.waitFor(() => {
      const currentLine = editable.querySelector<HTMLElement>(
        "[data-line][data-editor-active-line]",
      );
      const lastToken = currentLine?.lastElementChild;
      const caret = (editable.getRootNode() as ShadowRoot).querySelector<HTMLElement>(
        "[data-caret]",
      );
      expect(lastToken).not.toBeNull();
      expect(caret).not.toBeNull();
      expect(
        Math.abs(
          (lastToken as Element).getBoundingClientRect().right -
            (caret as HTMLElement).getBoundingClientRect().left,
        ),
      ).toBeLessThan(2);
    });

    await mounted.unmount();
  });
});
