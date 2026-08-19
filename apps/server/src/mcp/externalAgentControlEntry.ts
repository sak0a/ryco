import { createHash } from "node:crypto";

import {
  McpServerWritableConfig,
  type McpServerConfig,
  type McpServerWritableConfig as McpServerWritableConfigType,
} from "@ryco/contracts";
import { Schema } from "effect";

import type { ProviderMcpExternalAgentControlDesiredEntry } from "./ProviderMcpAdapter.ts";

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

export function externalAgentControlServerConfig(
  input: Pick<ProviderMcpExternalAgentControlDesiredEntry, "command" | "args">,
): McpServerWritableConfigType {
  return Schema.decodeSync(McpServerWritableConfig)({
    transport: "stdio",
    command: input.command,
    args: input.args,
  });
}

export function externalAgentControlConfigFingerprint(
  config: McpServerConfig | McpServerWritableConfigType,
): string {
  const normalized = Schema.decodeSync(McpServerWritableConfig)(config);
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(Schema.encodeSync(McpServerWritableConfig)(normalized))))
    .digest("hex");
}
