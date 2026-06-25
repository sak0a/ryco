import { Effect, Layer } from "effect";
import { BrowserHostRpcGroup, WsRpcGroup } from "@ryco/contracts";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import * as ProviderMaintenanceRunner from "./provider/providerMaintenanceRunner.ts";
import { ServerAuth } from "./auth/Services/ServerAuth.ts";
import { ServerSecretStoreLive } from "./auth/Layers/ServerSecretStore.ts";
import { AtlassianConnectionRepositoryLive } from "./persistence/Layers/AtlassianConnections.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "./persistence/Layers/Sqlite.ts";
import * as SourceControlDiscoveryLayer from "./sourceControl/SourceControlDiscovery.ts";
import * as AzureDevOpsCli from "./sourceControl/AzureDevOpsCli.ts";
import * as BitbucketApi from "./sourceControl/BitbucketApi.ts";
import * as ForgejoApi from "./sourceControl/ForgejoApi.ts";
import * as GitHubCli from "./sourceControl/GitHubCli.ts";
import * as GitLabCli from "./sourceControl/GitLabCli.ts";
import * as SourceControlProviderRegistry from "./sourceControl/SourceControlProviderRegistry.ts";
import * as GitVcsDriver from "./vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "./vcs/VcsDriverRegistry.ts";
import * as VcsProjectConfig from "./vcs/VcsProjectConfig.ts";
import * as VcsProcess from "./vcs/VcsProcess.ts";
import { respondToAuthError } from "./auth/http.ts";
import { SessionCredentialService } from "./auth/Services/SessionCredentialService.ts";
import { makeWsRpcLayer } from "./ws/index.ts";
import { BrowserHostAuth } from "./auth/Services/BrowserHostAuth.ts";
import { makeBrowserHostRpcLayer } from "./browserHost/browserHostRpc.ts";

export const websocketRpcRouteLayer = Layer.unwrap(
  Effect.succeed(
    HttpRouter.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const serverAuth = yield* ServerAuth;
        const sessions = yield* SessionCredentialService;
        const session = yield* serverAuth.authenticateWebSocketUpgrade(request);
        const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(WsRpcGroup, {
          spanPrefix: "ws.rpc",
          spanAttributes: {
            "rpc.transport": "websocket",
            "rpc.system": "effect-rpc",
          },
        }).pipe(
          Effect.provide(
            makeWsRpcLayer(session).pipe(
              Layer.provideMerge(RpcSerialization.layerJson),
              Layer.provide(ProviderMaintenanceRunner.layer),
              Layer.provide(
                SourceControlDiscoveryLayer.layer.pipe(
                  Layer.provide(
                    SourceControlProviderRegistry.layer.pipe(
                      Layer.provide(
                        Layer.mergeAll(
                          AzureDevOpsCli.layer,
                          BitbucketApi.layer,
                          ForgejoApi.layer,
                          GitHubCli.layer,
                          GitLabCli.layer,
                        ),
                      ),
                      Layer.provideMerge(AtlassianConnectionRepositoryLive),
                      Layer.provideMerge(SqlitePersistenceLayerLive),
                      Layer.provide(ServerSecretStoreLive),
                      Layer.provideMerge(GitVcsDriver.layer),
                      Layer.provide(
                        VcsDriverRegistry.layer.pipe(Layer.provide(VcsProjectConfig.layer)),
                      ),
                    ),
                  ),
                  Layer.provide(VcsProcess.layer),
                ),
              ),
            ),
          ),
        );
        return yield* Effect.acquireUseRelease(
          sessions.markConnected(session.sessionId),
          () => rpcWebSocketHttpEffect,
          () => sessions.markDisconnected(session.sessionId),
        );
      }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
    ),
  ),
);

export const browserHostRpcRouteLayer = Layer.unwrap(
  Effect.succeed(
    HttpRouter.add(
      "GET",
      "/browser-host/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const browserHostAuth = yield* BrowserHostAuth;
        yield* browserHostAuth.authenticateWebSocketUpgrade(request);
        const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(BrowserHostRpcGroup, {
          spanPrefix: "browser-host.rpc",
          spanAttributes: {
            "rpc.transport": "websocket",
            "rpc.system": "effect-rpc",
            "rpc.aggregate": "browserHost",
          },
        }).pipe(
          Effect.provide(
            makeBrowserHostRpcLayer().pipe(Layer.provideMerge(RpcSerialization.layerJson)),
          ),
        );
        return yield* rpcWebSocketHttpEffect;
      }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
    ),
  ),
);
