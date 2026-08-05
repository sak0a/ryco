import type {
  ContextHandoffEndpointSnapshot,
  ContextHandoffInspectionDeliveryLabel,
  ContextHandoffInspectionScope,
} from "@ryco/contracts";

import type {
  ContextHandoffBoundaryEntry,
  ContextHandoffCheckpointEntry,
  ContextHandoffDocument,
  ContextHandoffMessageEntry,
  ContextHandoffNoticeEntry,
  ContextHandoffPlanEntry,
  ContextHandoffSubagentEntry,
  ContextHandoffToolEntry,
} from "./ContextHandoffBuilder.ts";
import type { ContextHandoffRenderedDocument } from "./ContextHandoffArtifacts.ts";

type InspectableDocument = ContextHandoffDocument | ContextHandoffRenderedDocument;

function endpointLabel(endpoint: ContextHandoffEndpointSnapshot): string {
  const provider = endpoint.providerDisplayName ?? endpoint.driverKind;
  const model = endpoint.modelDisplayName ?? endpoint.modelSlug;
  return `${provider} / ${model}`;
}

function fence(value: string, language = "text"): string {
  const runs = value.match(/`+/g) ?? [];
  const size = Math.max(3, ...runs.map((run) => run.length + 1));
  const delimiter = "`".repeat(size);
  return `${delimiter}${language}\n${value}\n${delimiter}`;
}

function metadata(entry: { readonly createdAt: string; readonly id: string }): string {
  return `- ID: \`${entry.id}\`\n- Created: ${entry.createdAt}`;
}

function messageMarkdown(entry: ContextHandoffMessageEntry): string {
  return `### ${entry.role === "user" ? "User" : "Assistant"}\n\n${metadata(entry)}\n\n${fence(entry.text)}`;
}

function planMarkdown(entry: ContextHandoffPlanEntry): string {
  const body = entry.planMarkdown ?? entry.explanation ?? "";
  const steps = entry.steps
    .map((step) => `- [${step.status === "completed" ? "x" : " "}] ${step.step} (${step.status})`)
    .join("\n");
  return `### Plan\n\n${metadata(entry)}\n\n${body ? `${fence(body, "markdown")}\n\n` : ""}${steps}`.trimEnd();
}

function toolMarkdown(entry: ContextHandoffToolEntry): string {
  const details = [
    `- Type: ${entry.itemType}`,
    `- Lifecycle: ${entry.lifecycle}`,
    ...(entry.status ? [`- Status: ${entry.status}`] : []),
    ...entry.paths.map((path) => `- Path: \`${path}\``),
  ].join("\n");
  const command = entry.command ? `\n\n#### Command\n\n${fence(entry.command, "sh")}` : "";
  const output = entry.output ? `\n\n#### Output\n\n${fence(entry.output)}` : "";
  const detail = entry.detail ? `\n\n#### Detail\n\n${fence(entry.detail)}` : "";
  return `### ${entry.summary}\n\n${metadata(entry)}\n${details ? `\n${details}` : ""}${command}${output}${detail}`;
}

function checkpointMarkdown(entry: ContextHandoffCheckpointEntry): string {
  const files = entry.files
    .map((file) => `- \`${file.path}\` — ${file.kind}, +${file.additions}/-${file.deletions}`)
    .join("\n");
  return `### Checkpoint ${entry.status}\n\n${metadata(entry)}\n- Turn count: ${entry.checkpointTurnCount}${files ? `\n\n${files}` : ""}`;
}

function noticeMarkdown(entry: ContextHandoffNoticeEntry): string {
  const questions = entry.questions
    .map(
      (question) =>
        `#### ${question.header}\n\n${question.question}\n\n${question.options.map((option) => `- ${option}`).join("\n")}`,
    )
    .join("\n\n");
  return `### ${entry.summary}\n\n${metadata(entry)}${entry.detail ? `\n\n${fence(entry.detail)}` : ""}${questions ? `\n\n${questions}` : ""}`;
}

function subagentMarkdown(entry: ContextHandoffSubagentEntry): string {
  return `### ${entry.label ?? entry.subagentId}\n\n${metadata(entry)}\n- Status: ${entry.status}${entry.description ? `\n- Description: ${entry.description}` : ""}\n\n${fence(entry.summary)}`;
}

function boundaryMarkdown(entry: ContextHandoffBoundaryEntry): string {
  return `### Prior handoff\n\n${metadata(entry)}\n- Status: ${entry.status}\n- From: ${entry.sources.map(endpointLabel).join(", ")}\n- To: ${endpointLabel(entry.target)}${entry.error ? `\n\n${fence(entry.error)}` : ""}`;
}

function section<T>(title: string, entries: ReadonlyArray<T>, render: (entry: T) => string) {
  return entries.length > 0 ? `## ${title}\n\n${entries.map(render).join("\n\n")}` : null;
}

const DELIVERY_LABELS: Record<ContextHandoffInspectionDeliveryLabel, string> = {
  sent: "Sent to model",
  "prepared-not-sent": "Prepared, not sent",
  "prepared-not-accepted": "Prepared payload, not accepted",
  "delivery-uncertain": "Attempted payload; delivery uncertain",
};

export function formatContextHandoffMarkdown(input: {
  readonly scope: ContextHandoffInspectionScope;
  readonly handoffId: string;
  readonly status: ContextHandoffInspectionDeliveryLabel;
  readonly createdAt: string;
  readonly digest: string;
  readonly sources: ReadonlyArray<ContextHandoffEndpointSnapshot>;
  readonly target: ContextHandoffEndpointSnapshot;
  readonly truncated: boolean | null;
  readonly document: InspectableDocument;
  readonly triggeringMessage?: string;
}): string {
  const header = [
    "# Ryco context handoff",
    "",
    `- Handoff: \`${input.handoffId}\``,
    `- Scope: ${input.scope === "sent" ? "Sent to model" : "Complete artifact"}`,
    `- Delivery: ${DELIVERY_LABELS[input.status]}`,
    `- Created: ${input.createdAt}`,
    `- From: ${input.sources.map(endpointLabel).join(", ")}`,
    `- To: ${endpointLabel(input.target)}`,
    `- Digest (SHA-256): \`${input.digest}\``,
    ...(input.truncated === null
      ? []
      : [`- Input-budget trimmed: ${input.truncated ? "yes" : "no"}`]),
  ].join("\n");
  const sections = [
    section("Messages", input.document.messages ?? [], messageMarkdown),
    section("Plans", input.document.plans ?? [], planMarkdown),
    section("Tools and terminal results", input.document.tools ?? [], toolMarkdown),
    section("Checkpoints and changed files", input.document.checkpoints ?? [], checkpointMarkdown),
    section("Notices and pending questions", input.document.notices ?? [], noticeMarkdown),
    section("Subagents", input.document.subagents ?? [], subagentMarkdown),
    section("Prior handoffs", input.document.priorHandoffs ?? [], boundaryMarkdown),
    input.scope === "sent" && input.triggeringMessage !== undefined
      ? `## Triggering user message\n\n${fence(input.triggeringMessage)}`
      : null,
  ].filter((value): value is string => value !== null);
  return `${header}${sections.length > 0 ? `\n\n${sections.join("\n\n")}` : ""}\n`;
}
