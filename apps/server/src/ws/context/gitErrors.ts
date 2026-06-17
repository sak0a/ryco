import { Effect, Schema } from "effect";
import {
  type GitManagerServiceError,
  GitManagerError,
  OpinionatedPluginError,
} from "@ryco/contracts";

function gitErrorText(error: GitManagerServiceError): string {
  const detail = "detail" in error ? error.detail : "";
  return `${error.message}\n${detail}`.toLowerCase();
}

function isAlreadyMissingGitResourceError(error: GitManagerServiceError): boolean {
  const text = gitErrorText(error);
  if (text.includes("command not found")) {
    return false;
  }
  return (
    text.includes("not found") ||
    text.includes("does not exist") ||
    text.includes("no such branch") ||
    text.includes("not a working tree") ||
    text.includes("is not a valid working tree")
  );
}

export function toOpinionatedPluginRpcError(cause: unknown): OpinionatedPluginError {
  if (Schema.is(OpinionatedPluginError)(cause)) {
    return cause;
  }
  return new OpinionatedPluginError({
    detail: cause instanceof Error ? cause.message : "Opinionated plugin operation failed.",
    ...(cause !== undefined ? { cause } : {}),
  });
}

export const ignoreAlreadyMissingGitResource = (
  effect: Effect.Effect<void, GitManagerServiceError>,
  context: {
    readonly operation: string;
    readonly action: "remove-worktree" | "delete-branch";
    readonly target: string;
  },
): Effect.Effect<void, GitManagerServiceError> =>
  effect.pipe(
    Effect.catch((error) =>
      isAlreadyMissingGitResourceError(error)
        ? Effect.logWarning("ignored missing git resource during worktree cleanup", {
            ...context,
            error: error.message,
          }).pipe(Effect.asVoid)
        : Effect.fail(error),
    ),
  );

export const toGitManagerError = (operation: string, detail: string, cause?: unknown) =>
  new GitManagerError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });

export const failGitWorkflow = (operation: string, detail: string, cause?: unknown) =>
  Effect.fail(toGitManagerError(operation, detail, cause));
