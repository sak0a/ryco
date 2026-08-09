import type {
  EnvironmentId,
  PullRequestId,
  PullRequestIdentity,
  SourceControlProviderKind,
} from "@ryco/contracts";
import { decode, encode, rfc8949EncodeOptions } from "cborg";

export const PULL_REQUEST_IDENTITY_VERSION = 1 as const;

export interface PullRequestIdentityInput {
  readonly environmentId: EnvironmentId | string;
  readonly provider: SourceControlProviderKind;
  readonly host: string;
  readonly repositoryPath: string;
  readonly number: number;
}

export class PullRequestIdentityError extends Error {
  readonly code = "invalid_pull_request_identity" as const;

  constructor(message = "Pull request identity is invalid.") {
    super(message);
    this.name = "PullRequestIdentityError";
  }
}

const PROVIDERS = new Set<SourceControlProviderKind>([
  "github",
  "gitlab",
  "forgejo",
  "azure-devops",
  "bitbucket",
  "unknown",
]);

export function normalizePullRequestHost(value: string): string {
  const candidate = value.trim().toLowerCase().replace(/\.$/, "");
  if (candidate.length === 0 || candidate.includes("/") || candidate.includes("@")) {
    throw new PullRequestIdentityError("Provider host must not contain a scheme, path, or user.");
  }
  let parsed: URL;
  try {
    parsed = new URL(`https://${candidate}`);
  } catch {
    throw new PullRequestIdentityError("Provider host is malformed.");
  }
  if (parsed.hostname.length === 0 || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new PullRequestIdentityError("Provider host is malformed.");
  }
  return parsed.host.toLowerCase();
}

export function normalizePullRequestRepositoryPath(value: string): string {
  const withoutSuffix = value
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "");
  const segments = withoutSuffix.split("/").map((segment) => segment.trim());
  if (
    segments.length < 2 ||
    segments.some(
      (segment) =>
        segment.length === 0 || segment === "." || segment === ".." || /[?#\\\s]/.test(segment),
    )
  ) {
    throw new PullRequestIdentityError("Repository path must contain owner and repository.");
  }
  return segments.join("/").toLowerCase();
}

function normalizeInput(input: PullRequestIdentityInput) {
  const environmentId = String(input.environmentId).trim();
  if (environmentId.length === 0 || !PROVIDERS.has(input.provider)) {
    throw new PullRequestIdentityError();
  }
  if (!Number.isSafeInteger(input.number) || input.number < 1) {
    throw new PullRequestIdentityError("Pull request number must be a positive safe integer.");
  }
  return {
    environmentId,
    provider: input.provider,
    host: normalizePullRequestHost(input.host),
    repositoryPath: normalizePullRequestRepositoryPath(input.repositoryPath),
    number: input.number,
  };
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new PullRequestIdentityError();
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function encodePullRequestId(input: PullRequestIdentityInput): PullRequestId {
  const normalized = normalizeInput(input);
  const bytes = encode(
    [
      PULL_REQUEST_IDENTITY_VERSION,
      normalized.environmentId,
      normalized.provider,
      normalized.host,
      normalized.repositoryPath,
      normalized.number,
    ],
    rfc8949EncodeOptions,
  );
  return `pr_${encodeBase64Url(bytes)}` as PullRequestId;
}

export function decodePullRequestId(id: PullRequestId | string): PullRequestIdentity {
  if (!id.startsWith("pr_") || id.includes("=")) throw new PullRequestIdentityError();
  let decoded: unknown;
  try {
    decoded = decode(decodeBase64Url(id.slice(3)));
  } catch {
    throw new PullRequestIdentityError();
  }
  if (!Array.isArray(decoded) || decoded.length !== 6 || decoded[0] !== 1) {
    throw new PullRequestIdentityError();
  }
  const [, environmentId, provider, host, repositoryPath, number] = decoded;
  if (
    typeof environmentId !== "string" ||
    typeof provider !== "string" ||
    !PROVIDERS.has(provider as SourceControlProviderKind) ||
    typeof host !== "string" ||
    typeof repositoryPath !== "string" ||
    typeof number !== "number"
  ) {
    throw new PullRequestIdentityError();
  }
  const normalized = normalizeInput({
    environmentId,
    provider: provider as SourceControlProviderKind,
    host,
    repositoryPath,
    number,
  });
  const canonical = encodePullRequestId(normalized);
  if (canonical !== id) throw new PullRequestIdentityError("Pull request id is not canonical.");
  return {
    id: canonical,
    environmentId: normalized.environmentId as EnvironmentId,
    provider: normalized.provider,
    host: normalized.host,
    repositoryPath: normalized.repositoryPath,
    number: normalized.number,
  };
}
