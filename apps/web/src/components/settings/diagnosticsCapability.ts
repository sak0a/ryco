import type { AuthSessionRole } from "@ryco/contracts";

/** Primary authentication is owned by the primary connection, not the saved-node catalog. */
export function canRequestDirectDiagnostics(input: {
  readonly primary: boolean;
  readonly connected: boolean;
  readonly role: AuthSessionRole | null | undefined;
}): boolean {
  if (!input.connected || input.role === "client") return false;
  // A primary connection has already passed the app's authentication gate. Its
  // saved-environment role is normally absent; each RPC still enforces owner
  // authorization on the server. Saved nodes do have an authoritative role.
  return input.primary || input.role === "owner";
}
