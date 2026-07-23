import type { NetworkInterfaceInfo } from "node:os";

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  createAdvertisedEndpoint,
  type CreateAdvertisedEndpointInput,
} from "@ryco/shared/advertisedEndpoint";
import type { AdvertisedEndpoint, AdvertisedEndpointProvider } from "@ryco/contracts";
import {
  buildTailscaleHttpsBaseUrl,
  isTailscaleIpv4Address,
  parseTailscaleMagicDnsName,
  probeTailscaleHttpsEndpoint,
  readTailscaleStatus,
} from "@ryco/tailscale";
import { Effect, Layer } from "effect";

export { isTailscaleIpv4Address, parseTailscaleMagicDnsName } from "@ryco/tailscale";

const TailscaleDesktopLayer = Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerUndici);
const TAILSCALE_MAGIC_DNS_CACHE_TTL_MS = 60_000;

const TAILSCALE_ENDPOINT_PROVIDER: AdvertisedEndpointProvider = {
  id: "tailscale",
  label: "Tailscale",
  kind: "private-network",
  isAddon: true,
};

function createTailscaleEndpoint(
  input: Omit<CreateAdvertisedEndpointInput, "provider" | "source">,
): AdvertisedEndpoint {
  return createAdvertisedEndpoint({
    ...input,
    provider: TAILSCALE_ENDPOINT_PROVIDER,
    source: "desktop-addon",
  });
}

let cachedTailscaleMagicDnsName: {
  readonly expiresAtMs: number;
  readonly promise: Promise<string | null>;
} | null = null;

async function readDefaultTailscaleMagicDnsName(): Promise<string | null> {
  return Effect.runPromise(
    readTailscaleStatus.pipe(
      Effect.map((status) => status.magicDnsName),
      Effect.catch(() => Effect.succeed(null)),
      Effect.provide(TailscaleDesktopLayer),
    ),
  );
}

function readCachedDefaultTailscaleMagicDnsName(): Promise<string | null> {
  const now = Date.now();
  if (cachedTailscaleMagicDnsName && cachedTailscaleMagicDnsName.expiresAtMs > now) {
    return cachedTailscaleMagicDnsName.promise;
  }

  const promise = readDefaultTailscaleMagicDnsName();
  cachedTailscaleMagicDnsName = {
    expiresAtMs: now + TAILSCALE_MAGIC_DNS_CACHE_TTL_MS,
    promise,
  };
  return promise;
}

export function resolveTailscaleIpAdvertisedEndpoints(input: {
  readonly port: number;
  readonly networkInterfaces: NodeJS.Dict<NetworkInterfaceInfo[]>;
}): readonly AdvertisedEndpoint[] {
  const seen = new Set<string>();
  const endpoints: AdvertisedEndpoint[] = [];

  for (const interfaceAddresses of Object.values(input.networkInterfaces)) {
    if (!interfaceAddresses) continue;

    for (const address of interfaceAddresses) {
      if (address.internal) continue;
      if (address.family !== "IPv4") continue;
      if (!isTailscaleIpv4Address(address.address)) continue;
      if (seen.has(address.address)) continue;
      seen.add(address.address);

      endpoints.push(
        createTailscaleEndpoint({
          id: `tailscale-ip:http://${address.address}:${input.port}`,
          label: "Tailscale IP",
          httpBaseUrl: `http://${address.address}:${input.port}`,
          reachability: "private-network",
          status: "available",
          description: "Reachable from devices on the same Tailnet.",
        }),
      );
    }
  }

  return endpoints;
}

export async function resolveTailscaleMagicDnsAdvertisedEndpoint(input: {
  readonly dnsName: string | null;
  readonly serveEnabled: boolean;
  readonly servePort?: number;
  readonly probe?: (baseUrl: string) => Promise<boolean>;
}): Promise<AdvertisedEndpoint | null> {
  if (!input.dnsName) {
    return null;
  }

  const httpBaseUrl = buildTailscaleHttpsBaseUrl({
    magicDnsName: input.dnsName,
    ...(input.servePort === undefined ? {} : { servePort: input.servePort }),
  });
  const isReachable = input.serveEnabled
    ? await (input.probe?.(httpBaseUrl) ??
        Effect.runPromise(
          probeTailscaleHttpsEndpoint({ baseUrl: httpBaseUrl }).pipe(
            Effect.provide(TailscaleDesktopLayer),
          ),
        ))
    : false;

  return createTailscaleEndpoint({
    id: `tailscale-magicdns:${httpBaseUrl}`,
    label: "Tailscale HTTPS",
    httpBaseUrl,
    reachability: "private-network",
    hostedHttpsCompatibility: isReachable ? "compatible" : "requires-configuration",
    status: isReachable ? "available" : "unavailable",
    description: isReachable
      ? "HTTPS endpoint served by Tailscale Serve."
      : "MagicDNS hostname. Configure Tailscale Serve for HTTPS access.",
  });
}

export async function resolveTailscaleAdvertisedEndpoints(input: {
  readonly port: number;
  readonly serveEnabled?: boolean;
  readonly servePort?: number;
  readonly networkInterfaces: NodeJS.Dict<NetworkInterfaceInfo[]>;
  readonly statusJson?: string | null;
  readonly readMagicDnsName?: () => Promise<string | null>;
  readonly probe?: (baseUrl: string) => Promise<boolean>;
}): Promise<readonly AdvertisedEndpoint[]> {
  const ipEndpoints = resolveTailscaleIpAdvertisedEndpoints(input);
  const dnsName =
    input.statusJson === undefined
      ? await (input.readMagicDnsName ?? readCachedDefaultTailscaleMagicDnsName)()
      : input.statusJson
        ? await Effect.runPromise(
            parseTailscaleMagicDnsName(input.statusJson).pipe(
              Effect.catch(() => Effect.succeed(null)),
            ),
          )
        : null;
  const magicDnsEndpoint = await resolveTailscaleMagicDnsAdvertisedEndpoint({
    dnsName,
    serveEnabled: input.serveEnabled === true,
    ...(input.servePort === undefined ? {} : { servePort: input.servePort }),
    ...(input.probe === undefined ? {} : { probe: input.probe }),
  });

  return magicDnsEndpoint ? [...ipEndpoints, magicDnsEndpoint] : ipEndpoints;
}
