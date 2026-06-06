import type { EnvironmentId } from "@ryco/contracts";

const GENERIC_LOCAL_ENVIRONMENT_LABELS = new Set(["local", "local environment"]);

export function normalizeDisplayLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function isGenericLocalEnvironmentLabel(value: string | null | undefined): boolean {
  const label = normalizeDisplayLabel(value);
  return label !== null && GENERIC_LOCAL_ENVIRONMENT_LABELS.has(label.toLowerCase());
}

export function resolveProjectEnvironmentLabel(input: {
  environmentId: EnvironmentId;
  label: string | null | undefined;
}): string | null {
  const label = normalizeDisplayLabel(input.label);
  if (!label) {
    return null;
  }

  if (isGenericLocalEnvironmentLabel(label)) {
    return null;
  }

  return label;
}
