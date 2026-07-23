import {
  createEnvironmentConnection as createRuntimeEnvironmentConnection,
  type EnvironmentConnection,
  type EnvironmentConnectionInput,
  type OrchestrationHandlers,
} from "@ryco/client-runtime/connection";

import {
  recordPushSequenceEvent,
  recordPushSequenceSnapshot,
} from "~/diagnostics/pushSequenceMonitor";

export type { EnvironmentConnection, OrchestrationHandlers };

type WebEnvironmentConnectionInput = Omit<EnvironmentConnectionInput, "pushSequenceMonitor">;

const pushSequenceMonitor = {
  recordEvent: recordPushSequenceEvent,
  recordSnapshot: recordPushSequenceSnapshot,
};

/** Web binding for the neutral connection core and the existing zustand monitor. */
export function createEnvironmentConnection(
  input: WebEnvironmentConnectionInput,
): EnvironmentConnection {
  return createRuntimeEnvironmentConnection({ ...input, pushSequenceMonitor });
}
