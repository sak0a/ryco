import { describe, expect, it } from "vite-plus/test";

import { MessageId, ORCHESTRATION_WS_METHODS, ThreadId, WsRpcGroup } from "@ryco/contracts";
import type { RelayChannelId, RelayFrame, RelayLimits } from "@ryco/contracts/relay";
import { decodeRelayFrame } from "@ryco/shared/relayCodec";
import { Effect, Exit, Scope } from "effect";

import { makeRpcByteSession } from "../ws/RpcByteSession.ts";
import type { WsRpcContext } from "../ws/context.ts";
import { makeOrchestrationHandlers } from "../ws/orchestrationRpc.ts";
import { RelayChannelRegistry } from "./RelayChannelRegistry.ts";
import { RelaySendQueue } from "./RelaySendQueue.ts";

const channelId = `ch_${"R".repeat(22)}` as RelayChannelId;
const version = { protocolMajor: 1, protocolMinor: 2 } as const;
const limits: RelayLimits = {
  maxControlFrameBytes: 1_024,
  maxDataChunkBytes: 4_096,
  maxQueuedBytes: 16_384,
  maxChannels: 2,
  heartbeatIntervalMs: 20_000,
  deadConnectionTimeoutMs: 45_000,
  authenticationDeadlineMs: 5_000,
};

const request = new TextEncoder().encode(
  JSON.stringify({
    _tag: "Request",
    id: "1",
    tag: ORCHESTRATION_WS_METHODS.searchThreadMessages,
    payload: { query: "needle", limit: 5 },
    headers: [],
  }),
);

function decode(bytes: Uint8Array): RelayFrame {
  const result = decodeRelayFrame(bytes);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

describe("relay RPC integration", () => {
  it("runs a real Ryco RPC handler through a canonical logical relay channel", async () => {
    const sent: Uint8Array[] = [];
    const socket = {
      bufferedAmount: 0,
      send: (bytes: Uint8Array) => sent.push(Uint8Array.from(bytes)),
    };
    const sendQueue = new RelaySendQueue(socket, limits);
    const searchResult = {
      threadId: ThreadId.make("thread-relay-rpc"),
      messageId: MessageId.make("message-relay-rpc"),
      snippet: "payload-canary-00-ff",
      timestamp: "2026-07-16T00:00:00.000Z",
    };
    const handlers = makeOrchestrationHandlers({
      projectionSnapshotQuery: {
        searchThreadMessages: () => Effect.succeed([searchResult]),
      },
    } as unknown as WsRpcContext);
    const handlerLayer = WsRpcGroup.toLayer(
      Effect.succeed(
        WsRpcGroup.of({
          [ORCHESTRATION_WS_METHODS.searchThreadMessages]:
            handlers[ORCHESTRATION_WS_METHODS.searchThreadMessages],
        } as never),
      ),
    );
    const registry = new RelayChannelRegistry({
      limits,
      sendQueue,
      factory: {
        open: async ({ send }) => {
          const scope = await Effect.runPromise(Scope.make("sequential"));
          const session = await Effect.runPromise(
            makeRpcByteSession(
              WsRpcGroup,
              handlerLayer,
              (bytes) =>
                Effect.sync(() => {
                  if (!send(bytes)) throw new Error("relay output full");
                }),
              { queueCapacity: 4 },
            ).pipe(Effect.provideService(Scope.Scope, scope)),
          );
          return {
            receive: (bytes: Uint8Array) => Effect.runPromise(session.receive(bytes)),
            queuedBytes: () => Effect.runPromise(session.queuedBytes),
            close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
          };
        },
      },
    });

    await registry.handle({
      type: "channel.open",
      ...version,
      channelId,
      capability: "ryco.rpc",
      effectiveRole: "viewer",
    });
    sendQueue.flush();
    expect(decode(sent[0]!).type).toBe("channel.accept");

    await registry.handle({
      type: "data",
      ...version,
      channelId,
      sequence: 0 as never,
      payload: request,
    });
    for (let turn = 0; turn < 100 && sendQueue.queuedBytes === 0; turn += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    sendQueue.flush();
    const responseFrame = decode(sent.at(-1)!);
    expect(responseFrame.type).toBe("data");
    if (responseFrame.type !== "data") throw new Error("expected relay data response");
    const response = JSON.parse(new TextDecoder().decode(responseFrame.payload)) as {
      readonly requestId: string;
      readonly exit: { readonly _tag: string; readonly value: unknown };
    };
    expect(response).toMatchObject({
      requestId: "1",
      exit: { _tag: "Success", value: [searchResult] },
    });

    await registry.closeAll();
    expect(registry.size).toBe(0);
  });
});
