import type { AuthSessionId, RelayEffectiveRole } from "@ryco/contracts";

import type { AuthenticatedSession } from "../auth/Services/ServerAuth.ts";

export type RpcPrincipalRole = "viewer" | "operator" | "owner";

export interface RpcPrincipal {
  readonly transport: "direct" | "relay";
  readonly role: RpcPrincipalRole;
  readonly scopeId: string;
  readonly directSessionId?: AuthSessionId;
  readonly canManageLocalAccess: boolean;
}

export const directRpcPrincipal = (session: AuthenticatedSession): RpcPrincipal => ({
  transport: "direct",
  role: session.role === "owner" ? "owner" : "viewer",
  scopeId: session.sessionId,
  directSessionId: session.sessionId,
  canManageLocalAccess: session.role === "owner",
});

export const relayRpcPrincipal = (
  effectiveRole: RelayEffectiveRole,
  channelId: string,
): RpcPrincipal => ({
  transport: "relay",
  role: effectiveRole,
  scopeId: channelId,
  canManageLocalAccess: false,
});
