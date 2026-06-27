import { Effect } from "effect";
import { WS_METHODS } from "@ryco/contracts";

import { observeRpcEffect } from "../observability/RpcInstrumentation.ts";
import { defineWsHandlers, type WsRpcContext } from "./context.ts";

export const makeStatisticsHandlers = (ctx: WsRpcContext) => {
  const { statisticsQuery, ownerEffect } = ctx;

  return defineWsHandlers({
    // Owner-gated: the snapshot exposes every project's title and usage, so only
    // the owner session may read it (paired guests get an AuthRpcError).
    [WS_METHODS.serverGetStatistics]: (_input) =>
      observeRpcEffect(
        WS_METHODS.serverGetStatistics,
        ownerEffect(
          WS_METHODS.serverGetStatistics,
          statisticsQuery.getStatistics().pipe(Effect.orDie),
        ),
        { "rpc.aggregate": "server" },
      ),
  });
};
