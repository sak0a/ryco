import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import {
  BrowserEvent,
  BrowserHostCommandEnvelope,
  BrowserHostCommandResultInput,
  BrowserHostEventInput,
  BrowserHostHeartbeatInput,
  BrowserHostRegisterInput,
  BrowserHostRegisterResult,
  BrowserHostSubscribeCommandsInput,
  BrowserServiceError,
} from "./browser.ts";
import { AuthRpcError } from "./auth.ts";

export const BROWSER_HOST_METHODS = {
  register: "browserHost.register",
  heartbeat: "browserHost.heartbeat",
  subscribeCommands: "browserHost.subscribeCommands",
  commandResult: "browserHost.command.result",
  event: "browserHost.event",
} as const;

export const BrowserHostRegisterRpc = Rpc.make(BROWSER_HOST_METHODS.register, {
  payload: BrowserHostRegisterInput,
  success: BrowserHostRegisterResult,
  error: Schema.Union([BrowserServiceError, AuthRpcError]),
});

export const BrowserHostHeartbeatRpc = Rpc.make(BROWSER_HOST_METHODS.heartbeat, {
  payload: BrowserHostHeartbeatInput,
  success: Schema.Struct({}),
  error: Schema.Union([BrowserServiceError, AuthRpcError]),
});

export const BrowserHostSubscribeCommandsRpc = Rpc.make(BROWSER_HOST_METHODS.subscribeCommands, {
  payload: BrowserHostSubscribeCommandsInput,
  success: BrowserHostCommandEnvelope,
  error: Schema.Union([BrowserServiceError, AuthRpcError]),
  stream: true,
});

export const BrowserHostCommandResultRpc = Rpc.make(BROWSER_HOST_METHODS.commandResult, {
  payload: BrowserHostCommandResultInput,
  success: Schema.Struct({}),
  error: Schema.Union([BrowserServiceError, AuthRpcError]),
});

export const BrowserHostEventRpc = Rpc.make(BROWSER_HOST_METHODS.event, {
  payload: BrowserHostEventInput,
  success: Schema.Struct({}),
  error: Schema.Union([BrowserServiceError, AuthRpcError]),
});

export const BrowserHostEventsRpc = Rpc.make("browserHost.events", {
  payload: Schema.Struct({}),
  success: BrowserEvent,
  error: BrowserServiceError,
  stream: true,
});

export const BrowserHostRpcGroup = RpcGroup.make(
  BrowserHostRegisterRpc,
  BrowserHostHeartbeatRpc,
  BrowserHostSubscribeCommandsRpc,
  BrowserHostCommandResultRpc,
  BrowserHostEventRpc,
);
