import { Effect } from "effect";
import { WsRpcGroup } from "@ryco/contracts";

import type { AuthenticatedSession } from "../auth/Services/ServerAuth.ts";
import { makeWsRpcContext } from "./context.ts";
import { directRpcPrincipal, type RpcPrincipal } from "./RpcPrincipal.ts";
import { makeOrchestrationHandlers } from "./orchestrationRpc.ts";
import { makeGitHandlers } from "./gitRpc.ts";
import { makeTerminalHandlers } from "./terminalRpc.ts";
import { makeProjectHandlers } from "./projectRpc.ts";
import { makeSourceControlHandlers } from "./sourceControlRpc.ts";
import { makeProviderHandlers } from "./providerRpc.ts";
import { makeStatisticsHandlers } from "./statisticsRpc.ts";

export const makeWsRpcLayer = (principal: RpcPrincipal) =>
  WsRpcGroup.toLayer(
    Effect.gen(function* () {
      const ctx = yield* makeWsRpcContext(principal);
      return WsRpcGroup.of({
        ...makeOrchestrationHandlers(ctx),
        ...makeProviderHandlers(ctx),
        ...makeStatisticsHandlers(ctx),
        ...makeSourceControlHandlers(ctx),
        ...makeProjectHandlers(ctx),
        ...makeGitHandlers(ctx),
        ...makeTerminalHandlers(ctx),
      });
    }),
  );

export const makeDirectWsRpcLayer = (session: AuthenticatedSession) =>
  makeWsRpcLayer(directRpcPrincipal(session));
