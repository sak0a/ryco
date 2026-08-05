import { CONTEXT_HANDOFF_WS_METHODS, ContextHandoffInspectionError } from "@ryco/contracts";
import { Effect, Option } from "effect";

import { observeRpcEffect } from "../observability/RpcInstrumentation.ts";
import { defineWsHandlers, type WsRpcContext } from "./context.ts";

export const makeContextHandoffHandlers = (ctx: WsRpcContext) => {
  const { contextHandoffInspection, withAccess } = ctx;
  const viewer = <A, E, R>(method: string, effect: import("effect").Effect.Effect<A, E, R>) =>
    withAccess("viewer", method, effect);
  const withInspection = <A>(
    use: (
      service: Option.Option.Value<typeof contextHandoffInspection>,
    ) => Effect.Effect<A, ContextHandoffInspectionError>,
  ) =>
    Option.match(contextHandoffInspection, {
      onNone: () =>
        Effect.fail(
          new ContextHandoffInspectionError({
            reason: "internal",
            message: "Context handoff inspection is unavailable.",
          }),
        ),
      onSome: use,
    });

  return defineWsHandlers({
    [CONTEXT_HANDOFF_WS_METHODS.getInspectionSummary]: (input) =>
      observeRpcEffect(
        CONTEXT_HANDOFF_WS_METHODS.getInspectionSummary,
        viewer(
          CONTEXT_HANDOFF_WS_METHODS.getInspectionSummary,
          withInspection((inspection) => inspection.getSummary(input)),
        ),
        { "rpc.aggregate": "context-handoff", "rpc.operation": "summary" },
      ),
    [CONTEXT_HANDOFF_WS_METHODS.listInspectionEntries]: (input) =>
      observeRpcEffect(
        CONTEXT_HANDOFF_WS_METHODS.listInspectionEntries,
        viewer(
          CONTEXT_HANDOFF_WS_METHODS.listInspectionEntries,
          withInspection((inspection) => inspection.listEntries(input)),
        ),
        { "rpc.aggregate": "context-handoff", "rpc.operation": "entries" },
      ),
    [CONTEXT_HANDOFF_WS_METHODS.readRawPayloadChunk]: (input) =>
      observeRpcEffect(
        CONTEXT_HANDOFF_WS_METHODS.readRawPayloadChunk,
        viewer(
          CONTEXT_HANDOFF_WS_METHODS.readRawPayloadChunk,
          withInspection((inspection) => inspection.readRawChunk(input)),
        ),
        { "rpc.aggregate": "context-handoff", "rpc.operation": "raw" },
      ),
    [CONTEXT_HANDOFF_WS_METHODS.readExportChunk]: (input) =>
      observeRpcEffect(
        CONTEXT_HANDOFF_WS_METHODS.readExportChunk,
        viewer(
          CONTEXT_HANDOFF_WS_METHODS.readExportChunk,
          withInspection((inspection) => inspection.readExportChunk(input)),
        ),
        {
          "rpc.aggregate": "context-handoff",
          "rpc.operation": "export",
          "rpc.scope": input.scope,
          "rpc.format": input.format,
        },
      ),
  });
};
