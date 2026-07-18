import {
  EnvironmentId,
  ORCHESTRATION_WS_METHODS,
  ProjectId,
  RELAY_INITIAL_LIMITS,
  type RelayChannelId,
  type RelayFrame,
  WsRpcGroup,
} from "@ryco/contracts";
import { decodeRelayFrame, encodeRelayFrame } from "@ryco/shared/relayCodec";
import { Effect, Exit, Scope, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createWsRpcClient } from "../../../web/src/rpc/wsRpcClient.ts";
import { WsTransport } from "../../../web/src/rpc/wsTransport.ts";
import { encodeBase64Url } from "../../../web/src/hostedHub/base64url.ts";
import { hostedHubApi } from "../../../web/src/hostedHub/api.ts";
import { hostedHubController, useHostedHubStore } from "../../../web/src/hostedHub/state.ts";
import {
  getHostedRelayAttemptFactory,
  resetHostedRelayAttemptFactory,
} from "../../../web/src/hostedHub/transport.ts";
import type { HostedHubNode } from "../../../web/src/hostedHub/types.ts";
import { makeRpcByteSession } from "../ws/RpcByteSession.ts";
import { RelayChannelRegistry } from "./RelayChannelRegistry.ts";
import { RelaySendQueue } from "./RelaySendQueue.ts";

const VERSION = { protocolMajor: 1, protocolMinor: 2 } as const;
const CHANNEL_ID = `ch_${"c".repeat(22)}` as RelayChannelId;
const originalWindow = globalThis.window;
const originalWebSocket = globalThis.WebSocket;

function toBytes(value: string | ArrayBufferLike | Blob | ArrayBufferView): Uint8Array {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  throw new Error("Unexpected Blob write in hosted relay integration test.");
}

class PhysicalRelaySocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = PhysicalRelaySocket.CONNECTING;
  bufferedAmount = 0;
  binaryType: BinaryType = "blob";
  readonly receivedFromClient: RelayFrame[] = [];

  constructor(private readonly registry: RelayChannelRegistry) {
    super();
  }

  open(): void {
    this.readyState = PhysicalRelaySocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  send(value: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    const decoded = decodeRelayFrame(toBytes(value));
    if (!decoded.ok) throw new Error("Hosted client emitted an invalid relay frame.");
    const frame = decoded.value;
    this.receivedFromClient.push(frame);
    if (frame.type === "auth") {
      this.deliver({ type: "ready", ...VERSION, limits: RELAY_INITIAL_LIMITS });
      const openFrame: RelayFrame = {
        type: "channel.open",
        ...VERSION,
        channelId: CHANNEL_ID,
        capability: "ryco.rpc",
        effectiveRole: "operator",
      };
      this.deliver(openFrame);
      void this.registry.handle(openFrame);
      return;
    }
    void this.registry.handle(frame);
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === PhysicalRelaySocket.CLOSED) return;
    this.readyState = PhysicalRelaySocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close", { code, reason, wasClean: code === 1000 }));
  }

  deliver(frame: RelayFrame): void {
    const encoded = encodeRelayFrame(frame);
    if (!encoded.ok) throw new Error("Test relay frame could not be encoded.");
    this.deliverBytes(encoded.value);
  }

  deliverBytes(bytes: Uint8Array): void {
    const owned = Uint8Array.from(bytes);
    this.dispatchEvent(new MessageEvent("message", { data: owned.buffer }));
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "http://localhost:3020" } },
  });
  globalThis.WebSocket = PhysicalRelaySocket as unknown as typeof WebSocket;
});

afterEach(() => {
  resetHostedRelayAttemptFactory();
  hostedHubController.resetForTests();
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  globalThis.WebSocket = originalWebSocket;
  vi.restoreAllMocks();
});

