import {
  useWebE2eeChannelStatus,
  useWebE2eeVerificationCode,
} from "../../hostedHub/useWebE2eeSession";
import {
  E2EE_WEB_SAS_UNAVAILABLE,
  hostedE2eeVerificationView,
} from "./HostedE2eeVerification.logic";

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
 * IT IS THE SHORT FORM, AND IT SAYS SO. This is the surface an owner is looking
 * at while they compare eight characters, so it draws the one line that
 * discharges §13.5 and the pointer at where the rest of it is — never the long
 * account, which lives one navigation away in Settings → Security. The
 * `inline` placement is what picks both, and it is not defaultable: a surface
 * cannot end up with the code and no sentence by leaving an argument off.
 *
 * THE ABSENCE OF A CODE IS ALSO A STATE THIS DRAWS. §13.5's duty is a display
 * duty and the derivation may fail without costing the channel, so a locked
 * `web-unsigned` channel can reach this surface holding nothing to compare.
 * Rendering `null` there kept the strongest claim this tier can make while the
 * only check behind it had silently gone missing; the sentence says so instead.
 * `null` remains the answer in every state that is not `web-unsigned`, because
 * there the channel has made no claim to qualify.
 *
 * The string is display state and stays that way: it is read from the in-memory
 * projection on every render and written nowhere. §13.5 — "never logged, never
 * persisted, never sent to analytics" — so there is no copy button, no `title`
 * attribute, and no form control whose value a browser could restore.
 */
export function HostedE2eeVerification() {
  const status = useWebE2eeChannelStatus();
  const code = useWebE2eeVerificationCode();
  if (status !== "web-unsigned") return null;
  const view = hostedE2eeVerificationView(code, "inline");

  if (!view) {
    return (
      <section
        aria-label="Session code"
        data-testid="hosted-e2ee-verification"
        data-code="absent"
        className="space-y-2"
      >
        <p className="text-xs font-medium">Session code</p>
        <p
          data-testid="hosted-e2ee-verification-unavailable"
          className="text-[11px] leading-relaxed text-muted-foreground"
        >
          {E2EE_WEB_SAS_UNAVAILABLE}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="Session code"
      data-testid="hosted-e2ee-verification"
      data-code="present"
      className="space-y-2"
    >
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
      <p className="text-[11px] leading-relaxed text-muted-foreground">{view.advisory}</p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{view.more}</p>
    </section>
  );
}
