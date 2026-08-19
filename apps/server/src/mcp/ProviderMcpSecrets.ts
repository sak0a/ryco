import type { McpSecretMutationMap, McpSecretPresenceMap } from "@ryco/contracts";

export function applyProviderMcpSecretMutations(
  existing: Readonly<Record<string, string>>,
  replacements: Readonly<Record<string, string>>,
  prefix: string,
  mutations: McpSecretMutationMap = {},
): Record<string, string> {
  const result = { ...existing, ...replacements };
  for (const [field, mutation] of Object.entries(mutations)) {
    if (!field.startsWith(`${prefix}.`)) continue;
    const key = field.slice(prefix.length + 1);
    if (!key) continue;
    if (mutation.action === "clear") delete result[key];
    if (mutation.action === "replace") result[key] = mutation.value;
  }
  return result;
}

export function providerMcpSecretPresence(
  records: ReadonlyArray<{
    readonly prefix: string;
    readonly values: Readonly<Record<string, string>>;
  }>,
): McpSecretPresenceMap {
  return Object.fromEntries(
    records.flatMap(({ prefix, values }) =>
      Object.keys(values).map((key) => [`${prefix}.${key}`, "present" as const]),
    ),
  );
}
