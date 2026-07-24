import { NOOP_OBSERVABILITY, type ObservabilityService } from "@ryco/client-runtime/platform";

// The MVP ships no client telemetry (the upstream default endpoint is stripped).
// Use the runtime's no-op observability; a real tracing layer can be wired later
// without changing the contract surface.
export const mobileObservability: ObservabilityService = NOOP_OBSERVABILITY;
