import type { AntigravitySettings, ModelCapabilities, ServerProviderModel } from "@ryco/contracts";
import { ProviderDriverKind } from "@ryco/contracts";
import { Effect, Option, Result } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { createModelCapabilities } from "@ryco/shared/model";

import { compareCliVersions } from "../cliVersion.ts";
import { makeAntigravityEnvironment } from "../antigravityRuntime.ts";
import {
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type CommandResult,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";

const PROVIDER = ProviderDriverKind.make("antigravity");
const MINIMUM_ANTIGRAVITY_VERSION = "1.0.4";
const MODELS_PROBE_TIMEOUT_MS = 15_000;

const ANTIGRAVITY_PRESENTATION = {
  displayName: "Antigravity",
  badgeLabel: "Early Access",
  showInteractionModeToggle: false,
} as const;

export const DEFAULT_ANTIGRAVITY_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

const AUTO_MODEL: ServerProviderModel = {
  slug: "auto",
  name: "Auto",
  shortName: "Auto",
  isCustom: false,
  capabilities: DEFAULT_ANTIGRAVITY_MODEL_CAPABILITIES,
};

function isLikelyAuthFailure(result: CommandResult): boolean {
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return (
    output.includes("auth") ||
    output.includes("login") ||
    output.includes("sign in") ||
    output.includes("credential") ||
    output.includes("keyring")
  );
}

export function parseAntigravityModels(output: string): ReadonlyArray<ServerProviderModel> {
  const seen = new Set([AUTO_MODEL.slug]);
  const models: Array<ServerProviderModel> = [AUTO_MODEL];

  for (const line of output.split(/\r?\n/u)) {
    const name = line.trim();
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    models.push({
      slug: name,
      name,
      isCustom: false,
      capabilities: DEFAULT_ANTIGRAVITY_MODEL_CAPABILITIES,
    });
  }

  return models;
}

function withCustomModels(
  settings: Pick<AntigravitySettings, "customModels">,
  builtInModels: ReadonlyArray<ServerProviderModel>,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(
    builtInModels,
    PROVIDER,
    settings.customModels,
    DEFAULT_ANTIGRAVITY_MODEL_CAPABILITIES,
  );
}

const runAntigravityCommand = Effect.fn("runAntigravityCommand")(function* (
  settings: AntigravitySettings,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const antigravityEnvironment = makeAntigravityEnvironment(settings, environment);
  const command = ChildProcess.make(settings.binaryPath || "agy", [...args], {
    env: antigravityEnvironment,
    shell: process.platform === "win32",
  });
  return yield* spawnAndCollect(settings.binaryPath || "agy", command);
});

export const makePendingAntigravityProvider = (
  antigravitySettings: AntigravitySettings,
): ServerProviderDraft => {
  const checkedAt = new Date().toISOString();
  const models = withCustomModels(antigravitySettings, [AUTO_MODEL]);

  if (!antigravitySettings.enabled) {
    return buildServerProvider({
      presentation: ANTIGRAVITY_PRESENTATION,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Antigravity is disabled in Ryco settings.",
      },
    });
  }

  return buildServerProvider({
    presentation: ANTIGRAVITY_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "Antigravity provider status has not been checked in this session yet.",
    },
  });
};

export const checkAntigravityProviderStatus = Effect.fn("checkAntigravityProviderStatus")(
  function* (
    antigravitySettings: AntigravitySettings,
    environment: NodeJS.ProcessEnv = process.env,
  ): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
    const checkedAt = new Date().toISOString();
    const fallbackModels = withCustomModels(antigravitySettings, [AUTO_MODEL]);

    if (!antigravitySettings.enabled) {
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: false,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Antigravity is disabled in Ryco settings.",
        },
      });
    }

    const versionProbe = yield* runAntigravityCommand(
      antigravitySettings,
      ["--version"],
      environment,
    ).pipe(Effect.timeoutOption(DEFAULT_TIMEOUT_MS), Effect.result);

    if (Result.isFailure(versionProbe)) {
      const error = versionProbe.failure;
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: true,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: !isCommandMissingCause(error),
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: isCommandMissingCause(error)
            ? "Antigravity CLI (`agy`) is not installed or not on PATH."
            : `Failed to execute Antigravity CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
        },
      });
    }

    if (Option.isNone(versionProbe.success)) {
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: true,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: true,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: "Antigravity CLI is installed but timed out during the health check.",
        },
      });
    }

    const versionResult = versionProbe.success.value;
    const parsedVersion = parseGenericCliVersion(
      `${versionResult.stdout}\n${versionResult.stderr}`,
    );
    if (versionResult.code !== 0) {
      const detail = detailFromResult(versionResult);
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: true,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: true,
          version: parsedVersion,
          status: "error",
          auth: { status: "unknown" },
          message: detail
            ? `Antigravity CLI is installed but failed to run. ${detail}`
            : "Antigravity CLI is installed but failed to run.",
        },
      });
    }

    if (!parsedVersion) {
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: true,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: true,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message:
            "Unable to determine Antigravity version from `agy --version` output. Ryco requires Antigravity v1.0.4 or newer.",
        },
      });
    }

    if (compareCliVersions(parsedVersion, MINIMUM_ANTIGRAVITY_VERSION) < 0) {
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: true,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: true,
          version: parsedVersion,
          status: "error",
          auth: { status: "unknown" },
          message: `Antigravity v${parsedVersion} is too old. Upgrade to v${MINIMUM_ANTIGRAVITY_VERSION} or newer so Ryco can read conversation databases.`,
        },
      });
    }

    const modelsProbe = yield* runAntigravityCommand(
      antigravitySettings,
      ["models"],
      environment,
    ).pipe(Effect.timeoutOption(MODELS_PROBE_TIMEOUT_MS), Effect.result);

    if (Result.isFailure(modelsProbe)) {
      const error = modelsProbe.failure;
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: true,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: true,
          version: parsedVersion,
          status: "warning",
          auth: { status: "unknown", type: "google" },
          message: `Antigravity CLI is installed, but Ryco could not list models: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      });
    }

    if (Option.isNone(modelsProbe.success)) {
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: true,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: true,
          version: parsedVersion,
          status: "warning",
          auth: { status: "unknown", type: "google" },
          message: "Antigravity CLI is installed, but `agy models` timed out.",
        },
      });
    }

    const modelsResult = modelsProbe.success.value;
    if (modelsResult.code !== 0) {
      const detail = detailFromResult(modelsResult);
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: true,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: true,
          version: parsedVersion,
          status: "warning",
          auth: {
            status: isLikelyAuthFailure(modelsResult) ? "unauthenticated" : "unknown",
            type: "google",
          },
          message: detail
            ? `Antigravity CLI is installed, but model discovery failed. ${detail}`
            : "Antigravity CLI is installed, but model discovery failed.",
        },
      });
    }

    const models = withCustomModels(
      antigravitySettings,
      parseAntigravityModels(modelsResult.stdout),
    );
    return buildServerProvider({
      presentation: ANTIGRAVITY_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "ready",
        auth: { status: "authenticated", type: "google" },
        message: `Antigravity CLI is available with ${models.length} model${
          models.length === 1 ? "" : "s"
        }.`,
      },
    });
  },
);
