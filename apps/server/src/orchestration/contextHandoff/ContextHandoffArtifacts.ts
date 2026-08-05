import { createHash } from "node:crypto";

import {
  CONTEXT_HANDOFF_CONTEXT_VERSION,
  ContextHandoffDigest,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  PositiveInt,
} from "@ryco/contracts";
import { Schema } from "effect";

import {
  ContextHandoffBoundaryEntry,
  ContextHandoffCheckpointEntry,
  ContextHandoffDocument,
  ContextHandoffMessageEntry,
  ContextHandoffNoticeEntry,
  ContextHandoffPlanEntry,
  ContextHandoffSubagentEntry,
  ContextHandoffToolEntry,
  stableStringifyContextHandoff,
} from "./ContextHandoffBuilder.ts";

export const CONTEXT_HANDOFF_DELIVERY_ARTIFACT_VERSION = 1;
export const CONTEXT_HANDOFF_RENDERER_VERSION = 1;

export const ContextHandoffRenderedDocument = Schema.Struct({
  version: Schema.Literal(CONTEXT_HANDOFF_CONTEXT_VERSION),
  mode: Schema.Literal("full-context-fresh-session"),
  provenance: ContextHandoffDocument.fields.provenance,
  thread: Schema.optional(ContextHandoffDocument.fields.thread),
  messages: Schema.optional(Schema.Array(ContextHandoffMessageEntry)),
  plans: Schema.optional(Schema.Array(ContextHandoffPlanEntry)),
  tools: Schema.optional(Schema.Array(ContextHandoffToolEntry)),
  checkpoints: Schema.optional(Schema.Array(ContextHandoffCheckpointEntry)),
  notices: Schema.optional(Schema.Array(ContextHandoffNoticeEntry)),
  subagents: Schema.optional(Schema.Array(ContextHandoffSubagentEntry)),
  priorHandoffs: Schema.optional(Schema.Array(ContextHandoffBoundaryEntry)),
});
export type ContextHandoffRenderedDocument = typeof ContextHandoffRenderedDocument.Type;

export const ContextHandoffDeliveryArtifact = Schema.Struct({
  artifactVersion: Schema.Literal(CONTEXT_HANDOFF_DELIVERY_ARTIFACT_VERSION),
  rendererVersion: Schema.Literal(CONTEXT_HANDOFF_RENDERER_VERSION),
  renderedContext: ContextHandoffRenderedDocument,
  providerInput: Schema.String,
  triggeringMessage: Schema.Struct({
    messageId: MessageId,
    text: Schema.String,
  }),
  renderedContextDigest: ContextHandoffDigest,
  providerInputDigest: ContextHandoffDigest,
  includedEntryCount: NonNegativeInt,
  totalEntryCount: NonNegativeInt,
  contextChars: NonNegativeInt,
  inputChars: PositiveInt,
  truncated: Schema.Boolean,
  preparedAt: IsoDateTime,
});
export type ContextHandoffDeliveryArtifact = typeof ContextHandoffDeliveryArtifact.Type;

export function digestContextHandoffUtf8(value: string): ContextHandoffDigest {
  return ContextHandoffDigest.make(createHash("sha256").update(value, "utf8").digest("hex"));
}

export function makeContextHandoffDeliveryArtifact(input: {
  readonly renderedContext: ContextHandoffRenderedDocument;
  readonly renderedContextJson: string;
  readonly providerInput: string;
  readonly triggeringMessageId: MessageId;
  readonly triggeringMessage: string;
  readonly includedEntryCount: number;
  readonly totalEntryCount: number;
  readonly contextChars: number;
  readonly inputChars: number;
  readonly truncated: boolean;
  readonly preparedAt: string;
}): ContextHandoffDeliveryArtifact {
  const canonicalRenderedContext = stableStringifyContextHandoff(input.renderedContext);
  if (canonicalRenderedContext !== input.renderedContextJson) {
    throw new Error("Rendered context JSON does not match its structured document");
  }
  return Schema.decodeUnknownSync(ContextHandoffDeliveryArtifact)({
    artifactVersion: CONTEXT_HANDOFF_DELIVERY_ARTIFACT_VERSION,
    rendererVersion: CONTEXT_HANDOFF_RENDERER_VERSION,
    renderedContext: input.renderedContext,
    providerInput: input.providerInput,
    triggeringMessage: {
      messageId: input.triggeringMessageId,
      text: input.triggeringMessage,
    },
    renderedContextDigest: digestContextHandoffUtf8(input.renderedContextJson),
    providerInputDigest: digestContextHandoffUtf8(input.providerInput),
    includedEntryCount: input.includedEntryCount,
    totalEntryCount: input.totalEntryCount,
    contextChars: input.contextChars,
    inputChars: input.inputChars,
    truncated: input.truncated,
    preparedAt: input.preparedAt,
  });
}
