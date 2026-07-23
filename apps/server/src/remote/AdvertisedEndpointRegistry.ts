import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

import {
  createAdvertisedEndpoint,
  type CreateAdvertisedEndpointInput,
} from "@ryco/shared/advertisedEndpoint";
import type { AdvertisedEndpoint, AdvertisedEndpointProvider } from "@ryco/contracts";
import { isTailscaleIpv4Address } from "@ryco/tailscale";
import { Effect, Layer } from "effect";
import { HttpServer } from "effect/unstable/http";

import { ServerConfig } from "../config.ts";
import {
  formatHostForUrl,
  isLoopbackHost,
  isWildcardHost,
  resolveHeadlessConnectionHost,
  resolveListeningPort,
} from "../startupAccess.ts";
import {
  AdvertisedEndpointRegistry,
  type AdvertisedEndpointRegistryShape,
} from "./Services/AdvertisedEndpointRegistry.ts";

const SERVER_CORE_ENDPOINT_PROVIDER: AdvertisedEndpointProvider = {
  id: "server-core",
  label: "Server",
  kind: "core",
  isAddon: false,
};

function createServerEndpoint(
  input: Omit<CreateAdvertisedEndpointInput, "provider" | "source">,
): AdvertisedEndpoint {
  return createAdvertisedEndpoint({
    ...input,
    provider: SERVER_CORE_ENDPOINT_PROVIDER,
    source: "server",
  });
}

function classifyConfiguredHostReachability(host: string): AdvertisedEndpoint["reachability"] {
  if (isLoopbackHost(host)) {
    return "loopback";
  }
  if (isTailscaleIpv4Address(host)) {
    return "private-network";
  }
  if (
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./u.test(host)
  ) {
    return "lan";
  }
  return "public";
}

function buildHttpBaseUrl(host: string, port: number): string {
  return `http://${formatHostForUrl(host)}:${port}`;
}

export function resolveServerAdvertisedEndpoints(input: {
  readonly host: string | undefined;
  readonly port: number;
  readonly networkInterfaces: NodeJS.Dict<NetworkInterfaceInfo[]>;
}): readonly AdvertisedEndpoint[] {
  const endpoints: AdvertisedEndpoint[] = [
    createServerEndpoint({
      id: `server-loopback:${input.port}`,
      label: "This machine",
      httpBaseUrl: buildHttpBaseUrl("127.0.0.1", input.port),
      reachability: "loopback",
      status: "available",
      description: "Loopback endpoint for this server.",
    }),
  ];

  if (input.host && isLoopbackHost(input.host)) {
    return endpoints;
  }

  const configuredHost =
    input.host && !isWildcardHost(input.host)
      ? input.host.replace(/^\[(.*)\]$/u, "$1")
      : resolveHeadlessConnectionHost(input.host, input.networkInterfaces);

  if (isLoopbackHost(configuredHost) || configuredHost === "localhost") {
    return endpoints;
  }

  const httpBaseUrl = buildHttpBaseUrl(configuredHost, input.port);
  const reachability = classifyConfiguredHostReachability(configuredHost);

  endpoints.push(
    createServerEndpoint({
      id: `server-network:${httpBaseUrl}`,
      label: reachability === "lan" ? "Local network" : "Network",
      httpBaseUrl,
      reachability,
      status: "available",
      isDefault: true,
      description:
        reachability === "lan"
          ? "Reachable from devices on the same network."
          : "Reachable using the configured server host.",
    }),
  );

  return endpoints;
}

export const makeAdvertisedEndpointRegistry = Effect.fn("makeAdvertisedEndpointRegistry")(
  function* () {
    const config = yield* ServerConfig;
    const httpServer = yield* HttpServer.HttpServer;

    const list = Effect.sync(() =>
      resolveServerAdvertisedEndpoints({
        host: config.host,
        port: resolveListeningPort(httpServer.address, config.port),
        networkInterfaces: networkInterfaces(),
      }),
    );

    return {
      list,
    } satisfies AdvertisedEndpointRegistryShape;
  },
);

export const AdvertisedEndpointRegistryLive = Layer.effect(
  AdvertisedEndpointRegistry,
  makeAdvertisedEndpointRegistry(),
);
