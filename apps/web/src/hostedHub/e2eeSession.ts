import type { WebHostedE2eeChannelStatus } from "./connectionStatus";

// The PER-CHANNEL §4.4 projection for this tier, and nothing else.
//
// It holds two values: the channel state the §4.4 machine locked, and §13.5's
// rendered `WebSAS` for the session that locked it. Both are ephemeral by
// §13.5's own rule — "forbids logging, persisting, or sending it to analytics" —
// so this module keeps them in module scope, hands them out only through a
// snapshot, and drops them the moment the channel or the selection stops being
// current.
//
// IT SHIPS NO COPY. The status word, the §13.5 disclosure, and every other
// user-facing string belong to the surface that renders them; §2.2 and §2.3
// forbid this tier from claiming operator-proof protection, and a claim is made
// in words, not in a union member. `web-unsigned` is §2.2's own row name and is
// the strongest state this module can ever hold — `verified` and `unverified`
// are not in `WebHostedE2eeChannelStatus` at all (see `connectionStatus.ts`), so
// the native rows are unrepresentable here rather than merely unused.

export interface WebE2eeSessionState {
  /** §4.4's channel state, narrowed to the states a web client can be in. */
  readonly status: WebHostedE2eeChannelStatus;
  /**
   * §13.5's rendered code for the CURRENT `e2ee` session, or `null`.
   *
   * It is the display string and never key material: §13.5 derives it inside the
   * shared handshake from this client's Noise ephemeral and the §8.8
   * `sessionBindingHash`, neither of which leaves that module.
   */
  readonly verificationCode: string | null;
}

const UNAVAILABLE: WebE2eeSessionState = Object.freeze({
  status: "unavailable",
  verificationCode: null,
});

let state: WebE2eeSessionState = UNAVAILABLE;
const listeners = new Set<() => void>();

function publish(next: WebE2eeSessionState): void {
  if (next.status === state.status && next.verificationCode === state.verificationCode) return;
  state = next;
  for (const listener of listeners) listener();
}

/** A stable snapshot, safe to pass to `useSyncExternalStore`. */
export function webE2eeSessionState(): WebE2eeSessionState {
  return state;
}

export function subscribeWebE2eeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * A new channel is negotiating (§4.4), which claims nothing.
 *
 * §13 projection is PER CHANNEL and not per selection: a state earned by one
 * channel may not describe the next one, and the §13.5 code is bound to a single
 * session by construction. Publishing `negotiating` here is what keeps either
 * from surviving the socket that produced it.
 */
export function beginWebE2eeChannelAttempt(): void {
  publish({ status: "negotiating", verificationCode: null });
}

/**
 * §4.4's single mode lock, projected.
 *
 * `e2ee` becomes `web-unsigned` — §2.2's *Web, unsigned ephemeral* row — and
 * never `verified`: the Hub serves this client's JavaScript (§2.4), so a locked
 * NX channel is not the native guarantee and must not be reported as one.
 */
export function lockWebE2eeChannelMode(mode: "e2ee" | "legacy"): void {
  publish({
    status: mode === "e2ee" ? "web-unsigned" : "legacy",
    verificationCode: mode === "e2ee" ? state.verificationCode : null,
  });
}

/**
 * §13.5's code, published by the §4.4 machine after ITS OWN `e2ee` lock.
 *
 * THE ORDERING IS THE SUBTLE PART, and gating this on `web-unsigned` silently
 * threw the code away. §4.4's mode lock is a state the machine holds rather than
 * a callback, so the machine locks, derives, and publishes here — and only then
 * does the caller's post-operation sync tell this module the mode changed. The
 * live state at this instant is therefore still `negotiating`.
 *
 * `unavailable` and `legacy` are refused because neither can ever have a code:
 * one has no channel and the other locked plaintext, so a value arriving in
 * either describes a session that does not exist.
 */
export function publishWebE2eeVerificationCode(code: string): void {
  if (state.status === "unavailable" || state.status === "legacy") return;
  publish({ status: state.status, verificationCode: code });
}

/**
 * Drop the projection. Called when the selection or the session ends — a
 * standing `web-unsigned` would otherwise describe a channel for a node the
 * owner has left, or for an account that has signed out.
 */
export function resetWebE2eeSession(): void {
  publish(UNAVAILABLE);
}
