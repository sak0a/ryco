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
 * WebAuthn credential id — a public identifier, never authenticator secret
 * material. The remaining members are display metadata and are `null` whenever
 * the Hub omits them; nothing outside this shape is projected.
 */
export interface HostedHubPasskey {
  readonly id: string;
  readonly label: string | null;
  readonly createdAt: number | null;
  readonly lastUsedAt: number | null;
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