describe("hosted relay session integration", () => {
  it("streams the initial shell snapshot, acknowledges it, and receives a later event", async () => {
    const snapshot = {
      kind: "snapshot" as const,
      snapshot: {
        snapshotSequence: 0,
        projects: [],
        worktrees: [],
        threads: [],
        updatedAt: "2026-07-18T00:00:00.000Z",
      },
    };
    const laterEvent = {
      kind: "project-removed" as const,
      sequence: 1,
      projectId: ProjectId.make("project-public-test"),
    };
    const handlerLayer = WsRpcGroup.toLayer(
      Effect.succeed(
        WsRpcGroup.of({
          [ORCHESTRATION_WS_METHODS.subscribeShell]: () =>
            Stream.concat(
              Stream.succeed(snapshot),
              Stream.concat(
                Stream.fromEffect(Effect.sleep(10).pipe(Effect.as(laterEvent))),
                Stream.never,
              ),
            ),
        } as never),
      ),
    );
    const sessionScopes: Scope.Closeable[] = [];
    let physicalSocket: PhysicalRelaySocket | null = null;
    const relaySocket = {
      bufferedAmount: 0,
      send: (bytes: Uint8Array) => physicalSocket?.deliverBytes(bytes),
    };
    const sendQueue = new RelaySendQueue(relaySocket, RELAY_INITIAL_LIMITS);
    const registry = new RelayChannelRegistry({
      limits: RELAY_INITIAL_LIMITS,
      sendQueue,
      onOutboundReady: () => sendQueue.flush(),
      factory: {
        open: async ({ send }) => {
          const scope = await Effect.runPromise(Scope.make("sequential"));
          sessionScopes.push(scope);
          const session = await Effect.runPromise(
            makeRpcByteSession(
              WsRpcGroup,
              handlerLayer,
              (bytes) =>
                Effect.sync(() => {
                  if (!send(bytes)) throw new Error("Test relay output queue is full.");
                }),
              { queueCapacity: 8 },
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
    globalThis.WebSocket = class extends PhysicalRelaySocket {
      constructor() {
        super(registry);
        physicalSocket = this;
        queueMicrotask(() => this.open());
      }
    } as unknown as typeof WebSocket;
    const selectedNode: HostedHubNode = {
      id: "node_aaaaaaaaaaaaaaaaaaaaaa",
      environmentId: EnvironmentId.make("env_aaaaaaaaaaaaaaaaaaaaaa"),
      label: "Public test node",
      platformOs: "linux",
      platformArch: "x64",
      clientVersion: "0.1.8",
      createdAt: 1,
      updatedAt: 1,
      lastAuthenticatedAt: 1,
      revokedAt: null,
      revocationReasonCode: null,
      grant: { id: "grant_aaaaaaaaaaaaaaaaaaaaaa", role: "operator" },
      effectiveRole: "operator",
      presence: { online: true, lastHeartbeatAt: 1 },
    };
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      directoryStatus: "ready",
      selectedNode,
      selectionStatus: "online",
      effectiveRole: "operator",
      generation: 1,
    });
    vi.spyOn(hostedHubApi, "issueRelayTicket").mockResolvedValue({
      ticket: encodeBase64Url(new Uint8Array(32).fill(7)),
      expiresAt: Date.now() + 60_000,
    });
    const attemptFactory = getHostedRelayAttemptFactory();
    const transport = new WsTransport(
      () => attemptFactory.nextUrl(),
      attemptFactory.lifecycleHandlers(),
    );
    const client = createWsRpcClient(transport);
    const received: unknown[] = [];
    const unsubscribe = client.orchestration.subscribeShell((item) => received.push(item));

    await vi.waitFor(() => expect(received).toEqual([snapshot, laterEvent]));

    expect(useHostedHubStore.getState()).toMatchObject({
      transportStatus: "online",
      sessionStatus: "synchronizing",
      effectiveRole: "operator",
    });
    expect(
      physicalSocket.receivedFromClient.filter(
        (frame) => frame.type === "data" && frame.channelId === CHANNEL_ID,
      ).length,
    ).toBeGreaterThanOrEqual(2);
    unsubscribe();
    await client.dispose();
    await registry.closeAll();
    for (const scope of sessionScopes) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
  });
});
