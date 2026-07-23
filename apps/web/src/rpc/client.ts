import { createAtomRpcClient } from "@ryco/client-runtime/connection";
import { appAtomRegistry } from "@ryco/client-runtime/rpc";
import type { Effect } from "effect";

import { ensurePrimaryEnvironmentReady, getPrimaryKnownEnvironment } from "~/environments/primary";
import { webSocket } from "../platform/socket";

const client = createAtomRpcClient(
  {
    ensureReady: ensurePrimaryEnvironmentReady,
    readKnownEnvironment: getPrimaryKnownEnvironment,
  },
  appAtomRegistry,
  webSocket,
);

// The app keeps only this compatibility binding; callers consume atom-backed hooks.
export const AtomRpcClient: object = client.Client;
export function runRpc<A, E>(use: (client: never) => Effect.Effect<A, E>): Promise<A> {
  return client.runRpc(use as never);
}
