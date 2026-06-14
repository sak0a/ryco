import type { EnvironmentId, ServerObservability, ServerProvider } from "@ryco/contracts";

import type { PushSequenceEnvironmentState } from "../../diagnostics/pushSequenceMonitor";
import type {
  SavedEnvironmentRecord,
  SavedEnvironmentRuntimeState,
} from "../../environments/runtime";

export const REDACTED_PLACEHOLDER = "[redacted]";

/**
 * Property names whose values must never leave the device. Matched
 * case-insensitively against object keys during redaction.
 */
const SECRET_KEY_PATTERN =
  /(token|secret|password|passwd|credential|authorization|bearer|api[-_]?key|apikey|cookie|session[-_]?id|private[-_]?key|pairing[-_]?code|access[-_]?key|signature|email)/i;

/**
 * Strip user-info and known sensitive query parameters from a URL string.
 * Returns the input untouched when it is not a parseable URL.
 */
export function redactUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }

  if (url.username || url.password) {
    url.username = "";
    url.password = "";
  }

  for (const key of [...url.searchParams.keys()]) {
    if (SECRET_KEY_PATTERN.test(key)) {
      url.searchParams.set(key, REDACTED_PLACEHOLDER);
    }
  }

  return url.toString();
}

/**
 * Recursively redact secret-bearing properties from an arbitrary JSON-like
 * value. Keys matching {@link SECRET_KEY_PATTERN} are replaced wholesale;
 * string values that parse as URLs are sanitized via {@link redactUrl}.
 */
export function redactSecrets<T>(value: T): T {
  return redactSecretsInternal(value, false) as T;
}

function redactSecretsInternal(value: unknown, keyIsSecret: boolean): unknown {
  if (keyIsSecret) {
    return value === null || value === undefined ? value : REDACTED_PLACEHOLDER;
  }

  if (typeof value === "string") {
    return redactUrl(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactSecretsInternal(entry, false));
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = redactSecretsInternal(entry, SECRET_KEY_PATTERN.test(key));
    }
    return result;
  }

  return value;
}

export interface DiagnosticsBundleInput {
  readonly generatedAt: string;
  readonly app: {
    readonly version: string;
    readonly stage: string;
    readonly isElectron: boolean;
    readonly userAgent: string | null;
  };
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly record: SavedEnvironmentRecord | null;
    readonly runtime: SavedEnvironmentRuntimeState | null;
    readonly pushSequence: PushSequenceEnvironmentState | null;
  }>;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly observability: ServerObservability | null;
}

export interface DiagnosticsBundle {
  readonly generatedAt: string;
  readonly app: DiagnosticsBundleInput["app"];
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly label: string | null;
    readonly httpBaseUrl: string | null;
    readonly wsBaseUrl: string | null;
    readonly connectionState: string | null;
    readonly authState: string | null;
    readonly role: string | null;
    readonly lastError: string | null;
    readonly lastErrorAt: string | null;
    readonly connectedAt: string | null;
    readonly disconnectedAt: string | null;
    readonly pushSequence: PushSequenceEnvironmentState | null;
  }>;
  readonly providers: ReadonlyArray<{
    readonly instanceId: string;
    readonly driver: string;
    readonly enabled: boolean;
    readonly installed: boolean;
    readonly version: string | null;
    readonly status: string;
    readonly availability: string;
    readonly authStatus: string;
    readonly authType: string | null;
    readonly message: string | null;
    readonly unavailableReason: string | null;
    readonly checkedAt: string;
  }>;
  readonly observability: {
    readonly logsDirectoryPath: string;
    readonly localTracingEnabled: boolean;
    readonly otlpTracesEnabled: boolean;
    readonly otlpMetricsEnabled: boolean;
  } | null;
}

/**
 * Build the operator debug bundle. Deliberately allowlists fields rather than
 * spreading raw records, then runs the whole structure through
 * {@link redactSecrets} as a defense-in-depth pass so newly added sensitive
 * fields cannot silently leak.
 */
export function buildDiagnosticsBundle(input: DiagnosticsBundleInput): DiagnosticsBundle {
  const bundle: DiagnosticsBundle = {
    generatedAt: input.generatedAt,
    app: input.app,
    environments: input.environments.map((entry) => ({
      environmentId: entry.environmentId,
      label: entry.record?.label ?? null,
      httpBaseUrl: entry.record?.httpBaseUrl ?? null,
      wsBaseUrl: entry.record?.wsBaseUrl ?? null,
      connectionState: entry.runtime?.connectionState ?? null,
      authState: entry.runtime?.authState ?? null,
      role: entry.runtime?.role ?? null,
      lastError: entry.runtime?.lastError ?? null,
      lastErrorAt: entry.runtime?.lastErrorAt ?? null,
      connectedAt: entry.runtime?.connectedAt ?? null,
      disconnectedAt: entry.runtime?.disconnectedAt ?? null,
      pushSequence: entry.pushSequence,
    })),
    providers: input.providers.map((provider) => ({
      instanceId: provider.instanceId,
      driver: provider.driver,
      enabled: provider.enabled,
      installed: provider.installed,
      version: provider.version,
      status: provider.status,
      availability: provider.availability ?? "available",
      authStatus: provider.auth.status,
      authType: provider.auth.type ?? null,
      message: provider.message ?? null,
      unavailableReason: provider.unavailableReason ?? null,
      checkedAt: provider.checkedAt,
    })),
    observability: input.observability
      ? {
          logsDirectoryPath: input.observability.logsDirectoryPath,
          localTracingEnabled: input.observability.localTracingEnabled,
          otlpTracesEnabled: input.observability.otlpTracesEnabled,
          otlpMetricsEnabled: input.observability.otlpMetricsEnabled,
        }
      : null,
  };

  return redactSecrets(bundle);
}

export function serializeDiagnosticsBundle(bundle: DiagnosticsBundle): string {
  return JSON.stringify(bundle, null, 2);
}

export function hasPushSequenceGap(
  state: PushSequenceEnvironmentState | null | undefined,
): boolean {
  return (state?.gapCount ?? 0) > 0;
}
