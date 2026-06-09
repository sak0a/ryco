import { ProviderDriverKind, TextGenerationError } from "@ryco/contracts";
import { Effect } from "effect";

import type { TextGenerationShape } from "./TextGeneration.ts";

export function makeUnsupportedTextGeneration(input: {
  readonly provider: ProviderDriverKind;
}): TextGenerationShape {
  const unsupported = (operation: string) =>
    Effect.fail(
      new TextGenerationError({
        operation,
        detail: `${input.provider} does not support provider-backed text generation in Ryco yet.`,
      }),
    );

  return {
    generateCommitMessage: () => unsupported("generateCommitMessage"),
    generatePrContent: () => unsupported("generatePrContent"),
    generateBranchName: () => unsupported("generateBranchName"),
    generateThreadTitle: () => unsupported("generateThreadTitle"),
    generateIssueContent: () => unsupported("generateIssueContent"),
  };
}
