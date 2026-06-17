import type { AdvertisedEndpoint } from "@ryco/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

export interface AdvertisedEndpointRegistryShape {
  readonly list: Effect.Effect<readonly AdvertisedEndpoint[]>;
}

export class AdvertisedEndpointRegistry extends Context.Service<
  AdvertisedEndpointRegistry,
  AdvertisedEndpointRegistryShape
>()("ryco/remote/Services/AdvertisedEndpointRegistry") {}
