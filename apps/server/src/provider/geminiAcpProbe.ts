import { spawn } from "node:child_process";
import * as readline from "node:readline";

import type {
  ModelCapabilities,
  ServerProviderAuthStatus,
  ServerProviderModel,
  ServerProviderState,
} from "@ryco/contracts";
import { DEFAULT_GEMINI_MODEL_CAPABILITIES, geminiCapabilitiesForModel } from "@ryco/shared/model";
import { Data, Effect } from "effect";

import { asNumber, asRecord, trimToUndefined } from "./geminiValue.ts";

const GEMINI_ACP_PROBE_TIMEOUT_MS = 30_000;
const GEMINI_ACP_AUTH_REQUIRED_CODE = -32_000;
const MAX_CAPTURED_LOG_LINES = 5;
const MAX_CAPTURED_LOG_LENGTH = 240;

export class GeminiAcpProbeUnexpectedError extends Data.TaggedError(
  "GeminiAcpProbeUnexpectedError",
)<{
  readonly detail: string;
  readonly cause: unknown;
}> {}

export type GeminiCapabilityProbeResult = {
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly status: Exclude<ServerProviderState, "disabled">;
  readonly auth: { readonly status: ServerProviderAuthStatus };
  readonly message?: string;
};

function truncateLogLine(line: string): string {
  return line.length > MAX_CAPTURED_LOG_LENGTH
    ? `${line.slice(0, MAX_CAPTURED_LOG_LENGTH - 3)}...`
    : line;
}

function pushLogLine(target: string[], line: string): void {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("{")) {
    return;
  }

  target.push(truncateLogLine(trimmed));
  if (target.length > MAX_CAPTURED_LOG_LINES) {
    target.shift();
  }
}

function formatGeminiDiscoveryWarning(detail: string): string {
  return `Gemini CLI is installed, but Ryco could not verify authentication or discover models. ${detail}`;
}

function formatGeminiAuthMessage(detail: string): string {
  return `Gemini is not authenticated. ${detail}`;
}

function formatGeminiModelDiscoveryFallbackMessage(): string {
  return "Gemini CLI is installed and authenticated, but it did not report any available models. Ryco will use its built-in Gemini model list.";
}

function detailFromProbeLogs(
  stdoutLines: ReadonlyArray<string>,
  stderrLines: ReadonlyArray<string>,
) {
  return stderrLines[stderrLines.length - 1] ?? stdoutLines[stdoutLines.length - 1];
}

export function parseGeminiAcpProbeError(
  error: unknown,
): Omit<GeminiCapabilityProbeResult, "models"> {
  const record = asRecord(error);
  const code = asNumber(record?.code);
  const message = trimToUndefined(record?.message) ?? "Gemini ACP request failed.";
  const lowerMessage = message.toLowerCase();
  const unauthenticated =
    code === GEMINI_ACP_AUTH_REQUIRED_CODE ||
    lowerMessage.includes("authentication required") ||
    lowerMessage.includes("api key is missing") ||
    lowerMessage.includes("auth method") ||
    lowerMessage.includes("not configured");

  if (unauthenticated) {
    return {
      status: "error",
      auth: { status: "unauthenticated" },
      message: formatGeminiAuthMessage(message),
    };
  }

  return {
    status: "warning",
    auth: { status: "unknown" },
    message: formatGeminiDiscoveryWarning(message),
  };
}

export function normalizeGeminiCapabilityProbeResult(
  result: GeminiCapabilityProbeResult,
): GeminiCapabilityProbeResult {
  if (result.auth.status === "authenticated" && result.models.length === 0) {
    return {
      ...result,
      status: "ready",
      message: formatGeminiModelDiscoveryFallbackMessage(),
    };
  }

  return result;
}

export function parseGeminiDiscoveredModels(
  response: unknown,
  fallbackCapabilities: ModelCapabilities = DEFAULT_GEMINI_MODEL_CAPABILITIES,
): ReadonlyArray<ServerProviderModel> {
  const availableModels = asRecord(asRecord(response)?.models)?.availableModels;
  if (!Array.isArray(availableModels)) {
    return [];
  }

  const discoveredModels: ServerProviderModel[] = [];
  const seen = new Set<string>();

  for (const candidate of availableModels) {
    const record = asRecord(candidate);
    const slug = trimToUndefined(record?.modelId);
    if (!slug || seen.has(slug)) {
      continue;
    }

    seen.add(slug);
    discoveredModels.push({
      slug,
      name: trimToUndefined(record?.name) ?? slug,
      isCustom: false,
      capabilities: geminiCapabilitiesForModel(slug, fallbackCapabilities),
    });
  }

  return discoveredModels;
}

