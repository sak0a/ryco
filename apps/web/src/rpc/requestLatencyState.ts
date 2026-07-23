import { useAtomValue } from "@effect/atom-react";
import { slowRpcAckRequestsAtom, type SlowRpcAckRequest } from "@ryco/client-runtime/rpc";

export * from "@ryco/client-runtime/rpc";

export function useSlowRpcAckRequests(): ReadonlyArray<SlowRpcAckRequest> {
  return useAtomValue(slowRpcAckRequestsAtom);
}
