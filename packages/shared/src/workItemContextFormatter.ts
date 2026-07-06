import type { ComposerWorkItemContext, WorkItemComment, WorkItemDetail } from "@ryco/contracts";

function formatTimestamp(value: unknown): string {
  return typeof value === "object" && value !== null && "toJSON" in value
    ? (value as { toJSON(): string }).toJSON()
    : String(value);
}

function formatComment(comment: WorkItemComment): string {
  return `- ${comment.author} (${formatTimestamp(comment.createdAt)}): ${comment.body}`;
}

function formatWorkItemSection(detail: WorkItemDetail): string {
  const lines: string[] = [];
  lines.push(`### Work Item ${detail.key}: ${detail.title}`);
  lines.push(`URL: ${detail.url}`);
  lines.push(`Status: ${detail.stateName ?? detail.state}`);
  if (detail.issueType) lines.push(`Type: ${detail.issueType}`);
  if (detail.priority) lines.push(`Priority: ${detail.priority}`);
  if (detail.assignee) lines.push(`Assignee: ${detail.assignee}`);
  if (detail.reporter) lines.push(`Reporter: ${detail.reporter}`);
  if (detail.labels && detail.labels.length > 0) {
    lines.push(`Labels: ${detail.labels.join(", ")}`);
  }
  if (detail.dueDate) lines.push(`Due: ${detail.dueDate}`);
  if (detail.parentKey) lines.push(`Parent: ${detail.parentKey}`);
  lines.push("");
  lines.push(detail.description);
  if (detail.comments.length > 0) {
    lines.push("");
    lines.push("Recent comments:");
    for (const comment of detail.comments) {
      lines.push(formatComment(comment));
    }
  }
  if (detail.truncated) {
    lines.push("");
    lines.push("> Note: this context was truncated by the server.");
  }
  return lines.join("\n");
}

export function formatWorkItemContextsForAgent(
  contexts: ReadonlyArray<ComposerWorkItemContext>,
): string {
  if (contexts.length === 0) return "";

  const sections = contexts.map((ctx) => formatWorkItemSection(ctx.detail));

  return `## Attached work-item context\n\n${sections.join("\n\n")}`;
}
