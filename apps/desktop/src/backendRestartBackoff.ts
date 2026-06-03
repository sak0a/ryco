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
