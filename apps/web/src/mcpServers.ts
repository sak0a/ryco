import type {
  McpSecretMutationMap,
  McpServer,
  McpServerConfig,
  McpTransport,
} from "@ryco/contracts";

export const MCP_SERVER_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

export interface McpServerFormState {
  readonly name: string;
  readonly transport: Exclude<McpTransport, "unknown">;
  readonly command: string;
  readonly argsText: string;
  readonly cwd: string;
  readonly url: string;
  readonly bearerTokenEnvVar: string;
  readonly envText: string;
  readonly envVarsText: string;
  readonly httpHeadersText: string;
  readonly envHttpHeadersText: string;
  readonly enabled: boolean;
  readonly required: boolean;
  readonly startupTimeoutSec: string;
  readonly toolTimeoutSec: string;
  readonly enabledToolsText: string;
  readonly disabledToolsText: string;
  readonly oauthScopesText: string;
  readonly secretFields: ReadonlyArray<string>;
  readonly clearedSecretFields: ReadonlyArray<string>;
}

export function createEmptyMcpServerForm(): McpServerFormState {
  return {
    name: "",
    transport: "stdio",
    command: "",
    argsText: "",
    cwd: "",
    url: "",
    bearerTokenEnvVar: "",
    envText: "",
    envVarsText: "",
    httpHeadersText: "",
    envHttpHeadersText: "",
    enabled: true,
    required: false,
    startupTimeoutSec: "",
    toolTimeoutSec: "",
    enabledToolsText: "",
    disabledToolsText: "",
    oauthScopesText: "",
    secretFields: [],
    clearedSecretFields: [],
  };
}

function joinList(values: readonly string[]): string {
  return values.join("\n");
}

function joinRecord(record: Readonly<Record<string, string>>): string {
  return Object.entries(record)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export function formFromMcpServer(server: McpServer): McpServerFormState {
  const config = server.config;
  return {
    name: server.name,
    transport: config.transport === "http" ? "http" : "stdio",
    command: config.command ?? "",
    argsText: joinList(config.args),
    cwd: config.cwd ?? "",
    url: config.url ?? "",
    bearerTokenEnvVar: config.bearerTokenEnvVar ?? "",
    envText: joinRecord(config.env),
    envVarsText: joinList(config.envVars),
    httpHeadersText: joinRecord(config.httpHeaders),
    envHttpHeadersText: joinRecord(config.envHttpHeaders),
    enabled: config.enabled,
    required: config.required ?? false,
    startupTimeoutSec: config.startupTimeoutSec?.toString() ?? "",
    toolTimeoutSec: config.toolTimeoutSec?.toString() ?? "",
    enabledToolsText: joinList(config.enabledTools),
    disabledToolsText: joinList(config.disabledTools),
    oauthScopesText: joinList(config.oauthScopes),
    secretFields: Object.entries(config.secretFields ?? {})
      .filter(([, presence]) => presence === "present")
      .map(([field]) => field)
      .toSorted(),
    clearedSecretFields: [],
  };
}

function parseList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseRecord(value: string): Record<string, string> {
  const record: Record<string, string> = {};
  for (const line of parseList(value)) {
    const splitAt = line.indexOf("=");
    if (splitAt <= 0) continue;
    const key = line.slice(0, splitAt).trim();
    const entryValue = line.slice(splitAt + 1).trim();
    if (key.length > 0) {
      record[key] = entryValue;
    }
  }
  return record;
}

function parseOptionalPositiveNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.NaN;
}

export function validateMcpServerForm(form: McpServerFormState): string | null {
  const name = form.name.trim();
  if (!MCP_SERVER_NAME_PATTERN.test(name)) {
    return "Server name must start with a letter and use only letters, numbers, dashes, and underscores.";
  }
  if (form.transport === "stdio" && form.command.trim().length === 0) {
    return "Stdio servers need a command.";
  }
  if (form.transport === "http" && form.url.trim().length === 0) {
    return "HTTP servers need a URL.";
  }
  for (const [label, value] of [
    ["Startup timeout", form.startupTimeoutSec],
    ["Tool timeout", form.toolTimeoutSec],
  ] as const) {
    const parsed = parseOptionalPositiveNumber(value);
    if (Number.isNaN(parsed)) {
      return `${label} must be a positive number.`;
    }
  }
  return null;
}

export function configFromMcpServerForm(form: McpServerFormState): McpServerConfig {
  const startupTimeoutSec = parseOptionalPositiveNumber(form.startupTimeoutSec);
  const toolTimeoutSec = parseOptionalPositiveNumber(form.toolTimeoutSec);

  return {
    transport: form.transport,
    command: form.command.trim(),
    args: parseList(form.argsText),
    cwd: form.cwd.trim() || null,
    url: form.url.trim(),
    bearerTokenEnvVar: form.bearerTokenEnvVar.trim() || null,
    env: parseRecord(form.envText),
    envVars: parseList(form.envVarsText),
    httpHeaders: parseRecord(form.httpHeadersText),
    envHttpHeaders: parseRecord(form.envHttpHeadersText),
    enabled: form.enabled,
    required: form.required,
    ...(startupTimeoutSec === undefined || Number.isNaN(startupTimeoutSec)
      ? {}
      : { startupTimeoutSec }),
    ...(toolTimeoutSec === undefined || Number.isNaN(toolTimeoutSec) ? {} : { toolTimeoutSec }),
    enabledTools: parseList(form.enabledToolsText),
    disabledTools: parseList(form.disabledToolsText),
    oauthScopes: parseList(form.oauthScopesText),
  };
}

export function secretMutationsFromMcpServerForm(form: McpServerFormState): McpSecretMutationMap {
  return Object.fromEntries(
    form.secretFields.map((field) => [
      field,
      form.clearedSecretFields.includes(field)
        ? ({ action: "clear" } as const)
        : ({ action: "retain" } as const),
    ]),
  );
}

export function summarizeMcpServerConnection(server: McpServer): string {
  const config = server.config;
  if (config.transport === "http") {
    return config.url || "HTTP";
  }
  if (config.transport === "stdio") {
    return [config.command, ...config.args].filter(Boolean).join(" ") || "stdio";
  }
  return "Configured outside the known MCP schema";
}
