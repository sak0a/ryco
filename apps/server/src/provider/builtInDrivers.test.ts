import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_SERVER_SETTINGS, ProviderInstanceId } from "@ryco/contracts";

import { BUILT_IN_DRIVERS } from "./builtInDrivers.ts";
import { deriveProviderInstanceConfigMap } from "./Layers/ProviderInstanceRegistryHydration.ts";

describe("BUILT_IN_DRIVERS", () => {
  it("registers Grok with its default ACP CLI configuration", () => {
    const grok = BUILT_IN_DRIVERS.find((driver) => driver.driverKind === "grok");

    expect(grok?.metadata).toEqual({
      displayName: "Grok",
      supportsMultipleInstances: true,
    });
    expect(grok?.defaultConfig()).toEqual({
      enabled: true,
      binaryPath: "grok",
      customModels: [],
    });
  });

  it("hydrates the default Grok instance from legacy provider settings", () => {
    const instances = deriveProviderInstanceConfigMap(DEFAULT_SERVER_SETTINGS);

    expect(instances[ProviderInstanceId.make("grok")]).toEqual({
      driver: "grok",
      config: {
        enabled: true,
        binaryPath: "grok",
        customModels: [],
      },
    });
  });
});
