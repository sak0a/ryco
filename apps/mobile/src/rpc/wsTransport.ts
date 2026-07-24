import {
  WsTransport as RuntimeWsTransport,
  type WsProtocolLifecycleHandlers,
  type WsRpcProtocolSocketUrlProvider,
} from "@ryco/client-runtime/rpc";

import { mobileObservability, mobileSocket } from "../platform";

// Mobile binding of the runtime WsTransport: injects the RN WebSocket seam and
// (no-op) observability, mirroring apps/web/src/rpc/wsTransport.ts.
export class WsTransport extends RuntimeWsTransport {
  constructor(
    url: WsRpcProtocolSocketUrlProvider,
    lifecycleHandlers?: WsProtocolLifecycleHandlers,
  ) {
    super(url, { observability: mobileObservability, socket: mobileSocket }, lifecycleHandlers);
  }
}