export const probeGeminiCapabilities = (input: {
  readonly binaryPath: string;
  readonly cwd: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly capabilities?: ModelCapabilities;
}) =>
  Effect.tryPromise({
    try: () =>
      new Promise<GeminiCapabilityProbeResult>((resolve) => {
        const child = spawn(input.binaryPath, ["--acp"], {
          cwd: input.cwd,
          ...(input.environment ? { env: { ...process.env, ...input.environment } } : {}),
          shell: process.platform === "win32",
          stdio: ["pipe", "pipe", "pipe"],
        });

        if (!child.stdin || !child.stdout || !child.stderr) {
          child.kill();
          resolve({
            status: "warning",
            auth: { status: "unknown" },
            models: [],
            message: formatGeminiDiscoveryWarning(
              "Gemini ACP did not expose the expected stdio streams.",
            ),
          });
          return;
        }

        const stdoutLines: string[] = [];
        const stderrLines: string[] = [];
        const stdoutReader = readline.createInterface({ input: child.stdout });
        const stderrReader = readline.createInterface({ input: child.stderr });

        let settled = false;
        let sessionNewRequested = false;
        let timeout: ReturnType<typeof setTimeout> | undefined;

        const cleanup = () => {
          if (timeout) {
            clearTimeout(timeout);
          }
          stdoutReader.removeAllListeners();
          stderrReader.removeAllListeners();
          child.removeAllListeners();
          stdoutReader.close();
          stderrReader.close();
        };

        const terminate = (gracefulClosePayload?: string) => {
          if (gracefulClosePayload && child.stdin?.writable) {
            child.stdin.write(gracefulClosePayload);
            child.stdin.end();
            const delayedKill = setTimeout(() => {
              if (!child.killed) {
                child.kill();
              }
            }, 150);
            delayedKill.unref?.();
            return;
          }

          if (child.stdin?.writable) {
            child.stdin.end();
          }
          if (!child.killed) {
            child.kill();
          }
        };

        const finalize = (
          result: GeminiCapabilityProbeResult,
          options?: { readonly sessionId?: string },
        ) => {
          if (settled) {
            return;
          }

          settled = true;
          cleanup();
          const closePayload =
            options?.sessionId && options.sessionId.length > 0
              ? `${JSON.stringify({
                  jsonrpc: "2.0",
                  id: 3,
                  method: "session/close",
                  params: { sessionId: options.sessionId },
                })}\n`
              : undefined;
          terminate(closePayload);
          resolve(result);
        };

        const sendRequest = (id: number, method: string, params: Record<string, unknown>) => {
          if (!child.stdin?.writable) {
            finalize({
              status: "warning",
              auth: { status: "unknown" },
              models: [],
              message: formatGeminiDiscoveryWarning("Gemini ACP stdin is not writable."),
            });
            return;
          }

          child.stdin.write(
            `${JSON.stringify({
              jsonrpc: "2.0",
              id,
              method,
              params,
            })}\n`,
          );
        };

        timeout = setTimeout(() => {
          const detail = detailFromProbeLogs(stdoutLines, stderrLines);
          finalize({
            status: "warning",
            auth: { status: "unknown" },
            models: [],
            message: formatGeminiDiscoveryWarning(
              detail
                ? `Timed out while starting Gemini ACP session. Last output: ${detail}`
                : "Timed out while starting Gemini ACP session.",
            ),
          });
        }, GEMINI_ACP_PROBE_TIMEOUT_MS);

        stdoutReader.on("line", (line) => {
          pushLogLine(stdoutLines, line);

          const trimmed = line.trim();
          if (!trimmed.startsWith("{")) {
            return;
          }

          let parsed: Record<string, unknown> | undefined;
          try {
            parsed = asRecord(JSON.parse(trimmed));
          } catch {
            return;
          }

          if (!parsed) {
            return;
          }

          const id = asNumber(parsed.id);
          if (id === 1) {
            const error = asRecord(parsed.error);
            if (error) {
              finalize({
                ...parseGeminiAcpProbeError(error),
                models: [],
              });
              return;
            }

            if (!sessionNewRequested) {
              sessionNewRequested = true;
              sendRequest(2, "session/new", {
                cwd: input.cwd,
                mcpServers: [],
              });
            }
            return;
          }

          if (id !== 2) {
            return;
          }

          const error = asRecord(parsed.error);
          if (error) {
            finalize({
              ...parseGeminiAcpProbeError(error),
              models: [],
            });
            return;
          }

          const result = parsed.result;
          const models = parseGeminiDiscoveredModels(
            result,
            input.capabilities ?? DEFAULT_GEMINI_MODEL_CAPABILITIES,
          );

          finalize(
            normalizeGeminiCapabilityProbeResult({
              status: "ready",
              auth: { status: "authenticated" },
              models,
              ...(models.length > 0
                ? { message: "Gemini CLI is installed and authenticated." }
                : {}),
            }),
            (() => {
              const sessionId = trimToUndefined(asRecord(result)?.sessionId);
              return sessionId ? { sessionId } : undefined;
            })(),
          );
        });

        stderrReader.on("line", (line) => {
          pushLogLine(stderrLines, line);
        });

        child.once("error", (error) => {
          finalize({
            status: "warning",
            auth: { status: "unknown" },
            models: [],
            message: formatGeminiDiscoveryWarning(
              error.message.length > 0 ? error.message : "Failed to start Gemini ACP session.",
            ),
          });
        });

        child.once("exit", (code, signal) => {
          if (settled) {
            return;
          }

          const detail = detailFromProbeLogs(stdoutLines, stderrLines);
          const exitMessage =
            detail ??
            `Gemini ACP exited before responding (code ${code ?? "null"}${signal ? `, signal ${signal}` : ""}).`;
          finalize({
            status: "warning",
            auth: { status: "unknown" },
            models: [],
            message: formatGeminiDiscoveryWarning(exitMessage),
          });
        });

        sendRequest(1, "initialize", {
          protocolVersion: 1,
          clientInfo: {
            name: "ryco",
            title: "Ryco",
            version: "0.1.0",
          },
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
            auth: { terminal: false },
          },
        });
      }),
    catch: (cause) =>
      new GeminiAcpProbeUnexpectedError({
        detail: cause instanceof Error ? cause.message : "Unexpected Gemini ACP probe failure.",
        cause,
      }),
  });
