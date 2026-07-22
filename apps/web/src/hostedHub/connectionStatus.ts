import type {
  HostedBrowserStatus,
  HostedRelayTransportStatus,
  HostedRycoSessionStatus,
  HostedSelectionStatus,
} from "./types";

/**
 * The bounded inputs of the hosted connection status derivation. A subset of
 * the hosted hub store state so the selector stays pure and callable from the
 * phone pill, the connection sheet, and the desktop menu alike.
 */
export interface HostedConnectionStatusInput {
  readonly browserStatus: HostedBrowserStatus;
  readonly sessionStatus: HostedRycoSessionStatus;
  readonly selectionStatus: HostedSelectionStatus;
  readonly transportStatus: HostedRelayTransportStatus;
}

/**
 * Runtime enumerations of the derivation's four inputs.
 *
 * The unions are types, so without these a caller — a test in particular —
 * could only ever cover a hand-picked subset, and a state added to a union
 * would silently ship with no coverage. `satisfies Record<Union, true>` makes
 * each list exhaustive at compile time in both directions: a missing member
 * and a stale member are both type errors, so extending a union forces the
 * list, and the list drives the vocabulary sweep.
 */
export const HOSTED_BROWSER_STATUSES = Object.keys({
  current: true,
  suspended: true,
  offline: true,
  "checking-access": true,
  synchronizing: true,
  stale: true,
} satisfies Record<HostedBrowserStatus, true>) as ReadonlyArray<HostedBrowserStatus>;

export const HOSTED_RYCO_SESSION_STATUSES = Object.keys({
  synchronizing: true,
  ready: true,
  stale: true,
  replaying: true,
  "delivery-unknown": true,
  closed: true,
} satisfies Record<HostedRycoSessionStatus, true>) as ReadonlyArray<HostedRycoSessionStatus>;

export const HOSTED_SELECTION_STATUSES = Object.keys({
  none: true,
  online: true,
  offline: true,
  incompatible: true,
  revoked: true,
  "authorization-removed": true,
} satisfies Record<HostedSelectionStatus, true>) as ReadonlyArray<HostedSelectionStatus>;

export const HOSTED_RELAY_TRANSPORT_STATUSES = Object.keys({
  idle: true,
  "requesting-ticket": true,
  connecting: true,
  authenticating: true,
  "opening-channel": true,
  online: true,
  reconnecting: true,
  draining: true,
  "terminal-failure": true,
} satisfies Record<HostedRelayTransportStatus, true>) as ReadonlyArray<HostedRelayTransportStatus>;

/**
 * The complete bounded connection status vocabulary, as a type.
 *
 * Naming the union is what lets the collapsed presentation be an exhaustive
 * `Record` over it rather than a string transformation: a state added to any
 * input union has to be given a short label and a connectedness before the
 * repository compiles.
 */
export type HostedConnectionStatusText =
  | "Offline"
  | "Checking access"
  | "Synchronizing"
  | "Stale"
  | "Delivery unknown"
  | "Authorization removed"
  | "Revoked"
  | "Incompatible"
  | "Online"
  | "Reconnecting"
  | "idle"
  | "requesting ticket"
  | "connecting"
  | "authenticating"
  | "opening channel"
  | "online"
  | "draining"
  | "terminal failure";

/**
 * The transport fall-through's display text, replacing an inline
 * `replaceAll("-", " ")` so the derivation's return type is the named union.
 * Every entry is the string that expression produced, with one exception:
 * `reconnecting` is unreachable here because the dedicated branch above the
 * fall-through already claims it, and mirroring that branch's `Reconnecting`
 * keeps a lowercase twin out of the vocabulary.
 */
const HOSTED_TRANSPORT_STATUS_TEXTS: Record<
  HostedRelayTransportStatus,
  HostedConnectionStatusText
> = {
  idle: "idle",
  "requesting-ticket": "requesting ticket",
  connecting: "connecting",
  authenticating: "authenticating",
  "opening-channel": "opening channel",
  online: "online",
  reconnecting: "Reconnecting",
  draining: "draining",
  "terminal-failure": "terminal failure",
};

/**
 * Derive the single bounded connection status text rendered everywhere the
 * hosted connection state appears (extracted unchanged from the node menu so
 * every presentation renders identical state). The vocabulary is the approved
 * bounded set; no raw errors or identifiers ever pass through here.
 */
