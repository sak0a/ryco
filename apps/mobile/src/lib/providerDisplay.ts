const BUILT_IN_PROVIDER_LABELS: Readonly<Record<string, string>> = {
  codex: "Codex",
  claudeAgent: "Claude",
  copilot: "GitHub Copilot",
  opencode: "OpenCode",
  cursor: "Cursor",
  grok: "Grok",
};

export function providerDisplayLabel(
  driver: string | null | undefined,
  configuredName?: string | null,
): string | null {
  if (configuredName?.trim()) return configuredName.trim();
  if (!driver) return null;
  return BUILT_IN_PROVIDER_LABELS[driver] ?? driver;
}

/** Back-compat default instances use the driver slug as their routing key. */
export function builtInProviderDriverForInstanceId(
  instanceId: string | null | undefined,
): string | null {
  if (!instanceId) return null;
  return Object.hasOwn(BUILT_IN_PROVIDER_LABELS, instanceId) ? instanceId : null;
}
