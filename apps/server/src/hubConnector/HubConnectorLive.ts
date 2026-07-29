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
import { makeLocalHubIdentityStateStore } from "../hubIdentity/LocalHubIdentityState.ts";
import { makeHubRelayTransport } from "./HubRelayTransport.ts";
import type { RelayChannelSessionFactory, RelayRpcChannelSession } from "./RelayChannelRegistry.ts";

export interface HubConnectorServiceShape {
  readonly status: HubConnector["status"];
  readonly resume: HubConnector["resume"];
  readonly enroll: HubConnector["enroll"];
  readonly readEnrollment: HubConnector["readEnrollment"];
  readonly identitySummary: HubConnector["identitySummary"];
  readonly leave: HubConnector["leave"];
  readonly cancelEnrollment: HubConnector["cancelEnrollment"];
  readonly stop: HubConnector["stop"];
}

export class HubConnectorService extends Context.Service<
  HubConnectorService,
  HubConnectorServiceShape
>()("ryco/hubConnector/HubConnectorService") {}

/**
 * The runtime a node gets when key custody could not be constructed at all.
 *
 * Every method throws for the lifetime of the process, so `resume()` provably
 * cannot repair it. It reports `identity_store_unavailable` rather than
 * `identity_unavailable` so the panel can say "restart Ryco" and withhold a
 * Retry button that would do nothing.
 */
const unavailableIdentity = (): HubIdentityRuntimeShape => {
  const unavailable = async (): Promise<never> => {
    throw new HubIdentityRuntimeError("identity_store_unavailable");
  };
  return {
    backend: "permissioned-file",
    readState: unavailable,
    readPendingEnrollment: unavailable,
    leave: unavailable,
    startEnrollment: unavailable,
    pollEnrollment: unavailable,
    cancelEnrollment: unavailable,
    createRelayAuthenticationFrame: unavailable,
    stageKeyRotation: unavailable,
    resumeKeyRotation: unavailable,
    confirmAuthenticatedKey: unavailable,
  };
};

/**
 * A runtime that can answer "is this node enrolled?" and nothing else.
 *
 * Used when the connector is switched off. Constructing the full runtime would
 * open the platform credential store — a keychain prompt on every launch for
 * users who never touch Hub — but identity *presence* lives in the local state
 * file and needs no key custody to read.
 *
 * Without this, a disabled connector reports `unknown`, which callers must treat
 * as "possibly enrolled". On a fresh install that locks the Hub address field
 * and offers a Leave button, making the feature impossible to configure.
 */
const readOnlyIdentity = (options: {
  readonly statePath: string;
  readonly fileSecretRoot: string;
  readonly allowFileFallback: boolean;
}): HubIdentityRuntimeShape => {
  const unavailable = async (): Promise<never> => {
    throw new HubIdentityRuntimeError("identity_unavailable");
  };
  return {
    backend: "permissioned-file",
    readState: async () => {
      const store = await makeLocalHubIdentityStateStore(options.statePath);
      return store.readOrCreate();
    },
    /**
     * Erasing an identity is the one operation that must still work here.
     *
     * The panel offers "Leave this Hub" precisely in this configuration —
     * enrolled, connector switched off — so a stub that throws would report a
     * fabricated "keychain is locked" and leave the key on disk with no way to
     * remove it. Opening key custody is what the operator just asked for, so the
     * full runtime is built on demand rather than on every launch.
     */
    leave: async () => {
      const runtime = await makeHubIdentityRuntime({
        statePath: options.statePath,
        fileSecretRoot: options.fileSecretRoot,
        allowFileFallback: options.allowFileFallback,
      });
      await runtime.leave();
    },
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
      : readOnlyIdentity({
          statePath: config.hubIdentityStatePath,
          fileSecretRoot: `${config.secretsDir}/hub-node`,
          allowFileFallback: config.hubConnector?.allowFileSecretStore ?? false,
        });

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
            supportsChunkedMessages: session.supportsChunkedMessages,
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
        nodeName: undefined,
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
      identitySummary: () => connector.identitySummary(),
      leave: () => connector.leave(),
      cancelEnrollment: () => connector.cancelEnrollment(),
      stop: () => connector.stop(),
    } satisfies HubConnectorServiceShape;
  }),
);
