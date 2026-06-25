import { Effect, Queue, Stream } from "effect";
import { type TerminalEvent, WS_METHODS } from "@ryco/contracts";

import { observeRpcEffect, observeRpcStream } from "../observability/RpcInstrumentation.ts";
import { recordServerPerfPayload } from "../observability/PerfInstrumentation.ts";
import { defineWsHandlers, type WsRpcContext } from "./context.ts";

export const makeTerminalHandlers = (ctx: WsRpcContext) => {
  const { ownerEffect, ownerStream, terminalManager } = ctx;

  return defineWsHandlers({
    [WS_METHODS.terminalOpen]: (input) =>
      observeRpcEffect(
        WS_METHODS.terminalOpen,
        ownerEffect(WS_METHODS.terminalOpen, terminalManager.open(input)),
        {
          "rpc.aggregate": "terminal",
        },
      ),
    [WS_METHODS.terminalWrite]: (input) =>
      observeRpcEffect(
        WS_METHODS.terminalWrite,
        ownerEffect(WS_METHODS.terminalWrite, terminalManager.write(input)),
        {
          "rpc.aggregate": "terminal",
        },
      ),
    [WS_METHODS.terminalResize]: (input) =>
      observeRpcEffect(
        WS_METHODS.terminalResize,
        ownerEffect(WS_METHODS.terminalResize, terminalManager.resize(input)),
        {
          "rpc.aggregate": "terminal",
        },
      ),
    [WS_METHODS.terminalClear]: (input) =>
      observeRpcEffect(
        WS_METHODS.terminalClear,
        ownerEffect(WS_METHODS.terminalClear, terminalManager.clear(input)),
        {
          "rpc.aggregate": "terminal",
        },
      ),
    [WS_METHODS.terminalRestart]: (input) =>
      observeRpcEffect(
        WS_METHODS.terminalRestart,
        ownerEffect(WS_METHODS.terminalRestart, terminalManager.restart(input)),
        {
          "rpc.aggregate": "terminal",
        },
      ),
    [WS_METHODS.terminalClose]: (input) =>
      observeRpcEffect(
        WS_METHODS.terminalClose,
        ownerEffect(WS_METHODS.terminalClose, terminalManager.close(input)),
        {
          "rpc.aggregate": "terminal",
        },
      ),
    [WS_METHODS.subscribeTerminalEvents]: (_input) =>
      observeRpcStream(
        WS_METHODS.subscribeTerminalEvents,
        ownerStream(
          WS_METHODS.subscribeTerminalEvents,
          Stream.callback<TerminalEvent>((queue) =>
            Effect.acquireRelease(
              Effect.gen(function* () {
                const unsubscribe = yield* terminalManager.subscribe((event) =>
                  Effect.gen(function* () {
                    recordServerPerfPayload("server.ws.terminal.events", event);
                    yield* Queue.offer(queue, event);
                  }),
                );
                const snapshots = yield* terminalManager.listSessions;
                yield* Effect.forEach(
                  snapshots.filter((snapshot) => snapshot.status === "running"),
                  (snapshot) => {
                    const event: TerminalEvent = {
                      type: "started",
                      threadId: snapshot.threadId,
                      terminalId: snapshot.terminalId,
                      createdAt: new Date().toISOString(),
                      snapshot,
                    };
                    recordServerPerfPayload("server.ws.terminal.events", event);
                    return Queue.offer(queue, event);
                  },
                  { discard: true },
                );
                return unsubscribe;
              }),
              (unsubscribe) => Effect.sync(unsubscribe),
            ),
          ),
        ),
        { "rpc.aggregate": "terminal" },
      ),
  });
};
