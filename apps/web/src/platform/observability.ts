import type { ObservabilityService } from "@ryco/client-runtime/platform";

import { ClientTracingLive } from "../observability/clientTracing";
import { isWebPerfProfileEnabled, recordWebPerfPayload } from "../perf/perfInstrumentation";

export const webObservability: ObservabilityService = {
  tracingLayer: ClientTracingLive,
  performanceEnabled: () => isWebPerfProfileEnabled(),
  recordPerformance: (label, value, record) => recordWebPerfPayload(label, value, record),
};
