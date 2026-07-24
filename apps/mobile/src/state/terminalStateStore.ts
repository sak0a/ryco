import { createTerminalStateStore } from "@ryco/client-runtime/state/terminal";

export * from "@ryco/client-runtime/state/terminal";

// The terminal state store is required even though the terminal screen is
// deferred to v1.1: the environment state sink's clearTerminalState writes
// through it. B1 uses the default in-memory storage (no terminal persistence).
export const useTerminalStateStore = createTerminalStateStore();
