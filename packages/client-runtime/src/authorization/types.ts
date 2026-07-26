import type { EnvironmentId, RelayCloseReason, RelayEffectiveRole } from "@ryco/contracts";

export type HostedAccountStatus =
  | "signed-out"
  | "authenticating"
  | "authenticated"
  | "signing-out"
  | "session-expired"
  | "unavailable";

export type HostedDirectoryStatus = "idle" | "loading" | "ready" | "stale";

export type HostedSelectionStatus =
  | "none"
  | "online"
  | "offline"
  | "incompatible"
  | "revoked"
  | "authorization-removed";

export type HostedRelayTransportStatus =
  | "idle"
  | "requesting-ticket"
  | "connecting"
  | "authenticating"
  | "opening-channel"
  | "online"
  | "reconnecting"
  | "draining"
  | "terminal-failure";

export type HostedRycoSessionStatus =
  | "synchronizing"
  | "ready"
  | "stale"
  | "replaying"
  | "delivery-unknown"
  | "closed";

export type HostedBrowserStatus =
  | "current"
  | "suspended"
  | "offline"
  | "checking-access"
  | "synchronizing"
  | "stale";

export interface HostedHubAccount {
  readonly id: string;
  readonly displayName: string;
  readonly role: RelayEffectiveRole;
  readonly createdAt: number;
  readonly disabledAt: number | null;
}

export interface HostedHubSession {
  readonly id: string;
  readonly accountId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly lastSeenAt: number;
  readonly revokedAt: number | null;
  readonly revocationReasonCode: string | null;
}

export interface HostedHubSessionResponse {
  readonly account: HostedHubAccount;
  readonly session: HostedHubSession;
  /**
   * Present in cookie mode (the session-bound CSRF token). Absent in bearer
   * mode, where request authentication rides `Authorization: DPoP` + a proof
   * and the native session token is held by the session-credentials seam
   * rather than returned here.
   */
  readonly csrfToken?: string;
  readonly recoveryCodes?: ReadonlyArray<string>;
}

/**
 * A passkey credential registered against the signed-in account. `id` is the
 * Hub's credential identifier — a public handle, never authenticator secret
 * material — and is what `revokePasskey` takes. The remaining members are
 * display metadata and are `null` whenever the Hub omits them or returns them in
 * an unrecognised shape; nothing outside this shape is projected.
 *
 * `backupEligible` / `backupState` describe whether the credential is
 * synchronisable and whether it is currently backed up — the difference between
 * a passkey that survives losing the device and one that does not.
 * `revokedAt` / `revocationReasonCode` are non-null once the credential has been
 * revoked; the list reports revoked credentials rather than hiding them, so a
 * surface can explain why a device stopped working.
 */
export interface HostedHubPasskey {
  readonly id: string;
  readonly label: string | null;
  readonly createdAt: number | null;
  readonly lastUsedAt: number | null;
  readonly backupEligible: boolean | null;
  readonly backupState: boolean | null;
  readonly revokedAt: number | null;
  readonly revocationReasonCode: string | null;
}

/**
 * A started TOTP enrolment.
 *
 * **Both members are secret key material.** `secretBase32` is the shared key and
 * `provisioningUri` embeds it. They exist to be shown once, on the enrolment
 * screen, as a QR code and a manual-entry fallback. They must never be
 * persisted, logged, sent to analytics, or placed in an error, and a surface
 * holding them must drop them as soon as the screen is dismissed — the same
 * contract recovery codes carry.
 */
export interface HostedTotpEnrollment {
  readonly secretBase32: string;
  readonly provisioningUri: string;
}

/**
 * The outcome of an add-passkey ceremony. `confirmed` is `true` only when the
 * Hub's verify response positively described the enrolled credential; when it
 * is `false` the ceremony was accepted (a non-2xx would have thrown) but
 * carried no evidence of what was enrolled, so the caller must confirm against
 * a fresh passkey list before reporting success.
 */
export interface HostedAddPasskeyResult {
  readonly passkey: HostedHubPasskey | null;
  readonly confirmed: boolean;
}

/**
 * Why an account action did not commit.
 *
 * `"cancelled"` is the one that most needs to be distinguishable: an aborted
 * action leaves no error message behind — deliberately, because a user who
 * cancelled did not fail at anything — so a caller that infers success from
 * "no error message" reports a cancellation as a success. It is a refusal.
 */
export type HostedAccountRefusalReason =
  /** Another account action was already running; nothing was attempted. */
  | "busy"
  /** No authenticated Hub session; nothing was attempted. */
  | "signed-out"
  /** Aborted by `cancelAccountAction` (or a caller signal) before it committed. */
  | "cancelled"
  /** The Hub rejected the session; the runtime has torn the account down. */
  | "session-expired"
  /** The session changed under the action, so its result was discarded unpublished. */
  | "superseded"
  /** The Hub (or transport) refused the request. See `errorCode`. */
  | "request-failed";

