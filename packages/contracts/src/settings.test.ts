import { describe, expect, it } from "vite-plus/test";
import { Schema } from "effect";

import { ProviderInstanceId } from "./providerInstance.ts";
import { DEFAULT_SERVER_SETTINGS, ServerSettings, ServerSettingsPatch } from "./settings.ts";

const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);

describe("ServerSettings.enableLegacyTokenStreaming", () => {
  it("defaults to buffered output and deliberately ignores the retired key", () => {
    expect(DEFAULT_SERVER_SETTINGS.enableLegacyTokenStreaming).toBe(false);
    expect(
      decodeServerSettings({ enableAssistantStreaming: true }).enableLegacyTokenStreaming,
    ).toBe(false);
  });

  it("round-trips the fresh legacy setting key", () => {
    expect(
      decodeServerSettings({ enableLegacyTokenStreaming: true }).enableLegacyTokenStreaming,
    ).toBe(true);
    expect(
      decodeServerSettingsPatch({ enableLegacyTokenStreaming: true }).enableLegacyTokenStreaming,
    ).toBe(true);
  });
});

describe("ServerSettings.enableProviderUpdateChecks", () => {
  it("defaults provider update checks on", () => {
    expect(DEFAULT_SERVER_SETTINGS.enableProviderUpdateChecks).toBe(true);
    expect(decodeServerSettings({}).enableProviderUpdateChecks).toBe(true);
  });

  it("can be disabled and round-trips through the settings patch", () => {
    expect(
      decodeServerSettings({ enableProviderUpdateChecks: false }).enableProviderUpdateChecks,
    ).toBe(false);
    expect(
      decodeServerSettingsPatch({ enableProviderUpdateChecks: false }).enableProviderUpdateChecks,
    ).toBe(false);
  });
});

describe("ServerSettings.providerInstances (slice-2 invariant)", () => {
  it("defaults to an empty record so legacy configs without the key still decode", () => {
    expect(DEFAULT_SERVER_SETTINGS.providerInstances).toEqual({});
  });

  it("decodes a fully empty config (legacy on-disk shape) without complaint", () => {
    const decoded = decodeServerSettings({});
    expect(decoded.providerInstances).toEqual({});
    // Legacy `providers` struct is still hydrated with its per-driver defaults
    // so existing call sites keep working through the migration.
    expect(decoded.providers.codex.enabled).toBe(true);
    expect(decoded.providers.grok).toEqual({
      enabled: true,
      binaryPath: "grok",
      customModels: [],
    });
  });

  it("decodes a multi-instance map mixing first-party and fork drivers", () => {
    const decoded = decodeServerSettings({
      providerInstances: {
        codex_personal: {
          driver: "codex",
          displayName: "Codex (personal)",
          config: { homePath: "~/.codex_personal" },
        },
        codex_work: {
          driver: "codex",
          config: { homePath: "~/.codex_work" },
        },
        ollama_local: {
          driver: "ollama",
          displayName: "Ollama (local)",
          config: { endpoint: "http://localhost:11434" },
        },
      },
    });
    const personalId = ProviderInstanceId.make("codex_personal");
    const workId = ProviderInstanceId.make("codex_work");
    const ollamaId = ProviderInstanceId.make("ollama_local");

    expect(decoded.providerInstances[personalId]?.driver).toBe("codex");
    expect(decoded.providerInstances[workId]?.config).toEqual({ homePath: "~/.codex_work" });
    // Critical: a config naming a driver this build does not know about
    // (`ollama` is not in `ProviderDriverKind`) must round-trip without loss.
    // The runtime handles "driver not installed" — the schema must not.
    expect(decoded.providerInstances[ollamaId]?.driver).toBe("ollama");
    expect(decoded.providerInstances[ollamaId]?.config).toEqual({
      endpoint: "http://localhost:11434",
    });
  });

  it("rejects instance keys that violate the slug pattern", () => {
    expect(() =>
      decodeServerSettings({
        providerInstances: { "1bad": { driver: "codex" } },
      }),
    ).toThrow();
  });
});

describe("ServerSettingsPatch.providerInstances", () => {
  it("treats providerInstances as an optional whole-map replacement", () => {
    const patch = decodeServerSettingsPatch({});
    expect(patch.providerInstances).toBeUndefined();

    const replacement = decodeServerSettingsPatch({
      providerInstances: {
        codex_personal: { driver: "codex", config: { homePath: "~/.codex" } },
      },
    });
    expect(replacement.providerInstances).toBeDefined();
    expect(replacement.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.driver).toBe(
      "codex",
    );
  });

  it("preserves a fork-defined driver entry through patch decoding", () => {
    const patch = decodeServerSettingsPatch({
      providerInstances: {
        ollama_local: {
          driver: "ollama",
          config: { endpoint: "http://localhost:11434" },
        },
      },
    });
    const ollamaId = ProviderInstanceId.make("ollama_local");
    expect(patch.providerInstances?.[ollamaId]?.driver).toBe("ollama");
  });
});

describe("ServerSettingsPatch.providers.grok", () => {
  it("decodes Grok binary and model overrides", () => {
    const patch = decodeServerSettingsPatch({
      providers: {
        grok: {
          binaryPath: "/opt/grok",
          customModels: ["grok-build"],
        },
      },
    });

    expect(patch.providers?.grok).toEqual({
      binaryPath: "/opt/grok",
      customModels: ["grok-build"],
    });
  });
});
