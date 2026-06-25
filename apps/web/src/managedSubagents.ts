export const MIN_MANAGED_SUBAGENT_COUNT = 1;
export const MAX_MANAGED_SUBAGENT_COUNT = 4;

export function clampManagedSubagentCount(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_MANAGED_SUBAGENT_COUNT;
  }
  return Math.min(
    MAX_MANAGED_SUBAGENT_COUNT,
    Math.max(MIN_MANAGED_SUBAGENT_COUNT, Math.trunc(value)),
  );
}
