const AGENT_CONTROL_STARTUP_RETRY_DELAYS_MS = [50, 100, 200, 400] as const;

const isAgentControlStarting = (error: unknown): boolean =>
  error instanceof Error && error.message.trim() === "Agent Control is disabled.";

const wait = (delayMs: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, delayMs));

/**
 * Server settings are patched optimistically in the client. When Agent Control
 * is first enabled, its settings panels can therefore mount just before the
 * update RPC reaches the server. Retry only that precise transient failure;
 * every other error remains immediately visible to the user.
 */
export async function retryAgentControlStartup<Result>(
  operation: () => Promise<Result>,
  sleep: (delayMs: number) => Promise<void> = wait,
): Promise<Result> {
  for (const delayMs of AGENT_CONTROL_STARTUP_RETRY_DELAYS_MS) {
    try {
      return await operation();
    } catch (error) {
      if (!isAgentControlStarting(error)) throw error;
      await sleep(delayMs);
    }
  }

  return operation();
}
