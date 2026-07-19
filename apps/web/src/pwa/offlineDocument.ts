function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function renderHostedPwaOfflineDocument(input: { readonly startUrl: string }): string {
  const startUrl = escapeHtmlAttribute(input.startUrl);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#161616" />
    <title>Ryco is offline</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: max(1.5rem, env(safe-area-inset-top)) max(1.5rem, env(safe-area-inset-right)) max(1.5rem, env(safe-area-inset-bottom)) max(1.5rem, env(safe-area-inset-left)); background: Canvas; color: CanvasText; }
      main { width: min(100%, 28rem); }
      h1 { margin: 0; font-size: 1.5rem; }
      p { margin: 0.75rem 0 0; line-height: 1.55; color: color-mix(in srgb, CanvasText 68%, transparent); }
      a { display: inline-flex; min-height: 2.75rem; align-items: center; margin-top: 1.5rem; padding: 0 1rem; border: 1px solid color-mix(in srgb, CanvasText 24%, transparent); border-radius: 0.625rem; color: CanvasText; font-weight: 600; text-decoration: none; }
      a:focus-visible { outline: 2px solid Highlight; outline-offset: 3px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Ryco is offline</h1>
      <p>Reconnect to check access and synchronize current node state. No project or conversation data is stored in this offline page.</p>
      <a href="${startUrl}">Try again</a>
    </main>
  </body>
</html>
`;
}
