import { getKnownEnvironmentWsBaseUrl } from "@ryco/client-runtime/knownEnvironment";
import { WsRpcGroup } from "@ryco/contracts";
import { Effect } from "effect";
import { AtomRegistry, AtomRpc } from "effect/unstable/reactivity";

import { ensurePrimaryEnvironmentReady, getPrimaryKnownEnvironment } from "~/environments/primary";

import { appAtomRegistry } from "@ryco/client-runtime/rpc";
import { createWsRpcProtocolLayer } from "@ryco/client-runtime/rpc";
import { webSocket } from "../platform";

async function resolvePrimaryWsBaseUrl(): Promise<string> {
  await ensurePrimaryEnvironmentReady();
  const wsBaseUrl = getKnownEnvironmentWsBaseUrl(getPrimaryKnownEnvironment());
  if (!wsBaseUrl) {
    throw new Error("Primary environment WebSocket transport URL is unavailable.");
  }
  return wsBaseUrl;
}

/**
 * Single `AtomRpc.Service` for the websocket {@link WsRpcGroup}. Atoms produced
 * by `AtomRpcClient.query`/`AtomRpcClient.mutation` resolve over the shared
 * websocket protocol layer extracted into {@link createWsRpcProtocolLayer}.
 *
 * The protocol is resolved lazily against the primary environment, so importing
 * this module performs no network work; the socket is only opened once an atom
 * derived from this service is first read.
 */
export class AtomRpcClient extends AtomRpc.Service<AtomRpcClient>()("AtomRpcClient", {
  group: WsRpcGroup,
  protocol: createWsRpcProtocolLayer(resolvePrimaryWsBaseUrl, webSocket),
  spanPrefix: "AtomRpcClient",
}) {}

type AtomRpcClientShape = Parameters<Parameters<typeof AtomRpcClient.use>[0]>[0];

/**
 * Temporary imperative escape hatch for handlers that still want `Promise`
 * ergonomics. It runs a single effect against the {@link AtomRpcClient}
 * service directly through the shared registry — it intentionally does not
 * reintroduce a facade object and should be removed once callers migrate to
 * atom-backed hooks.
 */
export function runRpc<A, E>(use: (client: AtomRpcClientShape) => Effect.Effect<A, E>): Promise<A> {
  const atom = AtomRpcClient.runtime.atom(() => AtomRpcClient.use(use));
  return Effect.runPromise(AtomRegistry.getResult(appAtomRegistry, atom));
}
