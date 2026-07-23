import {
  WsTransport as RuntimeWsTransport,
  type WsProtocolLifecycleHandlers,
  type WsRpcProtocolSocketUrlProvider,
} from "@ryco/client-runtime/rpc";

import { webObservability, webSocket } from "../platform";

export class WsTransport extends RuntimeWsTransport {
  constructor(
    url: WsRpcProtocolSocketUrlProvider,
    lifecycleHandlers?: WsProtocolLifecycleHandlers,
  ) {
    super(url, { observability: webObservability, socket: webSocket }, lifecycleHandlers);
  }
}
