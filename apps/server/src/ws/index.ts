import { Effect } from "effect";
import { WsRpcGroup } from "@ryco/contracts";

import type { AuthenticatedSession } from "../auth/Services/ServerAuth.ts";
import { makeWsRpcContext } from "./context.ts";
import { makeOrchestrationHandlers } from "./orchestrationRpc.ts";
import { makeGitHandlers } from "./gitRpc.ts";
import { makeTerminalHandlers } from "./terminalRpc.ts";
import { makeProjectHandlers } from "./projectRpc.ts";
import { makeSourceControlHandlers } from "./sourceControlRpc.ts";
import { makeProviderHandlers } from "./providerRpc.ts";
import { makeBrowserHandlers } from "./browserRpc.ts";

export const makeWsRpcLayer = (session: AuthenticatedSession) =>
  WsRpcGroup.toLayer(
    Effect.gen(function* () {
      const ctx = yield* makeWsRpcContext(session);
      return WsRpcGroup.of({
        ...makeOrchestrationHandlers(ctx),
        ...makeProviderHandlers(ctx),
        ...makeSourceControlHandlers(ctx),
        ...makeProjectHandlers(ctx),
        ...makeGitHandlers(ctx),
        ...makeTerminalHandlers(ctx),
        ...makeBrowserHandlers(ctx),
      });
    }),
  );
