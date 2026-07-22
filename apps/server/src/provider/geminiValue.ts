export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function trimToUndefined(value: unknown): string | undefined {
  const candidate = typeof value === "string" ? value.trim() : "";
  return candidate.length > 0 ? candidate : undefined;
}
