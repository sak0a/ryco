import { Effect, Layer } from "effect";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import { describe, expect, it } from "vite-plus/test";

import { ServerConfig, type ServerConfigShape } from "../../config.ts";
import { makeTestServerConfig } from "../../test/serverConfigFixtures.ts";
import { AuthError } from "../Services/ServerAuth.ts";
import { BrowserHostAuth } from "../Services/BrowserHostAuth.ts";
import { BrowserHostAuthLive } from "./BrowserHostAuth.ts";

const makeRequest = (headers: Record<string, string>): HttpServerRequest.HttpServerRequest =>
  ({ headers }) as unknown as HttpServerRequest.HttpServerRequest;

const runAuth = <A, E>(
  effect: Effect.Effect<A, E, BrowserHostAuth>,
  config: ServerConfigShape = makeTestServerConfig(),
) => {
  const layer = BrowserHostAuthLive.pipe(Layer.provide(Layer.succeed(ServerConfig, config)));
  return Effect.runPromiseExit(effect.pipe(Effect.provide(layer)));
};

describe("BrowserHostAuth", () => {
  it("accepts the desktop host token from loopback", async () => {
    const exit = await runAuth(
      Effect.gen(function* () {
        const auth = yield* BrowserHostAuth;
        return yield* auth.authenticateWebSocketUpgrade(
          makeRequest({
            host: "127.0.0.1:3773",
            authorization: "Bearer secret-token",
          }),
        );
      }),
    );

    expect(exit._tag).toBe("Success");
    if (exit._tag === "Success") {
      expect(exit.value.role).toBe("desktop-browser-host");
    }
  });

  it("accepts local browser host upgrades when the desktop backend binds all interfaces", async () => {
    const exit = await runAuth(
      Effect.gen(function* () {
        const auth = yield* BrowserHostAuth;
        return yield* auth.authenticateWebSocketUpgrade(
          makeRequest({
            host: "127.0.0.1:3773",
            authorization: "Bearer secret-token",
          }),
        );
      }),
      makeTestServerConfig({ host: "0.0.0.0" }),
    );

    expect(exit._tag).toBe("Success");
  });

  it("rejects invalid host tokens", async () => {
    const exit = await runAuth(
      Effect.gen(function* () {
        const auth = yield* BrowserHostAuth;
        return yield* auth.authenticateWebSocketUpgrade(
          makeRequest({
            host: "127.0.0.1:3773",
            authorization: "Bearer wrong-token",
          }),
        );
      }),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");
      expect(failure?.error).toBeInstanceOf(AuthError);
      expect(failure?.error).toMatchObject({ status: 401 });
    }
  });

  it("rejects non-loopback browser host upgrades", async () => {
    const exit = await runAuth(
      Effect.gen(function* () {
        const auth = yield* BrowserHostAuth;
        return yield* auth.authenticateWebSocketUpgrade(
          makeRequest({
            host: "192.0.2.10:3773",
            authorization: "Bearer secret-token",
          }),
        );
      }),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");
      expect(failure?.error).toMatchObject({ status: 403 });
    }
  });
});
