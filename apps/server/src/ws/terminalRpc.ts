import { Cause, Effect, Queue, Stream } from "effect";
import { type TerminalEvent, TerminalSubscriptionResyncError, WS_METHODS } from "@ryco/contracts";

import {
  approximateJsonBytes,
  recordServerPerfPayload,
} from "../observability/PerfInstrumentation.ts";
import { observeRpcEffect, observeRpcStream } from "../observability/RpcInstrumentation.ts";
import { defineWsHandlers, type WsRpcContext } from "./context.ts";

const TERMINAL_SUBSCRIBER_CAPACITY = 256;
/**
 * Byte ceiling on queued-but-undrained terminal events per subscriber. The
 * event count bound alone lets a stalled client accumulate arbitrarily large
 * output payloads; tripping this budget fails the subscription with the same
 * `slowConsumer` resync signal as count overflow, so the client resynchronizes
 * from the session snapshot (which carries the retained history) instead of
 * the server growing memory without bound.
 */
const TERMINAL_SUBSCRIBER_MAX_BYTES = 4 * 1024 * 1024;

export interface TerminalSubscriberLedger {
  bytes: number;
}

export const releaseTerminalSubscriberEvent = (
  ledger: TerminalSubscriberLedger,
  event: TerminalEvent,
): Effect.Effect<void> =>
  Effect.sync(() => {
    ledger.bytes = Math.max(0, ledger.bytes - approximateJsonBytes(event));
  });

export function makeTerminalSubscriberOffer(
  queue: Queue.Queue<TerminalEvent, TerminalSubscriptionResyncError | Cause.Done<void>>,
  capacity = TERMINAL_SUBSCRIBER_CAPACITY,
  ledger: TerminalSubscriberLedger = { bytes: 0 },
  byteBudget = TERMINAL_SUBSCRIBER_MAX_BYTES,
) {
  let overflowed = false;
  const failWithResync = () =>
    Effect.gen(function* () {
      if (overflowed) return;
      overflowed = true;
      yield* Queue.fail(
        queue,
        new TerminalSubscriptionResyncError({
          reason: "slowConsumer",
          capacity,
        }),
      );
    });
  return (event: TerminalEvent) =>
    Effect.gen(function* () {
      if (overflowed) return;
      recordServerPerfPayload("server.ws.terminal.events", event);
      const eventBytes = approximateJsonBytes(event);
      if (ledger.bytes + eventBytes > byteBudget) {
        yield* failWithResync();
        return;
      }
      if (Queue.offerUnsafe(queue, event)) {
        ledger.bytes += eventBytes;
        return;
      }
      yield* failWithResync();
    });
}

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
          // One fresh byte ledger per subscription run; the release tap keeps
          // it in sync with what the RPC transport has actually pulled.
          Stream.suspend(() => {
            const ledger: TerminalSubscriberLedger = { bytes: 0 };
            return Stream.callback<TerminalEvent, TerminalSubscriptionResyncError>(
              (queue) =>
                Effect.acquireRelease(
                  Effect.gen(function* () {
                    const offerEvent = makeTerminalSubscriberOffer(
                      queue,
                      TERMINAL_SUBSCRIBER_CAPACITY,
                      ledger,
                    );
                    const unsubscribe = yield* terminalManager.subscribe(offerEvent);
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
                        return offerEvent(event);
                      },
                      { discard: true },
                    );
                    return unsubscribe;
                  }),
                  (unsubscribe) => Effect.sync(unsubscribe),
                ),
              { bufferSize: TERMINAL_SUBSCRIBER_CAPACITY, strategy: "dropping" },
            ).pipe(Stream.tap((event) => releaseTerminalSubscriberEvent(ledger, event)));
          }),
        ),
        { "rpc.aggregate": "terminal" },
      ),
  });
};
