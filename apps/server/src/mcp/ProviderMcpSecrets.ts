import { createHash } from "node:crypto";

import {
  McpServerWritableConfig,
  type McpServerWritableConfig as McpServerWritableConfigType,
  McpSecretMutationMap,
  McpSecretPresenceMap,
} from "@ryco/contracts";
import { Schema } from "effect";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export function providerMcpConfigFingerprint(config: McpServerWritableConfigType): string {
  const normalized = Schema.decodeSync(McpServerWritableConfig)(config);
  return createHash("sha256")
    .update(
      JSON.stringify(canonicalize(Schema.encodeSync(McpServerWritableConfig)(normalized))),
      "utf8",
    )
    .digest("base64url");
}

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
