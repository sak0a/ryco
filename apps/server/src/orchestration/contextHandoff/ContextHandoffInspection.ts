import {
  CONTEXT_HANDOFF_INSPECTION_CHUNK_MAX_BYTES,
  ContextHandoffInspectionError,
  type ContextHandoffInspectionDeliveryLabel,
  type ContextHandoffInspectionSection,
} from "@ryco/contracts";

import type { ContextHandoffOperationalStatus } from "../../persistence/Services/ContextHandoffs.ts";
import type { ContextHandoffDocument } from "./ContextHandoffBuilder.ts";
import { stableStringifyContextHandoff } from "./ContextHandoffBuilder.ts";
import {
  type ContextHandoffDeliveryArtifact,
  type ContextHandoffRenderedDocument,
  digestContextHandoffUtf8,
} from "./ContextHandoffArtifacts.ts";

export const CONTEXT_HANDOFF_SECTION_ORDER: ReadonlyArray<
  Exclude<ContextHandoffInspectionSection, "triggeringMessage">
> = ["messages", "plans", "tools", "checkpoints", "notices", "subagents", "priorHandoffs"];

type InspectableDocument = ContextHandoffDocument | ContextHandoffRenderedDocument;

export function contextHandoffDeliveryLabel(
  status: ContextHandoffOperationalStatus,
  hasDeliveryArtifact: boolean,
): ContextHandoffInspectionDeliveryLabel {
  if (status === "consumed") return "sent";
  if (status === "delivery-uncertain") return "delivery-uncertain";
  return hasDeliveryArtifact ? "prepared-not-accepted" : "prepared-not-sent";
}

export function contextHandoffSectionEntries(
  document: InspectableDocument,
  section: Exclude<ContextHandoffInspectionSection, "triggeringMessage">,
): ReadonlyArray<unknown> {
  return document[section] ?? [];
}

export function contextHandoffSectionCounts(
  document: InspectableDocument,
  includeTriggeringMessage: boolean,
) {
  const sections: Array<{
    readonly section: ContextHandoffInspectionSection;
    readonly entryCount: number;
  }> = CONTEXT_HANDOFF_SECTION_ORDER.flatMap((section) => {
    const entryCount = contextHandoffSectionEntries(document, section).length;
    return entryCount > 0 ? [{ section, entryCount }] : [];
  });
  if (includeTriggeringMessage) {
    sections.push({ section: "triggeringMessage", entryCount: 1 });
  }
  return sections;
}

export function contextHandoffEntryId(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { readonly id?: unknown }).id;
    if (typeof id === "string" && id.trim().length > 0) return id;
  }
  return fallback;
}

interface InspectionCursor {
  readonly handoffId: string;
  readonly scope: "sent" | "complete";
  readonly section: ContextHandoffInspectionSection;
  readonly digest: string;
  readonly index: number;
}

export function encodeContextHandoffCursor(cursor: InspectionCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeContextHandoffCursor(value: string): InspectionCursor {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!decoded || typeof decoded !== "object") throw new Error("invalid cursor");
    const cursor = decoded as Record<string, unknown>;
    if (
      typeof cursor.handoffId !== "string" ||
      (cursor.scope !== "sent" && cursor.scope !== "complete") ||
      typeof cursor.section !== "string" ||
      typeof cursor.digest !== "string" ||
      typeof cursor.index !== "number" ||
      !Number.isSafeInteger(cursor.index) ||
      cursor.index < 0
    ) {
      throw new Error("invalid cursor");
    }
    return cursor as unknown as InspectionCursor;
  } catch {
    throw new ContextHandoffInspectionError({
      reason: "invalid-cursor",
      message: "The context handoff page cursor is invalid or stale.",
    });
  }
}

export function formatContextHandoffJson(input: {
  readonly scope: "sent" | "complete";
  readonly handoffId: string;
  readonly status: ContextHandoffInspectionDeliveryLabel;
  readonly digest: string;
  readonly completeDocument: ContextHandoffDocument;
  readonly deliveryArtifact?: ContextHandoffDeliveryArtifact;
}): string {
  return stableStringifyContextHandoff(
    input.scope === "sent"
      ? {
          exportVersion: 1,
          scope: "sent",
          handoffId: input.handoffId,
          deliveryStatus: input.status,
          digest: input.digest,
          deliveryArtifact: input.deliveryArtifact!,
        }
      : {
          exportVersion: 1,
          scope: "complete",
          handoffId: input.handoffId,
          deliveryStatus: input.status,
          digest: input.digest,
          document: input.completeDocument,
        },
  );
}

export interface ContextHandoffUtf8Chunk {
  readonly offset: number;
  readonly chunk: string;
  readonly nextOffset: number | null;
  readonly totalBytes: number;
  readonly digest: string;
}

export function contextHandoffUtf8Chunk(
  value: string,
  offset: number,
  maxBytes = CONTEXT_HANDOFF_INSPECTION_CHUNK_MAX_BYTES,
): ContextHandoffUtf8Chunk {
  const bytes = new TextEncoder().encode(value);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > bytes.byteLength) {
    throw new ContextHandoffInspectionError({
      reason: "invalid-offset",
      message: "The context handoff byte offset is invalid.",
    });
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    decoder.decode(bytes.slice(0, offset));
  } catch {
    throw new ContextHandoffInspectionError({
      reason: "invalid-offset",
      message: "The context handoff byte offset is not a UTF-8 boundary.",
    });
  }
  let end = Math.min(bytes.byteLength, offset + maxBytes);
  let chunk = "";
  while (end >= offset) {
    try {
      chunk = decoder.decode(bytes.slice(offset, end));
      break;
    } catch {
      end -= 1;
    }
  }
  if (end < offset) {
    throw new ContextHandoffInspectionError({
      reason: "internal",
      message: "The context handoff chunk could not be encoded.",
    });
  }
  return {
    offset,
    chunk,
    nextOffset: end < bytes.byteLength ? end : null,
    totalBytes: bytes.byteLength,
    digest: digestContextHandoffUtf8(value),
  };
}
