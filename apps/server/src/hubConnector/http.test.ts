import * as NodeHttp from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";
import type { HubConnectorStatus } from "@ryco/contracts";

import { AuthControlPlane } from "../auth/Services/AuthControlPlane.ts";
import { AuthControlPlaneRuntimeLive } from "../auth/Layers/AuthControlPlane.ts";
import { ServerAuthLive } from "../auth/Layers/ServerAuth.ts";
import { ServerSecretStoreLive } from "../auth/Layers/ServerSecretStore.ts";
import { deriveServerPaths, ServerConfig, type ServerConfigShape } from "../config.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "../persistence/Layers/Sqlite.ts";
import { HubConnectorService } from "./HubConnectorLive.ts";
import { hubConnectorRoutesLayer } from "./http.ts";

const ONLINE_STATUS: HubConnectorStatus = {
  state: "online",
  transitionedAt: "1970-01-01T00:00:00.000Z",
  protocolMajor: 1,
  protocolMinor: 2,
  activeChannels: 2,
  queuedBytes: 0,
};

const REVOKED_STATUS: HubConnectorStatus = {
  state: "revoked",
  transitionedAt: "1970-01-01T00:00:00.000Z",
  failure: "authentication_failed",
  activeChannels: 0,
  queuedBytes: 0,
};

const DEGRADED_OPERATOR_STATUS: HubConnectorStatus = {
  state: "degraded",
  transitionedAt: "1970-01-01T00:00:00.000Z",
  degradedMode: "operator_action_required",
  failure: "connection_replaced",
  activeChannels: 0,
  queuedBytes: 0,
};

interface ConnectorStub {
  /** Statuses returned in order; the last one repeats once exhausted. */
  readonly statuses: ReadonlyArray<HubConnectorStatus>;
  readonly resumeThrows?: boolean;
}

const makeConnectorStub = (stub: ConnectorStub) => {
  let resumeCalls = 0;
  let statusIndex = 0;
  const service = {
    status: () => stub.statuses[Math.min(statusIndex, stub.statuses.length - 1)]!,
    resume: async () => {
      resumeCalls += 1;
      if (stub.resumeThrows) throw new Error("boom: origin https://hub.example.test node_abc123");
      // A real resume that does something advances the observable status; the
      // no-op cases (revoked, stopping, disabled) leave it where it was.
      statusIndex += 1;
    },
    enroll: async () => {
      throw new Error("not used");
    },
    cancelEnrollment: async () => stub.statuses[0]!,
    stop: async () => undefined,
  };
  return {
    service,
    resumeCalls: () => resumeCalls,
  };
};

const makeTestServerConfig = (baseDir: string) =>
  Effect.gen(function* () {
    const derivedPaths = yield* deriveServerPaths(baseDir, undefined);
    return {
      logLevel: "Info",
      traceMinLevel: "Info",
      traceTimingEnabled: true,
      traceBatchWindowMs: 0,
      traceMaxBytes: 1_000_000,
      traceMaxFiles: 2,
      otlpTracesUrl: undefined,
      otlpMetricsUrl: undefined,
      otlpExportIntervalMs: 60_000,
      otlpServiceName: "ryco-test",
      mode: "server",
      port: 0,
      host: "127.0.0.1",
      cwd: baseDir,
      baseDir,
      staticDir: undefined,
      devUrl: undefined,
      noBrowser: true,
      startupPresentation: "quiet",
      desktopBootstrapToken: undefined,
      autoBootstrapProjectFromCwd: false,
      logWebSocketEvents: false,
      tailscaleServeEnabled: false,
      tailscaleServePort: 443,
      ...derivedPaths,
    } as unknown as ServerConfigShape;
  });

