import { Context, Effect, Exit, Layer, Scope } from "effect";
import { WsRpcGroup } from "@ryco/contracts";

import { ServerConfig } from "../config.ts";
import { ServerEnvironment } from "../environment/Services/ServerEnvironment.ts";
import { makeRpcByteSession } from "../ws/RpcByteSession.ts";
import { relayRpcPrincipal } from "../ws/RpcPrincipal.ts";
import { makeServerWsRpcLayer } from "../ws.ts";
import { HubConnector } from "./HubConnector.ts";
import {
  HubIdentityRuntimeError,
  type HubIdentityRuntimeShape,
  makeHubIdentityRuntime,
} from "./HubIdentityRuntime.ts";
import { makeHubRelayTransport } from "./HubRelayTransport.ts";
import type { RelayChannelSessionFactory, RelayRpcChannelSession } from "./RelayChannelRegistry.ts";

export interface HubConnectorServiceShape {
  readonly status: HubConnector["status"];
  readonly resume: HubConnector["resume"];
  readonly enroll: HubConnector["enroll"];
  readonly readEnrollment: HubConnector["readEnrollment"];
  readonly cancelEnrollment: HubConnector["cancelEnrollment"];
  readonly stop: HubConnector["stop"];
}

export class HubConnectorService extends Context.Service<
  HubConnectorService,
  HubConnectorServiceShape
>()("ryco/hubConnector/HubConnectorService") {}

const unavailableIdentity = (): HubIdentityRuntimeShape => {
  const unavailable = async (): Promise<never> => {
    throw new HubIdentityRuntimeError("identity_unavailable");
  };
  return {
    backend: "permissioned-file",
    readState: unavailable,
    readPendingEnrollment: unavailable,
    startEnrollment: unavailable,
    pollEnrollment: unavailable,
    cancelEnrollment: unavailable,
    createRelayAuthenticationFrame: unavailable,
    stageKeyRotation: unavailable,
    resumeKeyRotation: unavailable,
    confirmAuthenticatedKey: unavailable,
  };
};

export const HubConnectorLive = Layer.effect(
  HubConnectorService,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const environment = yield* ServerEnvironment;
    const descriptor = yield* environment.getDescriptor;
    const runtimeContext = yield* Effect.context<never>();
    const runPromise = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.runPromiseWith(runtimeContext as Context.Context<R>)(effect);
    const identity = config.hubConnector?.enabled
      ? yield* Effect.tryPromise({
          try: () =>
            makeHubIdentityRuntime({
              statePath: config.hubIdentityStatePath,
              fileSecretRoot: `${config.secretsDir}/hub-node`,
              allowFileFallback: config.hubConnector?.allowFileSecretStore ?? false,
            }),
          catch: () => new HubIdentityRuntimeError("identity_unavailable"),
        }).pipe(Effect.orElseSucceed(unavailableIdentity))
      : unavailableIdentity();

    const channelFactory: RelayChannelSessionFactory = {
      open: async ({ channelId, effectiveRole, send }) => {
        const scope = await runPromise(Scope.make("sequential"));
        try {
          const session = await runPromise(
            makeRpcByteSession(
              WsRpcGroup,
              makeServerWsRpcLayer(relayRpcPrincipal(effectiveRole, channelId)),
              (bytes) =>
                Effect.sync(() => {
                  if (!send(bytes)) throw new Error("Relay channel output is full.");
                }),
              { queueCapacity: 64 },
            ).pipe(Effect.provideService(Scope.Scope, scope)),
          );
          return {
            receive: (bytes) => runPromise(session.receive(bytes)),
            queuedBytes: () => runPromise(session.queuedBytes),
            close: () => runPromise(Scope.close(scope, Exit.void)),
          } satisfies RelayRpcChannelSession;
        } catch (error: unknown) {
          await runPromise(Scope.close(scope, Exit.void));
          throw error;
        }
      },
    };

    const connector = new HubConnector({
      config: config.hubConnector ?? {
        enabled: false,
        origin: undefined,
        reconnectBaseMs: 1_000,
        reconnectMaxMs: 60_000,
        reconnectStableMs: 60_000,
        reconnectJitterRatio: 0.2,
        allowFileSecretStore: false,
        configurationIssue: undefined,
      },
      identity,
      transport: makeHubRelayTransport(),
      channels: channelFactory,
      enrollmentMetadata: {
        label: descriptor.label,
        platformOs: descriptor.platform.os,
        platformArch: descriptor.platform.arch,
        clientVersion: descriptor.serverVersion,
      },
    });
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        void connector.start();
        return connector;
      }),
      (active) => Effect.promise(() => active.stop()),
    );
    return {
      status: () => connector.status(),
      resume: () => connector.resume(),
      enroll: () => connector.enroll(),
      readEnrollment: () => connector.readEnrollment(),
      cancelEnrollment: () => connector.cancelEnrollment(),
      stop: () => connector.stop(),
    } satisfies HubConnectorServiceShape;
  }),
);
