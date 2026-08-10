// The wrapper document the HTML preview WebView loads, and the navigation
// predicate that keeps it there. Pure string work, deliberately free of React
// Native so it can be tested in node — the containment argument below is the
// whole reason the preview is allowed to exist, and it has to be checkable.
//
// Two locks with DIFFERENT jobs — each is load-bearing for its own class:
//
//   1. The CSP on OUR document. `default-src 'none'` denies every fetch the
//      workspace document could ask for — scripts, styles, fonts, frames,
//      connections, and PASSIVE loads like a static `<img src=https://…>`
//      beacon — and a `srcdoc` iframe INHERITS its embedder's policy, so the
//      workspace document is bound by it too. Only inline styles and data:
//      images are allowed back in, because those are what makes a static page
//      look like itself and neither leaves the device. This is the ONLY lock
//      against network exfiltration: an empty sandbox does not stop passive
//      subresource loads, so the CSP must never be weakened on the theory that
//      the sandbox covers it.
//   2. The empty `sandbox` attribute. An iframe sandboxed with no tokens gets a
//      unique opaque origin and loses scripting, form submission, top-level
//      navigation, popups and plugins. Even if the CSP were somehow bypassed,
//      there is no script to bypass it with — but scripts are its whole
//      jurisdiction; it is not a network lock.
//
// The workspace document is therefore never the top-level document, and its
// bytes reach the WebView as an attribute value rather than as markup we parsed
// or rewrote — nothing here interprets what the file contains.

const HTML_ENTITY_BY_CHARACTER: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escapes a string for use as a double-quoted HTML attribute value.
 *
 * `&` has to be handled by the same pass as the rest — escaping it separately
 * would either double-escape the entities this pass introduces or leave a
 * `&quot;` in the source able to break out of the attribute. Angle brackets do
 * not strictly need escaping inside an attribute, but escaping them keeps the
 * serialized document unambiguous for any parser that sees it; the browser
 * decodes the value once before parsing `srcdoc`, so the iframe still receives
 * the original bytes.
 */
export function escapeHtmlAttributeValue(value: string): string {
  return value.replaceAll(
    /[&<>"']/gu,
    (character) => HTML_ENTITY_BY_CHARACTER[character] ?? character,
  );
}

/**
 * Wraps a workspace HTML document in the sandboxed shell described above.
 *
 * `html` is used verbatim (only entity-escaped): a preview that rewrote the
 * document would be showing the user something other than the file.
 */
export function buildSandboxedHtmlDocument(html: string): string {
  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    '<meta charset="utf-8">',
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'\">",
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<style>html,body{margin:0;padding:0;height:100%;background:#fff}",
    "iframe{display:block;width:100%;height:100%;border:0}</style>",
    "</head>",
    "<body>",
    `<iframe sandbox="" srcdoc="${escapeHtmlAttributeValue(html)}"></iframe>`,
    "</body>",
    "</html>",
  ].join("");
}

/**
 * Whether the WebView may start a load.
 *
 * The wrapper is handed to the WebView as a string, so the only legitimate
 * loads are the `about:` ones the platform performs for it (`about:blank` for
 * the shell, `about:srcdoc` for the iframe). Everything else — an http(s) URL,
 * a custom scheme, a file: path — is the document trying to go somewhere, and
 * the answer is no. Returning false leaves the user on the preview rather than
 * handing the URL to the system browser.
 */
export function isAllowedHtmlPreviewNavigation(url: string): boolean {
  return url.length === 0 || url.toLowerCase().startsWith("about:");
}
