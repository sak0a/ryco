import type {
  ContextHandoffExportChunk,
  ContextHandoffExportChunkInput,
  ContextHandoffInspectionEntriesInput,
  ContextHandoffInspectionEntriesPage,
  ContextHandoffInspectionError,
  ContextHandoffInspectionSummary,
  ContextHandoffInspectionSummaryInput,
  ContextHandoffRawPayloadChunk,
  ContextHandoffRawPayloadChunkInput,
} from "@ryco/contracts";
import { Context, type Effect } from "effect";

export interface ContextHandoffInspectionShape {
  readonly getSummary: (
    input: ContextHandoffInspectionSummaryInput,
  ) => Effect.Effect<ContextHandoffInspectionSummary, ContextHandoffInspectionError>;
  readonly listEntries: (
    input: ContextHandoffInspectionEntriesInput,
  ) => Effect.Effect<ContextHandoffInspectionEntriesPage, ContextHandoffInspectionError>;
  readonly readRawChunk: (
    input: ContextHandoffRawPayloadChunkInput,
  ) => Effect.Effect<ContextHandoffRawPayloadChunk, ContextHandoffInspectionError>;
  readonly readExportChunk: (
    input: ContextHandoffExportChunkInput,
  ) => Effect.Effect<ContextHandoffExportChunk, ContextHandoffInspectionError>;
}

export class ContextHandoffInspection extends Context.Service<
  ContextHandoffInspection,
  ContextHandoffInspectionShape
>()("ryco/orchestration/Services/ContextHandoffInspection") {}
