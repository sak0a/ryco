import {
  useWebE2eeChannelStatus,
  useWebE2eeVerificationCode,
} from "../../hostedHub/useWebE2eeSession";
import { hostedE2eeVerificationView } from "./HostedE2eeVerification.logic";

/**
 * docs/relay-e2ee-protocol.md §13.5's `WebSAS` for the active session.
 *
 * GATED ON THE LOCK, NOT ON THE CODE. `e2eeSession.ts` publishes the string from
 * inside the §4.4 machine's own `e2ee` lock, which lands one tick before the
 * caller's post-operation sync moves the projection off `negotiating` — so a
 * code can be held while the channel has not yet been reported as locked.
 * Drawing it then would show a comparison value for a channel this surface
 * cannot yet say is encrypted.
 *
 * THE ADVISORY IS NOT BEHIND A DISCLOSURE. §13.5's duty is on "the web UI text
 * accompanying the `WebSAS`", and text a reader has to open is text most readers
 * never see. It renders in the same view as the characters, every time, and it
 * comes out of the same value they do ({@link hostedE2eeVerificationView}).
 *
 * The string is display state and stays that way: it is read from the in-memory
 * projection on every render and written nowhere. §13.5 — "never logged, never
 * persisted, never sent to analytics" — so there is no copy button, no `title`
 * attribute, and no form control whose value a browser could restore.
 */
export function HostedE2eeVerification() {
  const status = useWebE2eeChannelStatus();
  const code = useWebE2eeVerificationCode();
  const view = status === "web-unsigned" ? hostedE2eeVerificationView(code) : null;
  if (!view) return null;

  return (
    <section aria-label="Session code" data-testid="hosted-e2ee-verification" className="space-y-2">
      <p className="text-xs font-medium">Session code</p>
      <p
        data-testid="hosted-e2ee-verification-code"
        // Monospace and unbroken: the comparison is character by character, so a
        // proportional face and a wrap both cost the reader the only check §13.5
        // gives them. `select-all` makes the whole value the selection unit —
        // half a code taken by a stray drag is a comparison against nothing.
        className="font-mono text-base leading-none font-semibold tracking-[0.2em] whitespace-nowrap select-all"
      >
        {view.display}
      </p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{view.caption}</p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{view.advisory}</p>
    </section>
  );
}
