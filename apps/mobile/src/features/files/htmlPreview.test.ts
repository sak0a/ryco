import { describe, expect, it } from "vite-plus/test";

import {
  buildSandboxedHtmlDocument,
  escapeHtmlAttributeValue,
  isAllowedHtmlPreviewNavigation,
} from "./htmlPreview";

describe("escapeHtmlAttributeValue", () => {
  it("escapes every character that could end the attribute or start a tag", () => {
    expect(escapeHtmlAttributeValue(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  it("escapes ampersands once, so an entity in the source cannot break out", () => {
    // A naive two-pass escape turns this into `&amp;quot;` (harmless) or, worse,
    // leaves a bare `"` able to close the srcdoc attribute.
    expect(escapeHtmlAttributeValue("&quot;")).toBe("&amp;quot;");
    expect(escapeHtmlAttributeValue("a & b")).toBe("a &amp; b");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeHtmlAttributeValue("héllo wörld — 100% ok")).toBe("héllo wörld — 100% ok");
  });
});

describe("buildSandboxedHtmlDocument", () => {
  const document = buildSandboxedHtmlDocument("<h1>Hi</h1>");

  it("denies everything by default and allows back only inline styles and data images", () => {
    expect(document).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`,
    );
  });

  it("frames the workspace document with an empty sandbox token list", () => {
    expect(document).toContain('<iframe sandbox="" srcdoc=');
  });

  it("never lets the workspace document be the top-level document", () => {
    // The only place the file's markup may appear is inside the srcdoc value.
    expect(document).toContain('srcdoc="&lt;h1&gt;Hi&lt;/h1&gt;"');
    expect(document).not.toContain("<h1>");
  });

  it("keeps a breakout attempt inside the attribute value", () => {
    const hostile = `"></iframe><script>fetch("https://example.test")</script>`;
    const wrapped = buildSandboxedHtmlDocument(hostile);
    expect(wrapped).not.toContain("<script");
    // Exactly one frame: the closing tag the payload tried to smuggle in never
    // became markup, so it cannot have opened a second, unsandboxed one.
    expect(wrapped.split("<iframe")).toHaveLength(2);
    expect(wrapped.split("</iframe>")).toHaveLength(2);
    expect(wrapped).toContain(
      'srcdoc="&quot;&gt;&lt;/iframe&gt;&lt;script&gt;fetch(&quot;https://example.test&quot;)&lt;/script&gt;"',
    );
  });

  it("declares a viewport so a desktop-width page is legible on a phone", () => {
    expect(document).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
    );
  });

  it("carries no base URL, so a relative reference resolves to nothing fetchable", () => {
    expect(document).not.toContain("<base");
  });
});

describe("isAllowedHtmlPreviewNavigation", () => {
  it("allows only the loads the platform performs for the wrapper", () => {
    expect(isAllowedHtmlPreviewNavigation("about:blank")).toBe(true);
    expect(isAllowedHtmlPreviewNavigation("about:srcdoc")).toBe(true);
    expect(isAllowedHtmlPreviewNavigation("ABOUT:BLANK")).toBe(true);
    expect(isAllowedHtmlPreviewNavigation("")).toBe(true);
  });

  it("refuses anything that would leave the preview", () => {
    for (const url of [
      "https://example.test/",
      "http://127.0.0.1:4141/file",
      "file:///etc/passwd",
      "ryco-dev://pair",
      "data:text/html,<b>x</b>",
      "javascript:alert(1)",
      " about:blank",
    ]) {
      expect(isAllowedHtmlPreviewNavigation(url), url).toBe(false);
    }
  });
});
