export interface BackendRestartBackoff {
  nextDelayMs: () => number;
  reset: () => void;
}

export interface BackendRestartBackoffOptions {
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
}

export function createBackendRestartBackoff(
  options: BackendRestartBackoffOptions,
): BackendRestartBackoff {
  if (
    !Number.isFinite(options.initialDelayMs) ||
    options.initialDelayMs <= 0 ||
    !Number.isFinite(options.maxDelayMs) ||
    options.maxDelayMs <= 0 ||
    options.maxDelayMs < options.initialDelayMs
  ) {
    throw new RangeError(
      `Invalid backend restart backoff options: initialDelayMs=${options.initialDelayMs}, maxDelayMs=${options.maxDelayMs}. Expected finite positive delays with maxDelayMs >= initialDelayMs.`,
    );
  }

  let restartAttempt = 0;

  return {
    nextDelayMs: () => {
      const delayMs = Math.min(options.initialDelayMs * 2 ** restartAttempt, options.maxDelayMs);
      restartAttempt += 1;
      return delayMs;
    },
    reset: () => {
      restartAttempt = 0;
    },
  };
}