export function deriveHostedConnectionStatusText(
  input: HostedConnectionStatusInput,
): HostedConnectionStatusText {
  const { browserStatus, sessionStatus, selectionStatus, transportStatus } = input;
  return browserStatus === "offline"
    ? "Offline"
    : browserStatus === "checking-access"
      ? "Checking access"
      : browserStatus === "synchronizing"
        ? "Synchronizing"
        : browserStatus === "suspended" || browserStatus === "stale"
          ? "Stale"
          : sessionStatus === "delivery-unknown"
            ? "Delivery unknown"
            : selectionStatus === "authorization-removed"
              ? "Authorization removed"
              : selectionStatus === "revoked"
                ? "Revoked"
                : selectionStatus === "incompatible"
                  ? "Incompatible"
                  : transportStatus === "online" && sessionStatus === "ready"
                    ? "Online"
                    : transportStatus === "reconnecting"
                      ? "Reconnecting"
                      : selectionStatus === "offline"
                        ? "Offline"
                        : HOSTED_TRANSPORT_STATUS_TEXTS[transportStatus];
}

/**
 * How the collapsed indicator presents one bounded status.
 *
 * `connected` is the glyph decision, kept here rather than at the call site so
 * the icon cannot contradict the word beside it. Choosing the glyph from
 * `transportStatus` alone — as the presentations did — put a green connected
 * wifi icon next to `Delivery unknown`, next to `Authorization removed`, and
 * next to a closed ryco session, because the text derivation gates on browser,
 * session, and selection state *before* it ever looks at the transport.
 */
export interface HostedConnectionStatusIndicator {
  /** The collapsed chip's visible label. */
  readonly shortLabel: string;
  /** True only where the full text means a usable connection. */
  readonly connected: boolean;
}

/**
 * The collapsed presentation of every bounded status, as an exhaustive map.
 *
 * An earlier revision derived the short label mechanically, as the leading
 * token of the full text. That was wrong three ways and this map exists to fix
 * all three:
 *
 * - It stripped polarity exactly where polarity is the message.
 *   `Authorization removed` became the neutral noun `Authorization`,
 *   `Delivery unknown` — the one state with a mandatory acknowledgement flow —
 *   became `Delivery`, and `terminal failure` became `Terminal`, which on a
 *   product with terminals reads as a feature. Severity then survived only in
 *   glyph and colour, which is the invariant icon-only was rejected to protect.
 * - It collapsed two genuinely different states onto one rendering. `Online`
 *   (a ready ryco session) and `online` (transport up, session synchronizing,
 *   replaying, stale, or CLOSED) differ only in case, so a closed session
 *   rendered a green `Online`.
 * - Nothing about a token forces it to stay short, or to stay a word.
 *
 * Every label here is chosen, not computed, and bounded: no raw error,
 * identifier, ticket, or payload can reach it. The full text is unchanged and
 * still carries the state in the accessible name and in the expanded sheet.
 */
export const HOSTED_CONNECTION_STATUS_INDICATORS = {
  Offline: { shortLabel: "Offline", connected: false },
  "Checking access": { shortLabel: "Checking", connected: false },
  Synchronizing: { shortLabel: "Syncing", connected: false },
  Stale: { shortLabel: "Stale", connected: false },
  "Delivery unknown": { shortLabel: "Unconfirmed", connected: false },
  "Authorization removed": { shortLabel: "No access", connected: false },
  Revoked: { shortLabel: "Revoked", connected: false },
  Incompatible: { shortLabel: "Incompatible", connected: false },
  Online: { shortLabel: "Online", connected: true },
  Reconnecting: { shortLabel: "Reconnecting", connected: false },
  idle: { shortLabel: "Idle", connected: false },
  "requesting ticket": { shortLabel: "Preparing", connected: false },
  connecting: { shortLabel: "Connecting", connected: false },
  authenticating: { shortLabel: "Verifying", connected: false },
  "opening channel": { shortLabel: "Opening", connected: false },
  online: { shortLabel: "Not ready", connected: false },
  draining: { shortLabel: "Closing", connected: false },
  "terminal failure": { shortLabel: "Failed", connected: false },
} as const satisfies Record<HostedConnectionStatusText, HostedConnectionStatusIndicator>;

/** The bounded vocabulary as values, ordered by the map above. */
export const HOSTED_CONNECTION_STATUS_TEXTS = Object.keys(
  HOSTED_CONNECTION_STATUS_INDICATORS,
) as ReadonlyArray<HostedConnectionStatusText>;

/** The collapsed indicator's presentation for one bounded state. */
export function deriveHostedConnectionStatusIndicator(
  input: HostedConnectionStatusInput,
): HostedConnectionStatusIndicator {
  return HOSTED_CONNECTION_STATUS_INDICATORS[deriveHostedConnectionStatusText(input)];
}