/**
 * An account action that did not commit.
 *
 * `errorCode` is the machine-readable reason, and is what a security branch
 * should switch on — never the message, which is display copy and may be
 * reworded at any time. It is `null` for refusals that never reached the Hub.
 *
 * `wireErrorCode` is the code the Hub actually sent. When `inferredErrorCode`
 * is `true` the two differ: `errorCode` was synthesised client-side from the
 * route (see `narrowCode` in `api.ts`) and is a best guess, not the Hub's
 * answer. A surface acting on an inferred code must stay escapable.
 */
export interface HostedAccountRefused {
  readonly status: "refused";
  readonly reason: HostedAccountRefusalReason;
  readonly errorCode: string | null;
  readonly wireErrorCode: string | null;
  readonly inferredErrorCode: boolean;
  readonly errorMessage: string | null;
}

/** An account action whose effect is committed at the Hub. */
export interface HostedAccountCommitted {
  readonly status: "committed";
}

/**
 * The result of an account action.
 *
 * Discriminated on `status` so a caller never has to infer an outcome by
 * re-reading shared mutable state after the await — a read that is racy (a
 * concurrent action or a post-commit refresh writes the same slot) and
 * ambiguous (a cancelled action leaves no error, and so reads as success).
 */
export type HostedAccountOutcome = HostedAccountCommitted | HostedAccountRefused;

/**
 * How sure the runtime is that an enrolled passkey exists.
 *
 * Only meaningful alongside `status: "committed"` — the Hub verified the
 * ceremony, so *something* was enrolled. The distinction that matters is
 * `"unverified"`: the credential is on the account but the confirming re-read
 * did not complete, so a surface must close its enrolment flow (re-running it
 * enrols a *second* credential) while telling the user the list could not be
 * checked.
 */
export type HostedPasskeyConfirmation =
  /** A fresh list read contains the credential. */
  | "confirmed"
  /** Enrolled, but the confirming read failed — the enrolment still happened. */
  | "unverified"
  /** The confirming read succeeded and did not contain the credential. */
  | "missing";

export interface HostedAddPasskeyCommitted extends HostedAccountCommitted {
  readonly confirmation: HostedPasskeyConfirmation;
  /** The credential the Hub described, when it described one. Public metadata only. */
  readonly passkey: HostedHubPasskey | null;
}

export type HostedAddPasskeyOutcome = HostedAddPasskeyCommitted | HostedAccountRefused;

export interface HostedRecoveryCodesCommitted extends HostedAccountCommitted {
  /**
   * `true` when the new codes reached the display slot. `false` means the
   * rotation happened — the previous codes are dead — but no surface had a
   * display lease when it was asked for, so the runtime dropped them rather
   * than strand live recovery credentials in a slot nothing renders. See
   * `leaseRecoveryCodeDisplay`.
   */
  readonly displayed: boolean;
}

export type HostedRecoveryCodesOutcome = HostedRecoveryCodesCommitted | HostedAccountRefused;

export interface HostedTotpEnrollmentCommitted extends HostedAccountCommitted {
  /** `false` when the enrolment screen was dismissed before the secret arrived. */
  readonly displayed: boolean;
}

export type HostedTotpEnrollmentOutcome = HostedTotpEnrollmentCommitted | HostedAccountRefused;

export interface HostedNodeEnrollment {
  readonly id: string;
  readonly label: string;
  readonly platformOs: "darwin" | "linux" | "windows" | "unknown";
  readonly platformArch: "arm64" | "x64" | "other";
  readonly clientVersion: string;
  readonly algorithm: "ed25519";
  readonly fingerprint: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface HostedHubNode {
  readonly id: string;
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly platformOs: "darwin" | "linux" | "windows" | "unknown";
  readonly platformArch: "arm64" | "x64" | "other";
  readonly clientVersion: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastAuthenticatedAt: number | null;
  readonly revokedAt: number | null;
  readonly revocationReasonCode: string | null;
  readonly grant: { readonly id: string; readonly role: RelayEffectiveRole };
  readonly effectiveRole: RelayEffectiveRole;
  readonly presence: { readonly online: boolean; readonly lastHeartbeatAt: number | null };
}

export interface HostedRelayTicket {
  readonly ticket: string;
  readonly expiresAt: number;
  readonly protocolMajor: 1;
  readonly protocolMinor: 2;
}

export type HostedRelayFailureKind =
  | "network"
  | "dns"
  | "tls"
  | "authentication"
  | "session-expired"
  | "offline"
  | "revoked"
  | "authorization-removed"
  | "incompatible"
  | "draining"
  | "replacement"
  | "rate-limited"
  | "slow-consumer"
  | "protocol"
  | "internal";

export interface HostedRelayFailure {
  readonly kind: HostedRelayFailureKind;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly closeReason?: RelayCloseReason;
}
