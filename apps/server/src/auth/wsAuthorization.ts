import { AuthRpcError } from "@ryco/contracts";
import { Effect } from "effect";

import type { AuthenticatedSession } from "./Services/ServerAuth.ts";

export type WsRpcAccess = "owner" | "authenticated" | "local-desktop-owner";

export function authorizeWsRpc(
  session: AuthenticatedSession,
  access: WsRpcAccess,
  method: string,
): Effect.Effect<void, AuthRpcError> {
  if ((access === "owner" || access === "local-desktop-owner") && session.role !== "owner") {
    return Effect.fail(
      new AuthRpcError({
        message: `Only owner sessions can call ${method}.`,
        status: 403,
      }),
    );
  }

  if (access === "local-desktop-owner" && session.isLoopback !== true) {
    return Effect.fail(
      new AuthRpcError({
        message: `Only local desktop sessions can call ${method}.`,
        status: 403,
      }),
    );
  }

  return Effect.void;
}
