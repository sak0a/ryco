import { MessageId, ProviderDriverKind, ProviderInstanceId } from "@ryco/contracts";
import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  ContextHandoffDeliveryArtifact,
  ContextHandoffRenderedDocument,
  digestContextHandoffUtf8,
  makeContextHandoffDeliveryArtifact,
} from "./ContextHandoffArtifacts.ts";
import { stableStringifyContextHandoff } from "./ContextHandoffBuilder.ts";

const renderedContext: ContextHandoffRenderedDocument = {
  version: 1,
  mode: "full-context-fresh-session",
  provenance: {
    sources: [
      {
        providerInstanceId: ProviderInstanceId.make("codex_work"),
        driverKind: ProviderDriverKind.make("codex"),
        modelSlug: "gpt-5.6-sol",
        modelDisplayName: "GPT-5.6 Sol",
      },
    ],
    target: {
      providerInstanceId: ProviderInstanceId.make("claude_work"),
      driverKind: ProviderDriverKind.make("claudeAgent"),
      modelSlug: "claude-fable-5",
      modelDisplayName: "Fable 5",
    },
  },
  messages: [],
};

describe("ContextHandoffDeliveryArtifact", () => {
  it("preserves and hashes the exact provider input and triggering message", () => {
    const renderedContextJson = stableStringifyContextHandoff(renderedContext);
    const providerInput = "<context>😀</context>\n\n  exact message  ";
    const artifact = makeContextHandoffDeliveryArtifact({
      renderedContext,
      renderedContextJson,
      providerInput,
      triggeringMessageId: MessageId.make("message-trigger"),
      triggeringMessage: "  exact message  ",
      includedEntryCount: 0,
      totalEntryCount: 0,
      contextChars: renderedContextJson.length,
      inputChars: providerInput.length,
      truncated: false,
      preparedAt: "2026-08-05T10:00:00.000Z",
    });

    const { maxInputChars, budgetSource, contextWindowTokens, ...legacy } = artifact;
    expect(Schema.decodeUnknownSync(ContextHandoffDeliveryArtifact)(legacy)).toEqual(legacy);
    const withBudget = Schema.decodeUnknownSync(ContextHandoffDeliveryArtifact)({
      ...legacy,
      maxInputChars: 1_400_000,
      budgetSource: "manifest",
      contextWindowTokens: 1_000_000,
    });
    expect(withBudget.providerInputDigest).toBe(legacy.providerInputDigest);
    expect(withBudget.renderedContextDigest).toBe(legacy.renderedContextDigest);
    expect([maxInputChars, budgetSource, contextWindowTokens]).toEqual([null, null, null]);
    expect(artifact.providerInput).toBe(providerInput);
    expect(artifact.triggeringMessage.text).toBe("  exact message  ");
    expect(artifact.renderedContextDigest).toBe(digestContextHandoffUtf8(renderedContextJson));
    expect(artifact.providerInputDigest).toBe(digestContextHandoffUtf8(providerInput));
  });

  it("refuses a rendered JSON string that differs from the typed document", () => {
    expect(() =>
      makeContextHandoffDeliveryArtifact({
        renderedContext,
        renderedContextJson: "{}",
        providerInput: "payload",
        triggeringMessageId: MessageId.make("message-trigger"),
        triggeringMessage: "message",
        includedEntryCount: 0,
        totalEntryCount: 0,
        contextChars: 2,
        inputChars: 7,
        truncated: false,
        preparedAt: "2026-08-05T10:00:00.000Z",
      }),
    ).toThrow("Rendered context JSON does not match");
  });
});
