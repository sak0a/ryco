import type {
  DiagnosticsProviderProcess,
  DiagnosticsSnapshot,
  DiagnosticsTerminalProcess,
} from "@ryco/contracts";
import { Context, Effect } from "effect";

import type { TraceRecord } from "../../observability/TraceRecord.ts";

export interface DiagnosticsSnapshotInput {
  readonly providers: ReadonlyArray<DiagnosticsProviderProcess>;
  readonly terminals: ReadonlyArray<DiagnosticsTerminalProcess>;
}

export interface DiagnosticsShape {
  readonly recordTraceRecords: (records: ReadonlyArray<TraceRecord>) => void;
  readonly getSnapshot: (input: DiagnosticsSnapshotInput) => Effect.Effect<DiagnosticsSnapshot>;
}

export class Diagnostics extends Context.Service<Diagnostics, DiagnosticsShape>()(
  "ryco/diagnostics/Services/Diagnostics",
) {}
