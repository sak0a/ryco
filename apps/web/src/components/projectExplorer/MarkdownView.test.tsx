import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownView } from "./MarkdownView";

describe("MarkdownView", () => {
  it("strips HTML comments by default", () => {
    const markup = renderToStaticMarkup(
      <MarkdownView text={"Visible\n\n<!-- hidden -->\n\nAfter"} />,
    );
    expect(markup).not.toContain("hidden");
    expect(markup).toContain("Visible");
    expect(markup).toContain("After");
  });

  it("renders <details>/<summary> as actual disclosure elements", () => {
    const markup = renderToStaticMarkup(
      <MarkdownView
        text={"<details>\n<summary>Click to expand</summary>\n\nSecret payload\n\n</details>"}
      />,
    );
    expect(markup).toContain("<details");
    expect(markup).toContain("<summary");
    expect(markup).toContain("Click to expand");
    expect(markup).toContain("Secret payload");
  });

  it("renders GFM tables", () => {
    const markup = renderToStaticMarkup(<MarkdownView text={"| a | b |\n| - | - |\n| 1 | 2 |"} />);
    expect(markup).toContain("<table");
    expect(markup).toContain("<th");
    expect(markup).toContain("<td");
  });

  it("renders GFM strikethrough", () => {
    const markup = renderToStaticMarkup(<MarkdownView text={"~~gone~~"} />);
    expect(markup).toContain("<del");
  });

  it("renders task list checkboxes", () => {
    const markup = renderToStaticMarkup(<MarkdownView text={"- [ ] todo\n- [x] done"} />);
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain("checked=");
  });

  it("strips dangerous HTML even when raw HTML is enabled", () => {
    const markup = renderToStaticMarkup(
      <MarkdownView
        text={'<details><summary>ok</summary><script>alert("xss")</script></details>'}
      />,
    );
    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("alert(");
    expect(markup).toContain("<details");
  });

  it("shows raw source when raw=true", () => {
    const markup = renderToStaticMarkup(
      <MarkdownView raw text={"# heading\n\n<!-- comment -->\nbody"} />,
    );
    expect(markup).toContain("# heading");
    expect(markup).toContain("&lt;!-- comment --&gt;");
  });
});
