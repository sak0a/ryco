import {
  WsTransport as RuntimeWsTransport,
  DeviceWsTransport as RuntimeDeviceWsTransport,
  HostedWsTransport as RuntimeHostedWsTransport,
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

export class DeviceWsTransport extends RuntimeDeviceWsTransport {
  constructor(
    url: WsRpcProtocolSocketUrlProvider,
    lifecycleHandlers?: WsProtocolLifecycleHandlers,
  ) {
    super(url, { observability: webObservability, socket: webSocket }, lifecycleHandlers);
  }
}

export class HostedWsTransport extends RuntimeHostedWsTransport {
  constructor(
    url: WsRpcProtocolSocketUrlProvider,
    lifecycleHandlers?: WsProtocolLifecycleHandlers,
  ) {
    super(url, { observability: webObservability, socket: webSocket }, lifecycleHandlers);
  }
}
