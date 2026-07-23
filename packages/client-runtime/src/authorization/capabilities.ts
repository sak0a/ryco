import type { RelayEffectiveRole } from "@ryco/contracts";
import { hostedRoleAllows } from "@ryco/shared/rpcAccessPolicy";

export interface HostedRpcCapability {
  readonly hosted: boolean;
  readonly allowed: boolean;
  readonly reason: string | null;
}

export function resolveHostedRpcCapability(input: {
  readonly hosted: boolean;
  readonly role: RelayEffectiveRole | null;
  readonly fresh: boolean;
  readonly browserCurrent?: boolean;
  readonly sessionReady?: boolean;
  readonly method: string;
}): HostedRpcCapability {
  if (!input.hosted) return { hosted: false, allowed: true, reason: null };
  if (!input.fresh || input.browserCurrent === false || input.sessionReady === false) {
    return {
      hosted: true,
      allowed: false,
      reason: "This action is unavailable while Hub authorization or the relay is stale.",
    };
  }
  if (hostedRoleAllows(input.role, input.method, true)) {
    return { hosted: true, allowed: true, reason: null };
  }
  return {
    hosted: true,
    allowed: false,
    reason: "This action is unavailable for your role on the selected node.",
  };
}
