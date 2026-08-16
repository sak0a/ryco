import type { SourceControlRefreshMode } from "@ryco/contracts/settings";

export const POST_PUSH_DISCOVERY_WINDOW_MS = 90_000;
export const AUTOMATIC_DISCOVERY_REFRESH_MS = 10_000;
export const REDUCED_DISCOVERY_REFRESH_MS = 30_000;
export const AUTOMATIC_ACTIVE_REFRESH_MS = 30_000;
export const REDUCED_ACTIVE_REFRESH_MS = 60_000;
export const SOURCE_CONTROL_MAX_BACKOFF_MS = 5 * 60_000;

export type SourceControlRefreshPhase = "discovery" | "active" | "settled";

export function resolveSourceControlRefreshDelay(input: {
  readonly mode: SourceControlRefreshMode;
  readonly phase: SourceControlRefreshPhase;
  readonly nowMs?: number;
  readonly discoveryExpiresAtMs?: number | null;
}): number | false {
  if (input.mode === "manual" || input.phase === "settled") return false;
  if (
    input.phase === "discovery" &&
    input.discoveryExpiresAtMs != null &&
    (input.nowMs ?? Date.now()) >= input.discoveryExpiresAtMs
  ) {
    return false;
  }
  if (input.phase === "discovery") {
    return input.mode === "reduced" ? REDUCED_DISCOVERY_REFRESH_MS : AUTOMATIC_DISCOVERY_REFRESH_MS;
  }
  return input.mode === "reduced" ? REDUCED_ACTIVE_REFRESH_MS : AUTOMATIC_ACTIVE_REFRESH_MS;
}

export function shouldRefreshSourceControlOnLifecycle(input: {
  readonly mode: SourceControlRefreshMode;
  readonly hasData: boolean;
  readonly invalidated: boolean;
  readonly lastFetchedAtMs: number;
  readonly staleTimeMs: number;
  readonly nowMs?: number;
}): boolean {
  if (input.mode === "manual") return false;
  if (!input.hasData || input.invalidated) return true;
  return (input.nowMs ?? Date.now()) - input.lastFetchedAtMs >= input.staleTimeMs;
}

export function resolveSourceControlFailureDelay(input: {
  readonly baseDelayMs: number;
  readonly consecutiveFailures: number;
  readonly retryAfterMs?: number | null;
}): number {
  if (input.retryAfterMs != null && Number.isFinite(input.retryAfterMs)) {
    return Math.min(SOURCE_CONTROL_MAX_BACKOFF_MS, Math.max(1_000, input.retryAfterMs));
  }
  const exponent = Math.max(0, Math.min(8, Math.floor(input.consecutiveFailures) - 1));
  return Math.min(
    SOURCE_CONTROL_MAX_BACKOFF_MS,
    Math.max(1_000, input.baseDelayMs) * 2 ** exponent,
  );
}
