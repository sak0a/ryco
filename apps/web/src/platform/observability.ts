import type { ObservabilityService } from "@ryco/client-runtime/platform";

import { ClientTracingLive } from "../observability/clientTracing";
import { recordWebPerfPayload } from "../perf/perfInstrumentation";

export const webObservability: ObservabilityService = {
  tracingLayer: ClientTracingLive,
  recordPerformance: (label, value) => recordWebPerfPayload(label, value),
};
