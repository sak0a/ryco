import type {
  DiagnosticsProviderProcess,
  DiagnosticsSnapshot,
  DiagnosticsTerminalProcess,
} from "@ryco/contracts";
import { Context, Effect, Metric } from "effect";

import type { ServerLocalDiagnosticsMetricsSnapshot } from "../../observability/Services/LocalDiagnosticsMetrics.ts";
import type { TraceRecord } from "../../observability/TraceRecord.ts";

export interface DiagnosticsSnapshotInput {
  readonly providers: ReadonlyArray<DiagnosticsProviderProcess>;
  readonly terminals: ReadonlyArray<DiagnosticsTerminalProcess>;
  readonly localMetrics?: ServerLocalDiagnosticsMetricsSnapshot;
  readonly metricSnapshots?: ReadonlyArray<Metric.Metric.Snapshot>;
}

export interface DiagnosticsShape {
  readonly recordTraceRecords: (records: ReadonlyArray<TraceRecord>) => void;
  readonly getSnapshot: (input: DiagnosticsSnapshotInput) => Effect.Effect<DiagnosticsSnapshot>;
}

export class Diagnostics extends Context.Service<Diagnostics, DiagnosticsShape>()(
  "ryco/diagnostics/Services/Diagnostics",
) {}
