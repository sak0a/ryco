import {
  CodexSettings,
  DEFAULT_GIT_TEXT_GENERATION_MODEL,
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  ProviderDriverKind,
  ProviderInstanceId,
  TextGenerationError,
  type CopilotSettings,
  type ModelSelection,
} from "@ryco/contracts";
import { getModelSelectionStringOptionValue } from "@ryco/shared/model";
import { CopilotClient, type CopilotClientOptions, type SessionConfig } from "@github/copilot-sdk";
import { Effect, Schema } from "effect";

import { resolveCopilotCliPath } from "../provider/Layers/CopilotAdapter.ts";
import { makeCodexTextGeneration } from "./CodexTextGeneration.ts";
import type { TextGenerationShape } from "./TextGeneration.ts";
import { buildThreadTitlePrompt } from "./TextGenerationPrompts.ts";
import { extractJsonObject, sanitizeThreadTitle } from "./TextGenerationUtils.ts";

const COPILOT_THREAD_TITLE_TIMEOUT_MS = 60_000;
const CODEX_DRIVER_KIND = ProviderDriverKind.make("codex");

const ThreadTitleResponse = Schema.Struct({
  title: Schema.String,
});

function gitTextGenerationSelection(): ModelSelection {
  return {
    instanceId: ProviderInstanceId.make("codex"),
    model:
      DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[CODEX_DRIVER_KIND] ??
      DEFAULT_GIT_TEXT_GENERATION_MODEL,
  };
}

function makeClientOptions(
  settings: Pick<CopilotSettings, "binaryPath">,
  cwd: string | undefined,
  environment: NodeJS.ProcessEnv,
): CopilotClientOptions {
  return {
    cliPath: resolveCopilotCliPath(settings, environment),
    ...(cwd ? { cwd } : {}),
    env: environment,
    logLevel: "error",
  };
}

export const makeCopilotTextGeneration = Effect.fn("makeCopilotTextGeneration")(function* (
  copilotSettings: CopilotSettings,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const codexFallback = yield* makeCodexTextGeneration(
    Schema.decodeSync(CodexSettings)({}),
    environment,
  );

  const withGitFallbackSelection = <T extends { readonly modelSelection: ModelSelection }>(
    input: T,
  ): T => ({
    ...input,
    modelSelection: gitTextGenerationSelection(),
  });

  const generateThreadTitle: TextGenerationShape["generateThreadTitle"] = (input) =>
    Effect.gen(function* () {
      const { prompt } = buildThreadTitlePrompt({
        message: input.message,
        attachments: input.attachments,
      });
      const client = new CopilotClient(makeClientOptions(copilotSettings, input.cwd, environment));
      const reasoningEffort = getModelSelectionStringOptionValue(
        input.modelSelection,
        "reasoningEffort",
      );
      const sessionConfig: SessionConfig = {
        model: input.modelSelection.model,
        ...(reasoningEffort
          ? { reasoningEffort: reasoningEffort as "low" | "medium" | "high" | "xhigh" }
          : {}),
        workingDirectory: input.cwd,
        streaming: false,
        availableTools: [],
        onPermissionRequest: () => ({ kind: "reject" }),
      };

      const content = yield* Effect.tryPromise({
        try: async () => {
          try {
            const session = await client.createSession(sessionConfig);
            const response = await session.sendAndWait(
              { prompt, mode: "immediate" },
              COPILOT_THREAD_TITLE_TIMEOUT_MS,
            );
            await session.disconnect();
            return response?.data.content ?? "";
          } finally {
            await client.stop();
          }
        },
        catch: (cause) =>
          new TextGenerationError({
            operation: "generateThreadTitle",
            detail:
              cause instanceof Error
                ? `GitHub Copilot title generation failed: ${cause.message}`
                : "GitHub Copilot title generation failed.",
            cause,
          }),
      });

      const parsed = yield* Schema.decodeEffect(Schema.fromJsonString(ThreadTitleResponse))(
        extractJsonObject(content),
      ).pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation: "generateThreadTitle",
              detail: "GitHub Copilot returned invalid title JSON.",
              cause,
            }),
        ),
      );
      return { title: sanitizeThreadTitle(parsed.title) };
    });

  return {
    generateCommitMessage: (input) =>
      codexFallback.generateCommitMessage(withGitFallbackSelection(input)),
    generatePrContent: (input) => codexFallback.generatePrContent(withGitFallbackSelection(input)),
    generateBranchName: (input) =>
      codexFallback.generateBranchName(withGitFallbackSelection(input)),
    generateThreadTitle,
    generateIssueContent: () =>
      Effect.die("generateIssueContent not yet implemented for Copilot provider"),
  } satisfies TextGenerationShape;
});