const withHubRoutes = <A, E, R>(
  stub: ConnectorStub,
  run: (context: {
    readonly origin: string;
    readonly ownerToken: string;
    readonly clientToken: string;
    readonly resumeCalls: () => number;
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const baseDir = mkdtempSync(join(tmpdir(), "ryco-hub-http-test-"));
    const config = yield* makeTestServerConfig(baseDir);
    const connector = makeConnectorStub(stub);

    const appLayer = HttpRouter.serve(hubConnectorRoutesLayer, {
      disableListenLog: true,
      disableLogger: true,
    }).pipe(
      Layer.provide(Layer.succeed(HubConnectorService, connector.service)),
      Layer.provideMerge(
        Layer.mergeAll(ServerAuthLive, AuthControlPlaneRuntimeLive).pipe(
          Layer.provideMerge(SqlitePersistenceLayerLive),
          Layer.provide(ServerSecretStoreLive),
        ),
      ),
      Layer.provideMerge(
        NodeHttpServer.layer(NodeHttp.createServer, { host: "127.0.0.1", port: 0 }),
      ),
      Layer.provideMerge(NodeServices.layer),
      Layer.provide(Layer.succeed(ServerConfig, config)),
    );

    return yield* Effect.scoped(
      Effect.gen(function* () {
        const server = yield* HttpServer.HttpServer;
        const address = server.address;
        if (typeof address === "string" || !("port" in address)) {
          assert.fail(`Expected a TCP address, got ${String(address)}`);
        }
        const authControlPlane = yield* AuthControlPlane;
        const owner = yield* authControlPlane.issueSession({ role: "owner", label: "test owner" });
        const client = yield* authControlPlane.issueSession({
          role: "client",
          label: "test client",
        });
        return yield* run({
          origin: `http://127.0.0.1:${address.port}`,
          ownerToken: owner.token,
          clientToken: client.token,
          resumeCalls: connector.resumeCalls,
        });
      }).pipe(Effect.provide(Layer.mergeAll(appLayer, NodeServices.layer))),
    );
  });

const post = (origin: string, path: string, token?: string) =>
  Effect.promise(() =>
    fetch(`${origin}${path}`, {
      method: "POST",
      headers: token === undefined ? {} : { Authorization: `Bearer ${token}` },
    }),
  );

const get = (origin: string, path: string, token?: string) =>
  Effect.promise(() =>
    fetch(`${origin}${path}`, {
      headers: token === undefined ? {} : { Authorization: `Bearer ${token}` },
    }),
  );

it.layer(NodeServices.layer)("hub connector http routes", (it) => {
  it.effect("resume returns the resulting status to an owner session", () =>
    withHubRoutes(
      { statuses: [DEGRADED_OPERATOR_STATUS, ONLINE_STATUS] },
      ({ origin, ownerToken, resumeCalls }) =>
        Effect.gen(function* () {
          const response = yield* post(origin, "/api/hub/resume", ownerToken);
          assert.equal(response.status, 200);
          const body = (yield* Effect.promise(() => response.json())) as HubConnectorStatus;
          assert.equal(body.state, "online");
          assert.equal(resumeCalls(), 1);
        }),
    ),
  );

  it.effect("resume is idempotent and never throws on a repeated call", () =>
    withHubRoutes(
      { statuses: [DEGRADED_OPERATOR_STATUS, ONLINE_STATUS] },
      ({ origin, ownerToken, resumeCalls }) =>
        Effect.gen(function* () {
          const first = yield* post(origin, "/api/hub/resume", ownerToken);
          const second = yield* post(origin, "/api/hub/resume", ownerToken);
          assert.equal(first.status, 200);
          assert.equal(second.status, 200);
          const body = (yield* Effect.promise(() => second.json())) as HubConnectorStatus;
          assert.equal(body.state, "online");
          assert.equal(resumeCalls(), 2);
        }),
    ),
  );

  // `resume()` deliberately early-returns for a revoked connector. The route must
  // report the unchanged terminal state rather than implying it acted, because the
  // settings panel relies on this to keep saying "will not retry".
  it.effect("resume leaves a revoked connector revoked", () =>
    withHubRoutes({ statuses: [REVOKED_STATUS] }, ({ origin, ownerToken }) =>
      Effect.gen(function* () {
        const response = yield* post(origin, "/api/hub/resume", ownerToken);
        assert.equal(response.status, 200);
        const body = (yield* Effect.promise(() => response.json())) as HubConnectorStatus;
        assert.equal(body.state, "revoked");
      }),
    ),
  );

  it.effect("resume reports a bounded failure and never echoes the underlying error", () =>
    withHubRoutes(
      { statuses: [DEGRADED_OPERATOR_STATUS], resumeThrows: true },
      ({ origin, ownerToken }) =>
        Effect.gen(function* () {
          const response = yield* post(origin, "/api/hub/resume", ownerToken);
          assert.equal(response.status, 400);
          const text = yield* Effect.promise(() => response.text());
          assert.isFalse(text.includes("hub.example.test"), "response leaked an origin");
          assert.isFalse(text.includes("node_abc123"), "response leaked a node identifier");
          assert.isFalse(text.includes("boom"), "response leaked raw error text");
        }),
    ),
  );

  it.effect("every hub route rejects a non-owner session", () =>
    withHubRoutes({ statuses: [ONLINE_STATUS] }, ({ origin, clientToken, resumeCalls }) =>
      Effect.gen(function* () {
        const status = yield* get(origin, "/api/hub/status", clientToken);
        const resume = yield* post(origin, "/api/hub/resume", clientToken);
        const enrollment = yield* post(origin, "/api/hub/enrollment", clientToken);
        const cancel = yield* post(origin, "/api/hub/enrollment/cancel", clientToken);

        assert.equal(status.status, 403);
        assert.equal(resume.status, 403);
        assert.equal(enrollment.status, 403);
        assert.equal(cancel.status, 403);
        assert.equal(resumeCalls(), 0, "resume ran despite a rejected session");
      }),
    ),
  );

  it.effect("every hub route rejects an unauthenticated request", () =>
    withHubRoutes({ statuses: [ONLINE_STATUS] }, ({ origin, resumeCalls }) =>
      Effect.gen(function* () {
        const status = yield* get(origin, "/api/hub/status");
        const resume = yield* post(origin, "/api/hub/resume");
        const enrollment = yield* post(origin, "/api/hub/enrollment");
        const cancel = yield* post(origin, "/api/hub/enrollment/cancel");

        for (const response of [status, resume, enrollment, cancel]) {
          assert.isTrue(
            response.status === 401 || response.status === 403,
            `expected an auth rejection, got ${response.status}`,
          );
        }
        assert.equal(resumeCalls(), 0, "resume ran without authentication");
      }),
    ),
  );

  it.effect("a rejection body names no origin, identifier, or route detail", () =>
    withHubRoutes({ statuses: [ONLINE_STATUS] }, ({ origin, clientToken }) =>
      Effect.gen(function* () {
        const response = yield* post(origin, "/api/hub/resume", clientToken);
        const text = yield* Effect.promise(() => response.text());
        assert.isFalse(text.includes("127.0.0.1"), "rejection leaked a host");
        assert.isFalse(text.includes("node_"), "rejection leaked a node identifier");
        assert.isFalse(text.includes("env_"), "rejection leaked an environment identifier");
      }),
    ),
  );
});
