import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {
  BrowserHostId,
  BrowserHostRpcGroup,
  BrowserHostRunId,
  BROWSER_HOST_METHODS,
} from "@ryco/contracts";
import type {
  BrowserEvent,
  BrowserHostCommandEnvelope,
  BrowserCommandResult,
} from "@ryco/contracts";
import { Effect, Exit, Layer, ManagedRuntime, Scope, Stream } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";

const makeBrowserHostRpcClient = RpcClient.make(BrowserHostRpcGroup);
type BrowserHostRpcClient =
  typeof makeBrowserHostRpcClient extends Effect.Effect<infer Client, any, any> ? Client : never;

type CommandHandler = (command: BrowserHostCommandEnvelope) => Promise<BrowserCommandResult>;

function browserHostWsUrl(wsBaseUrl: string): string {
  const url = new URL(wsBaseUrl);
  url.pathname = "/browser-host/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function browserHostProtocolLayer(
  wsUrl: string,
  token: string,
): Layer.Layer<RpcClient.Protocol, never, never> {
  const webSocketConstructorLayer = Layer.succeed(
    Socket.WebSocketConstructor,
    (socketUrl, protocols) =>
      new NodeSocket.NodeWS.WebSocket(socketUrl, protocols, {
        headers: {
          authorization: `Bearer ${token}`,
        },
      }) as unknown as globalThis.WebSocket,
  );

  return RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(wsUrl).pipe(Layer.provide(webSocketConstructorLayer))),
    Layer.provide(RpcSerialization.layerJson),
  );
}

export class BrowserHostConnection {
  private runtime: ManagedRuntime.ManagedRuntime<RpcClient.Protocol, never> | null = null;
  private client: BrowserHostRpcClient | null = null;
  private clientScope: Scope.Scope | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private commandStreamAbort = false;
  private readonly handleCommand: CommandHandler;

  readonly hostId: BrowserHostId;
  readonly runId: BrowserHostRunId;

  constructor(appRunId: string, handleCommand: CommandHandler) {
    this.handleCommand = handleCommand;
    this.hostId = BrowserHostId.make(`desktop-browser-host:${appRunId}`);
    this.runId = BrowserHostRunId.make(`desktop-browser-host-run:${crypto.randomUUID()}`);
  }

  async start(input: { readonly wsBaseUrl: string; readonly token: string }): Promise<void> {
    await this.stop();
    this.commandStreamAbort = false;
    const runtime = ManagedRuntime.make(
      browserHostProtocolLayer(browserHostWsUrl(input.wsBaseUrl), input.token),
    );
    this.runtime = runtime;
    const clientScope = runtime.runSync(Scope.make());
    this.clientScope = clientScope;
    const client = await runtime.runPromise(Scope.provide(clientScope)(makeBrowserHostRpcClient));
    this.client = client;
    await runtime.runPromise(
      client[BROWSER_HOST_METHODS.register]({
        hostId: this.hostId,
        runId: this.runId,
        capabilities: {
          surface: true,
          persistentProfiles: true,
          temporaryProfiles: true,
          screenshots: false,
          domSnapshot: true,
          input: true,
          downloads: false,
          devtools: false,
        },
      }),
    );
    this.startCommandStream(client);
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat().catch((error) => {
        console.warn("[desktop-browser-host] heartbeat failed", error);
      });
    }, 5_000);
    this.heartbeatTimer.unref();
  }

  async stop(): Promise<void> {
    this.commandStreamAbort = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    const runtime = this.runtime;
    const clientScope = this.clientScope;
    this.runtime = null;
    this.client = null;
    this.clientScope = null;
    if (runtime) {
      if (clientScope) {
        await runtime.runPromise(Scope.close(clientScope, Exit.void)).catch(() => undefined);
      }
      await runtime.dispose();
    }
  }

  async publishEvent(event: BrowserEvent): Promise<void> {
    const runtime = this.runtime;
    const client = this.client;
    if (!runtime || !client) return;
    await runtime.runPromise(
      client[BROWSER_HOST_METHODS.event]({
        hostId: this.hostId,
        runId: this.runId,
        event,
      }),
    );
  }

  private async heartbeat(): Promise<void> {
    const runtime = this.runtime;
    const client = this.client;
    if (!runtime || !client) return;
    await runtime.runPromise(
      client[BROWSER_HOST_METHODS.heartbeat]({
        hostId: this.hostId,
        runId: this.runId,
      }),
    );
  }

  private startCommandStream(client: BrowserHostRpcClient): void {
    const runtime = this.runtime;
    if (!runtime) return;
    void runtime
      .runPromise(
        Stream.runForEach(
          client[BROWSER_HOST_METHODS.subscribeCommands]({
            hostId: this.hostId,
            runId: this.runId,
          }),
          (envelope) =>
            Effect.promise(async () => {
              if (this.commandStreamAbort) return;
              const result = await this.handleCommand(envelope);
              await runtime.runPromise(
                client[BROWSER_HOST_METHODS.commandResult]({
                  hostId: this.hostId,
                  runId: this.runId,
                  result,
                }),
              );
            }),
        ),
      )
      .catch((error) => {
        if (!this.commandStreamAbort) {
          console.warn("[desktop-browser-host] command stream closed", error);
        }
      });
  }
}
