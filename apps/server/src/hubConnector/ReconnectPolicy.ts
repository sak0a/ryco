import { RELAY_MAX_RETRY_AFTER_MS } from "@ryco/contracts/relay";

export interface ReconnectPolicyConfig {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitterRatio: number;
}

export interface ReconnectDecision {
  readonly attempt: number;
  readonly delayMs: number;
}

export function reconnectDelay(
  config: ReconnectPolicyConfig,
  attempt: number,
  randomValue: number,
  retryAfterMs?: number,
): ReconnectDecision {
  if (
    !Number.isSafeInteger(attempt) ||
    attempt < 0 ||
    !Number.isFinite(randomValue) ||
    randomValue < 0 ||
    randomValue > 1
  ) {
    throw new Error("Reconnect policy input is invalid.");
  }
  const exponent = Math.min(attempt, 52);
  const exponential = Math.min(config.maxDelayMs, config.baseDelayMs * 2 ** exponent);
  const multiplier = 1 - config.jitterRatio + 2 * config.jitterRatio * randomValue;
  const jittered = Math.max(250, Math.min(config.maxDelayMs, Math.round(exponential * multiplier)));
  const boundedRetryAfter =
    retryAfterMs === undefined
      ? 0
      : Math.max(0, Math.min(RELAY_MAX_RETRY_AFTER_MS, Math.round(retryAfterMs)));
  return {
    attempt,
    delayMs: Math.min(RELAY_MAX_RETRY_AFTER_MS, Math.max(jittered, boundedRetryAfter)),
  };
}
