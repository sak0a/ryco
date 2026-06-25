import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { AuthSessionId } from "@ryco/contracts";
import { authorizeWsRpc } from "./wsAuthorization.ts";
import type { AuthenticatedSession } from "./Services/ServerAuth.ts";

const makeSession = (
  role: AuthenticatedSession["role"],
  input?: { readonly isLoopback?: boolean },
): AuthenticatedSession => ({
  sessionId: AuthSessionId.make(`session-${role}`),
  subject: role,
  method: "browser-session-cookie",
  role,
  ...(input?.isLoopback !== undefined ? { isLoopback: input.isLoopback } : {}),
});

it.effect("allows owner sessions to call owner websocket RPC methods", () =>
  Effect.gen(function* () {
    const result = yield* authorizeWsRpc(makeSession("owner"), "owner", "terminal.open").pipe(
      Effect.result,
    );
    expect(result._tag).toBe("Success");
  }),
);

it.effect("rejects client sessions from owner websocket RPC methods", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(
      authorizeWsRpc(makeSession("client"), "owner", "terminal.open"),
    );
    expect(error.message).toBe("Only owner sessions can call terminal.open.");
    expect(error.status).toBe(403);
  }),
);

it.effect("allows authenticated client sessions to call authenticated websocket RPC methods", () =>
  Effect.gen(function* () {
    const result = yield* authorizeWsRpc(
      makeSession("client"),
      "authenticated",
      "server.getConfig",
    ).pipe(Effect.result);
    expect(result._tag).toBe("Success");
  }),
);

it.effect("allows local owner sessions to call local desktop websocket RPC methods", () =>
  Effect.gen(function* () {
    const result = yield* authorizeWsRpc(
      makeSession("owner", { isLoopback: true }),
      "local-desktop-owner",
      "browser.openSession",
    ).pipe(Effect.result);
    expect(result._tag).toBe("Success");
  }),
);

it.effect("rejects remote owner sessions from local desktop websocket RPC methods", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(
      authorizeWsRpc(
        makeSession("owner", { isLoopback: false }),
        "local-desktop-owner",
        "browser.openSession",
      ),
    );
    expect(error.message).toBe("Only local desktop sessions can call browser.openSession.");
    expect(error.status).toBe(403);
  }),
);
