import type { ComposerSourceControlContext, ComposerWorkItemContext } from "@ryco/contracts";
import type { ChatContextAttachment } from "../types";

/**
 * Returns the compact display reference for a source-control context.
 * Cross-repo references keep their `owner/repo#N` form; same-repo references
 * collapse to `#N`. The context's `reference` field carries the original
 * user-facing reference (`github#42`, `owner/repo#42`, or a URL), so the
 * number from the fetched detail is authoritative.
 */
function sourceControlDisplayReference(context: ComposerSourceControlContext): string {
  const hashIndex = context.reference.indexOf("#");
  const beforeHash = hashIndex >= 0 ? context.reference.slice(0, hashIndex) : "";
  if (beforeHash.includes("/")) {
    return context.reference;
  }
  return `#${context.detail.number}`;
}

function sourceControlDisplayState(context: ComposerSourceControlContext): string {
  if (
    context.kind === "change-request" &&
    "isDraft" in context.detail &&
    context.detail.isDraft === true &&
    context.detail.state === "open"
  ) {
    return "draft";
  }
  return context.detail.state;
}

/**
 * Builds the compact `type: "context"` chat attachments persisted on the
 * message so the timeline can render what the agent received. Display
 * snapshot only — the full detail rides the command-level context arrays.
 */
export function buildChatContextAttachments(input: {
  sourceControlContexts: ReadonlyArray<ComposerSourceControlContext>;
  workItemContexts: ReadonlyArray<ComposerWorkItemContext>;
}): ChatContextAttachment[] {
  const sourceControlAttachments = input.sourceControlContexts.map(
    (context): ChatContextAttachment => ({
      type: "context",
      id: context.id,
      kind: context.kind,
      provider: context.provider,
      reference: sourceControlDisplayReference(context),
      title: context.detail.title,
      state: sourceControlDisplayState(context),
      url: context.detail.url,
    }),
  );
  const workItemAttachments = input.workItemContexts.map(
    (context): ChatContextAttachment => ({
      type: "context",
      id: context.id,
      kind: "work-item",
      provider: context.provider,
      reference: context.key,
      title: context.detail.title,
      state: context.detail.stateName?.trim() || context.detail.state,
      url: context.detail.url,
    }),
  );
  return [...sourceControlAttachments, ...workItemAttachments];
}
