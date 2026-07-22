import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { type GeminiSettings, type ProviderOptionSelection } from "@ryco/contracts";
import {
  geminiCapabilitiesForModel,
  getGeminiThinkingConfigKind,
  getGeminiThinkingModelAlias,
  hasProviderSelectOptionValue,
  resolveGeminiApiModelId,
  type GeminiThinkingBudget,
  type GeminiThinkingLevel,
} from "@ryco/shared/model";
import { Data, Effect, Layer, Scope } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as EffectAcpErrors from "effect-acp/errors";

import {
  AcpSessionRuntime,
  type AcpSessionRuntimeOptions,
  type AcpSessionRuntimeShape,
  type AcpSpawnInput,
} from "./AcpSessionRuntime.ts";

type GeminiAcpRuntimeSettings = Pick<GeminiSettings, "binaryPath" | "customModels">;

const RYCO_GEMINI_SETTINGS_DIR = path.join(os.tmpdir(), "ryco", "gemini");
const GEMINI_3_THINKING_LEVELS: ReadonlyArray<GeminiThinkingLevel> = ["HIGH", "LOW"];
const GEMINI_2_5_THINKING_BUDGETS: ReadonlyArray<GeminiThinkingBudget> = [-1, 512, 0];

class GeminiModelConfigAliasError extends Data.TaggedError("GeminiModelConfigAliasError")<{
  readonly detail: string;
  readonly cause: unknown;
}> {}

export interface GeminiAcpRuntimeInput extends Omit<
  AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly geminiSettings: GeminiAcpRuntimeSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
  readonly candidateModels?: ReadonlyArray<string>;
}

export interface GeminiAcpModelSelectionErrorContext {
  readonly cause: EffectAcpErrors.AcpError;
  readonly step: "set-model";
}

export function buildGeminiThinkingModelConfigAliases(
  modelIds: ReadonlyArray<string>,
): Record<string, Record<string, unknown>> {
  const aliases: Record<string, Record<string, unknown>> = {};
  const seen = new Set<string>();

  for (const modelId of modelIds) {
    const model = modelId.trim();
    if (!model || seen.has(model)) {
      continue;
    }
    seen.add(model);
    const caps = geminiCapabilitiesForModel(model);

    switch (getGeminiThinkingConfigKind(model)) {
      case "level": {
        for (const thinkingLevel of GEMINI_3_THINKING_LEVELS) {
          if (!hasProviderSelectOptionValue(caps, thinkingLevel)) {
            continue;
          }
          const alias = getGeminiThinkingModelAlias(model, [
            { id: "reasoning", value: thinkingLevel },
          ]);
          if (!alias) {
            continue;
          }
          aliases[alias] = {
            extends: "chat-base-3",
            modelConfig: {
              model,
              generateContentConfig: {
                thinkingConfig: {
                  thinkingLevel,
                },
              },
            },
          };
        }
        break;
      }
      case "budget": {
        for (const thinkingBudget of GEMINI_2_5_THINKING_BUDGETS) {
          if (!hasProviderSelectOptionValue(caps, String(thinkingBudget))) {
            continue;
          }
          const alias = getGeminiThinkingModelAlias(model, [
            { id: "reasoning", value: String(thinkingBudget) },
          ]);
          if (!alias) {
            continue;
          }
          aliases[alias] = {
            extends: "chat-base-2.5",
            modelConfig: {
              model,
              generateContentConfig: {
                thinkingConfig: {
                  thinkingBudget,
                },
              },
            },
          };
        }
        break;
      }
      default:
        break;
    }
  }

  return aliases;
}

function buildCandidateModels(input: GeminiAcpRuntimeInput): ReadonlyArray<string> {
  return [...(input.candidateModels ?? []), ...(input.geminiSettings?.customModels ?? [])].filter(
    (value) => value.trim().length > 0,
  );
}

const prepareGeminiLaunchEnvironment = (input: {
  readonly candidateModels: ReadonlyArray<string>;
  readonly environment?: NodeJS.ProcessEnv;
}) =>
  Effect.gen(function* () {
    const aliases = buildGeminiThinkingModelConfigAliases(input.candidateModels);
    if (Object.keys(aliases).length === 0) {
      return input.environment ? { env: input.environment } : {};
    }

    const settingsPath = path.join(RYCO_GEMINI_SETTINGS_DIR, `${crypto.randomUUID()}.json`);
    yield* Effect.tryPromise({
      try: async () => {
        await fs.mkdir(RYCO_GEMINI_SETTINGS_DIR, { recursive: true });
        await fs.writeFile(
          settingsPath,
          JSON.stringify(
            {
              modelConfigs: {
                aliases,
              },
            },
            null,
            2,
          ),
          "utf8",
        );
      },
      catch: (cause) =>
        new GeminiModelConfigAliasError({
          detail:
            cause instanceof Error
              ? cause.message
              : "Failed to write Gemini CLI model config aliases.",
          cause,
        }),
    });

    const scope = yield* Scope.Scope;
    yield* Scope.addFinalizer(
      scope,
      Effect.promise(() => fs.unlink(settingsPath).catch(() => undefined)),
    );
    const env: NodeJS.ProcessEnv = {
      ...input.environment,
      GEMINI_CLI_SYSTEM_SETTINGS_PATH: settingsPath,
    };

    return {
      env,
    };
  });

export function buildGeminiAcpSpawnInput(input: {
  readonly geminiSettings: GeminiAcpRuntimeSettings | null | undefined;
  readonly cwd: string;
  readonly environment?: NodeJS.ProcessEnv;
}): AcpSpawnInput {
  return {
    command: input.geminiSettings?.binaryPath || "gemini",
    args: ["--acp"],
    cwd: input.cwd,
    ...(input.environment ? { env: input.environment } : {}),
  };
}

export const makeGeminiAcpRuntime = (
  input: GeminiAcpRuntimeInput,
): Effect.Effect<AcpSessionRuntimeShape, EffectAcpErrors.AcpError, Scope.Scope> =>
  Effect.gen(function* () {
    const launch = yield* prepareGeminiLaunchEnvironment({
      candidateModels: buildCandidateModels(input),
      ...(input.environment ? { environment: input.environment } : {}),
    }).pipe(
      Effect.mapError(
        (cause) =>
          new EffectAcpErrors.AcpTransportError({
            detail: `Failed to prepare Gemini model config aliases: ${cause.detail}`,
            cause,
          }),
      ),
    );
    const spawn = buildGeminiAcpSpawnInput({
      geminiSettings: input.geminiSettings,
      cwd: input.cwd,
      ...(launch.env ? { environment: launch.env } : {}),
    });
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
          auth: { terminal: false },
        },
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime).pipe(Effect.provide(acpContext));
  });

interface GeminiAcpModelSelectionRuntime {
  readonly setModel: (model: string) => Effect.Effect<unknown, EffectAcpErrors.AcpError>;
}

export function applyGeminiAcpModelSelection<E>(input: {
  readonly runtime: GeminiAcpModelSelectionRuntime;
  readonly model: string | null | undefined;
  readonly selections: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  readonly mapError: (context: GeminiAcpModelSelectionErrorContext) => E;
}): Effect.Effect<void, E> {
  const model = input.model?.trim();
  if (!model) {
    return Effect.void;
  }
  return input.runtime.setModel(resolveGeminiApiModelId(model, input.selections)).pipe(
    Effect.mapError((cause) =>
      input.mapError({
        cause,
        step: "set-model",
      }),
    ),
    Effect.asVoid,
  );
}
