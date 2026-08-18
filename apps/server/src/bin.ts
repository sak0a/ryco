import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command } from "effect/unstable/cli";

import { NetService } from "@ryco/shared/Net";
import { cli } from "./cli.ts";
import packageJson from "../package.json" with { type: "json" };
import { AGENT_CONTROL_STDIO_PROXY_ARG } from "./agentControl/ProviderInjection.ts";
import { runAgentControlStdioProxyFromProcess } from "./agentControl/stdioProxy.ts";

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);

const program = Command.run(cli, { version: packageJson.version }).pipe(
  Effect.scoped,
  Effect.provide(CliRuntimeLayer),
);

if (process.argv[2] === AGENT_CONTROL_STDIO_PROXY_ARG) {
  runAgentControlStdioProxyFromProcess();
} else {
  NodeRuntime.runMain(program as Effect.Effect<void, never, never>);
}
