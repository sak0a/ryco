/**
 * The gateway footer.
 *
 * It names the Hub the visitor is actually on. For a self-hosted, multi-tenant
 * product that is the most useful thing a sign-in footer can say and the one
 * fact this code can state truthfully: the origin is where the browser already
 * is, so it cannot be wrong, and a person who followed a mailed link can see
 * which deployment is asking for their passkey before they hand it over.
 *
 * There are deliberately no Docs / Status / Privacy / Support links yet. No
 * canonical URLs for them exist in either repository, and the Hub serves no
 * configuration carrying them, so shipping them now would mean inventing dead
 * links. `links` is the seam for when the Hub does publish them.
 */
export function HubFooter({
  links = [],
}: {
  /** Optional operator-provided links. Rendered only when non-empty. */
  readonly links?: readonly { readonly label: string; readonly href: string }[];
}) {
  // `window.location.host` rather than `origin`: the scheme is noise on a
  // service that is HTTPS-only in production, and the port matters in
  // development, where it distinguishes a local Hub from the app dev server.
  const host = typeof window === "undefined" ? null : window.location.host;

  return (
    <footer className="mt-10 flex flex-col items-center gap-2 text-center text-muted-foreground text-xs">
      {host === null ? null : (
        <p>
          Signing in to <span className="font-medium text-foreground">{host}</span>
        </p>
      )}
      {links.length === 0 ? null : (
        <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          {links.map((link) => (
            <li key={link.href}>
              <a
                className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                href={link.href}
                rel="noreferrer"
                target="_blank"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </footer>
  );
}
