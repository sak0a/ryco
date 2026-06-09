import {
  type GeminiSettings,
  type ModelCapabilities,
  ProviderDriverKind,
  type ServerProviderModel,
} from "@ryco/contracts";
import { DEFAULT_GEMINI_MODEL_CAPABILITIES, geminiCapabilitiesForModel } from "@ryco/shared/model";
import { Effect, Option, Result } from "effect";
import { ChildProcess } from "effect/unstable/process";

import {
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import {
  normalizeGeminiCapabilityProbeResult,
  probeGeminiCapabilities,
} from "../geminiAcpProbe.ts";

const PROVIDER = ProviderDriverKind.make("gemini");
const GEMINI_PRESENTATION = {
  displayName: "Gemini",
  showInteractionModeToggle: true,
} as const;

function geminiModel(input: {
  readonly slug: string;
  readonly name: string;
  readonly shortName?: string;
  readonly fallbackCapabilities?: ModelCapabilities;
}): ServerProviderModel {
  const capabilities = geminiCapabilitiesForModel(
    input.slug,
    input.fallbackCapabilities ?? DEFAULT_GEMINI_MODEL_CAPABILITIES,
  );
  return {
    slug: input.slug,
    name: input.name,
    ...(input.shortName ? { shortName: input.shortName } : {}),
    isCustom: false,
    capabilities,
  };
}

export const GEMINI_BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  geminiModel({
    slug: "auto-gemini-3",
    name: "Auto Gemini 3",
    shortName: "Auto 3",
  }),
  geminiModel({
    slug: "auto-gemini-2.5",
    name: "Auto Gemini 2.5",
    shortName: "Auto 2.5",
  }),
  geminiModel({
    slug: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro Preview",
    shortName: "3.1 Pro",
  }),
  geminiModel({
    slug: "gemini-3-flash-preview",
    name: "Gemini 3 Flash Preview",
    shortName: "3 Flash",
  }),
  geminiModel({
    slug: "gemini-3.1-flash-lite-preview",
    name: "Gemini 3.1 Flash Lite Preview",
    shortName: "3.1 Flash Lite",
  }),
  geminiModel({
    slug: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    shortName: "2.5 Pro",
  }),
  geminiModel({
    slug: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    shortName: "2.5 Flash",
  }),
  geminiModel({
    slug: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash Lite",
    shortName: "2.5 Flash Lite",
  }),
];

function geminiModelsFromSettings(
  builtInModels: ReadonlyArray<ServerProviderModel>,
  customModels: ReadonlyArray<string>,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(
    builtInModels,
    PROVIDER,
    customModels,
    DEFAULT_GEMINI_MODEL_CAPABILITIES,
  );
}

const runGeminiCommand = (
  geminiSettings: Pick<GeminiSettings, "binaryPath">,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv = process.env,
) =>
  spawnAndCollect(
    geminiSettings.binaryPath,
    ChildProcess.make(geminiSettings.binaryPath, [...args], {
      env: { ...process.env, ...environment },
      shell: process.platform === "win32",
    }),
  );

export const makePendingGeminiProvider = (geminiSettings: GeminiSettings): ServerProviderDraft => {
  const checkedAt = new Date().toISOString();
  const models = geminiModelsFromSettings(GEMINI_BUILT_IN_MODELS, geminiSettings.customModels);

  if (!geminiSettings.enabled) {
    return buildServerProvider({
      presentation: GEMINI_PRESENTATION,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Gemini is disabled in Ryco settings.",
      },
    });
  }

  return buildServerProvider({
    presentation: GEMINI_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "Gemini provider status has not been checked in this session yet.",
    },
  });
};

export const checkGeminiProviderStatus = Effect.fn("checkGeminiProviderStatus")(function* (
  geminiSettings: GeminiSettings,
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const checkedAt = new Date().toISOString();
  const fallbackModels = geminiModelsFromSettings(
    GEMINI_BUILT_IN_MODELS,
    geminiSettings.customModels,
  );

  if (!geminiSettings.enabled) {
    return buildServerProvider({
      presentation: GEMINI_PRESENTATION,
      enabled: false,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Gemini is disabled in Ryco settings.",
      },
    });
  }

  const versionProbe = yield* runGeminiCommand(geminiSettings, ["--version"], environment).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return buildServerProvider({
      presentation: GEMINI_PRESENTATION,
      enabled: geminiSettings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "Gemini CLI (`gemini`) is not installed or not on PATH."
          : `Failed to execute Gemini CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      },
    });
  }

  if (Option.isNone(versionProbe.success)) {
    return buildServerProvider({
      presentation: GEMINI_PRESENTATION,
      enabled: geminiSettings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Gemini CLI is installed but failed to run. Timed out while running command.",
      },
    });
  }

  const version = versionProbe.success.value;
  const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
  if (version.code !== 0) {
    const detail = detailFromResult(version);
    return buildServerProvider({
      presentation: GEMINI_PRESENTATION,
      enabled: geminiSettings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "unknown" },
        message: detail
          ? `Gemini CLI is installed but failed to run. ${detail}`
          : "Gemini CLI is installed but failed to run.",
      },
    });
  }

  const capabilityProbe = yield* probeGeminiCapabilities({
    binaryPath: geminiSettings.binaryPath,
    cwd,
    environment,
  }).pipe(
    Effect.map(normalizeGeminiCapabilityProbeResult),
    Effect.catch((error) =>
      Effect.succeed({
        status: "warning" as const,
        auth: { status: "unknown" as const },
        models: [],
        message: `Could not verify Gemini authentication status: ${error.detail}.`,
      }),
    ),
  );

  const discoveredOrFallbackModels =
    capabilityProbe.models.length > 0 ? capabilityProbe.models : GEMINI_BUILT_IN_MODELS;
  const models = geminiModelsFromSettings(discoveredOrFallbackModels, geminiSettings.customModels);

  return buildServerProvider({
    presentation: GEMINI_PRESENTATION,
    enabled: geminiSettings.enabled,
    checkedAt,
    models,
    probe: {
      installed: true,
      version: parsedVersion,
      status: capabilityProbe.status,
      auth: capabilityProbe.auth,
      ...(capabilityProbe.message ? { message: capabilityProbe.message } : {}),
    },
  });
});
