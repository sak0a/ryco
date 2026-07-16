import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { AuthSessionId } from "@ryco/contracts";

import { authorizeRpcPrincipal } from "../auth/wsAuthorization.ts";
import { directRpcPrincipal, relayRpcPrincipal } from "./RpcPrincipal.ts";

it.effect("enforces viewer, operator, owner, and direct-owner access", () =>
  Effect.gen(function* () {
    const viewer = relayRpcPrincipal("viewer", "channel-viewer");
    const operator = relayRpcPrincipal("operator", "channel-operator");
    const relayOwner = relayRpcPrincipal("owner", "channel-owner");
    const directOwner = directRpcPrincipal({
      sessionId: AuthSessionId.make("session-owner"),
      subject: "owner",
      method: "browser-session-cookie",
      role: "owner",
    });

    expect((yield* authorizeRpcPrincipal(viewer, "viewer", "read").pipe(Effect.result))._tag).toBe(
      "Success",
    );
    expect(
      (yield* authorizeRpcPrincipal(viewer, "operator", "write").pipe(Effect.result))._tag,
    ).toBe("Failure");
    expect(
      (yield* authorizeRpcPrincipal(operator, "operator", "write").pipe(Effect.result))._tag,
    ).toBe("Success");
    expect(
      (yield* authorizeRpcPrincipal(operator, "owner", "settings").pipe(Effect.result))._tag,
    ).toBe("Failure");
    expect(
      (yield* authorizeRpcPrincipal(relayOwner, "direct_owner", "access").pipe(Effect.result))._tag,
    ).toBe("Failure");
    expect(
      (yield* authorizeRpcPrincipal(directOwner, "direct_owner", "access").pipe(Effect.result))
        ._tag,
    ).toBe("Success");
  }),
);
