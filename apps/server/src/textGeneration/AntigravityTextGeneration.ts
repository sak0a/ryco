import { Effect, Option, Schema } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  type AntigravitySettings,
  type ModelSelection,
  TextGenerationError,
} from "@ryco/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@ryco/shared/git";

import { runAntigravityPrompt } from "../provider/antigravityRuntime.ts";
import { type ThreadTitleGenerationResult, type TextGenerationShape } from "./TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildIssueContentPolishPrompt,
  buildIssueContentTitlePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import {
  extractJsonObject,
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "./TextGenerationUtils.ts";

const ANTIGRAVITY_TEXT_GENERATION_TIMEOUT_MS = 180_000;

type AntigravityTextGenerationOperation =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle"
  | "generateIssueContent";

function isTextGenerationError(error: unknown): error is TextGenerationError {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "TextGenerationError"
  );
}

function mapAntigravityTextGenerationError(
  operation: AntigravityTextGenerationOperation,
  detail: string,
  cause: unknown,
): TextGenerationError {
  return new TextGenerationError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

export const makeAntigravityTextGeneration = Effect.fn("makeAntigravityTextGeneration")(function* (
  antigravitySettings: AntigravitySettings,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const runAntigravityJson = <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchemaJson,
    modelSelection,
  }: {
    operation: AntigravityTextGenerationOperation;
    cwd: string;
    prompt: string;
    outputSchemaJson: S;
    modelSelection: ModelSelection;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      const result = yield* runAntigravityPrompt({
        settings: antigravitySettings,
        cwd,
        prompt,
        runtimeMode: "approval-required",
        model: modelSelection.model,
        state: { lastStepIdx: 0 },
        environment: {
          ...environment,
          OPENAB_TOOL_DISPLAY: environment.OPENAB_TOOL_DISPLAY ?? "compact",
        },
      }).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.timeoutOption(ANTIGRAVITY_TEXT_GENERATION_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new TextGenerationError({
                  operation,
                  detail: "Antigravity CLI request timed out.",
                }),
              ),
            onSome: (value) => Effect.succeed(value),
          }),
        ),
        Effect.mapError((cause) =>
          isTextGenerationError(cause)
            ? cause
            : mapAntigravityTextGenerationError(
                operation,
                cause instanceof Error
                  ? `Antigravity CLI text generation failed: ${cause.message}`
                  : "Antigravity CLI text generation failed.",
                cause,
              ),
        ),
      );

      return yield* Schema.decodeEffect(Schema.fromJsonString(outputSchemaJson))(
        extractJsonObject(result.text),
      ).pipe(
        Effect.catchTag("SchemaError", (cause) =>
          Effect.fail(
            new TextGenerationError({
              operation,
              detail: "Antigravity CLI returned invalid structured output.",
              cause,
            }),
          ),
        ),
      );
    });

  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = Effect.fn(
    "AntigravityTextGeneration.generateCommitMessage",
  )(function* (input) {
    const { prompt, outputSchema } = buildCommitMessagePrompt({
      branch: input.branch,
      stagedSummary: input.stagedSummary,
      stagedPatch: input.stagedPatch,
      includeBranch: input.includeBranch === true,
    });

    const generated = yield* runAntigravityJson({
      operation: "generateCommitMessage",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      subject: sanitizeCommitSubject(generated.subject),
      body: generated.body.trim(),
      ...("branch" in generated && typeof generated.branch === "string"
        ? { branch: sanitizeFeatureBranchName(generated.branch) }
        : {}),
    };
  });

  const generatePrContent: TextGenerationShape["generatePrContent"] = Effect.fn(
    "AntigravityTextGeneration.generatePrContent",
  )(function* (input) {
    const { prompt, outputSchema } = buildPrContentPrompt({
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      commitSummary: input.commitSummary,
      diffSummary: input.diffSummary,
      diffPatch: input.diffPatch,
    });

    const generated = yield* runAntigravityJson({
      operation: "generatePrContent",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      title: sanitizePrTitle(generated.title),
      body: generated.body.trim(),
    };
  });

  const generateBranchName: TextGenerationShape["generateBranchName"] = Effect.fn(
    "AntigravityTextGeneration.generateBranchName",
  )(function* (input) {
    const { prompt, outputSchema } = buildBranchNamePrompt({
      message: input.message,
      attachments: input.attachments,
    });

    const generated = yield* runAntigravityJson({
      operation: "generateBranchName",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      branch: sanitizeBranchFragment(generated.branch),
    };
  });

  const generateThreadTitle: TextGenerationShape["generateThreadTitle"] = Effect.fn(
    "AntigravityTextGeneration.generateThreadTitle",
  )(function* (input) {
    const { prompt, outputSchema } = buildThreadTitlePrompt({
      message: input.message,
      attachments: input.attachments,
    });

    const generated = yield* runAntigravityJson({
      operation: "generateThreadTitle",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      title: sanitizeThreadTitle(generated.title),
    } satisfies ThreadTitleGenerationResult;
  });

  const generateIssueContent: TextGenerationShape["generateIssueContent"] = Effect.fn(
    "AntigravityTextGeneration.generateIssueContent",
  )(function* (input) {
    if (input.mode === "polish") {
      const { prompt, outputSchema } = buildIssueContentPolishPrompt({
        rough: input.rough ?? "",
        ...(input.currentTitle ? { currentTitle: input.currentTitle } : {}),
        ...(input.customInstructions ? { customInstructions: input.customInstructions } : {}),
      });
      const decoded = yield* runAntigravityJson({
        operation: "generateIssueContent",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
      return { title: decoded.title.trim(), body: decoded.body.trim() };
    }

    const { prompt, outputSchema } = buildIssueContentTitlePrompt({
      body: input.body ?? "",
    });
    const decoded = yield* runAntigravityJson({
      operation: "generateIssueContent",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });
    return { title: decoded.title.trim() };
  });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
    generateIssueContent,
  } satisfies TextGenerationShape;
});
