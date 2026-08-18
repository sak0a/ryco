import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_SERVER_SETTINGS, ProviderInstanceId } from "@ryco/contracts";

import { BUILT_IN_DRIVERS } from "./builtInDrivers.ts";
import { deriveProviderInstanceConfigMap } from "./Layers/ProviderInstanceRegistryHydration.ts";
import { AGENT_CONTROL_PROVIDER_SUPPORT } from "../agentControl/ProviderInjection.ts";

describe("BUILT_IN_DRIVERS", () => {
  it("registers Grok with its default ACP CLI configuration", () => {
    const grok = BUILT_IN_DRIVERS.find((driver) => driver.driverKind === "grok");

    expect(grok?.metadata).toEqual({
      displayName: "Grok",
      supportsMultipleInstances: true,
      agentControl: AGENT_CONTROL_PROVIDER_SUPPORT.grok,
    });
    expect(grok?.defaultConfig()).toEqual({
      enabled: true,
      binaryPath: "grok",
      customModels: [],
    });
  });

  it("advertises the audited Agent Control support matrix in driver metadata", () => {
    const decisions = Object.fromEntries(
      BUILT_IN_DRIVERS.map((driver) => [driver.driverKind, driver.metadata.agentControl]),
    );
    expect(decisions).toMatchObject({
      codex: AGENT_CONTROL_PROVIDER_SUPPORT.codex,
      claudeAgent: AGENT_CONTROL_PROVIDER_SUPPORT.claudeAgent,
      cursor: AGENT_CONTROL_PROVIDER_SUPPORT.cursor,
      copilot: AGENT_CONTROL_PROVIDER_SUPPORT.copilot,
      opencode: AGENT_CONTROL_PROVIDER_SUPPORT.opencode,
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
