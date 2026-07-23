export const BROWSER_SAVED_ENVIRONMENT_BEARER_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function computeBearerTokenExpiresAt(nowMs: number): string {
  return new Date(nowMs + BROWSER_SAVED_ENVIRONMENT_BEARER_TOKEN_MAX_AGE_MS).toISOString();
}

export function readTimestampMs(value: string | undefined): number | null {
  if (!value) return null;
  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

export function isBearerTokenUsable(input: {
  readonly token: string | undefined;
  readonly expiresAt: string | undefined;
  readonly nowMs: number;
}): boolean {
  if (!input.token || input.token.trim().length === 0) return false;
  const expiresAtMs = readTimestampMs(input.expiresAt);
  if (input.expiresAt !== undefined && expiresAtMs === null) return false;
  return expiresAtMs === null || expiresAtMs > input.nowMs;
}
