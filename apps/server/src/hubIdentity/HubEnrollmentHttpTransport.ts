import { canonicalizeHubOrigin } from "@ryco/shared/nodeIdentity";

import type {
  HubEnrollmentPollResponse,
  HubEnrollmentStartRequest,
  HubEnrollmentStartResponse,
  HubEnrollmentTransport,
} from "./HubEnrollmentClient.ts";
import { fetchBoundedJson } from "./BoundedHttp.ts";

export class HubEnrollmentHttpTransportError extends Error {
  readonly code = "enrollment_transport_failed" as const;

  constructor() {
    super("Hub enrollment transport failed.");
    this.name = "HubEnrollmentHttpTransportError";
  }
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function transportError(): never {
  throw new HubEnrollmentHttpTransportError();
}

function decodeBase64Url32(value: unknown): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) return transportError();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength !== 32 || decoded.toString("base64url") !== value) return transportError();
  return Uint8Array.from(decoded);
}

function jsonRequest(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
  };
}

function parseStartResponse(value: unknown): HubEnrollmentStartResponse {
  if (typeof value !== "object" || value === null) return transportError();
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.deviceCode !== "string" ||
    typeof candidate.expiresAt !== "number" ||
    typeof candidate.pollIntervalMs !== "number"
  ) {
    return transportError();
  }
  return {
    deviceCode: candidate.deviceCode,
    pollingSecret: decodeBase64Url32(candidate.pollingSecret),
    expiresAt: candidate.expiresAt,
    pollIntervalMs: candidate.pollIntervalMs,
  };
}

function parsePollResponse(value: unknown): HubEnrollmentPollResponse {
  if (typeof value !== "object" || value === null) return transportError();
  const candidate = value as Record<string, unknown>;
  if (candidate.status === "pending" && typeof candidate.retryAfterMs === "number") {
    return { status: "pending", retryAfterMs: candidate.retryAfterMs };
  }
  if (
    candidate.status === "approved" &&
    typeof candidate.nodeId === "string" &&
    typeof candidate.environmentId === "string" &&
    typeof candidate.activeKeyId === "string" &&
    typeof candidate.enrolledAt === "number"
  ) {
    return {
      status: "approved",
      nodeId: candidate.nodeId,
      environmentId: candidate.environmentId,
      activeKeyId: candidate.activeKeyId,
      enrolledAt: candidate.enrolledAt,
    };
  }
  if (candidate.status === "unavailable") return { status: "unavailable", reason: "rejected" };
  return transportError();
}

export function makeHubEnrollmentHttpTransport(
  fetchImplementation: FetchLike = fetch,
  options: { readonly timeoutMs?: number } = {},
): HubEnrollmentTransport {
  const request = (url: string, body: unknown) =>
    fetchBoundedJson(fetchImplementation, url, jsonRequest(body), transportError, options);

  return {
    start: async (input: HubEnrollmentStartRequest) => {
      const hubOrigin = canonicalizeHubOrigin(input.hubOrigin);
      const response = await request(`${hubOrigin}/api/node/enrollments`, {
        environmentId: input.environmentId,
        label: input.label,
        platformOs: input.platformOs,
        platformArch: input.platformArch,
        clientVersion: input.clientVersion,
        algorithm: input.publicKey.algorithm,
        publicKey: Buffer.from(input.publicKey.publicKey).toString("base64url"),
      });
      if (!response.ok) return transportError();
      return parseStartResponse(response.value);
    },
    poll: async ({ hubOrigin: rawHubOrigin, pollingSecret }) => {
      const hubOrigin = canonicalizeHubOrigin(rawHubOrigin);
      const response = await request(`${hubOrigin}/api/node/enrollments/poll`, {
        pollingSecret: Buffer.from(pollingSecret).toString("base64url"),
      });
      if (response.status === 404 || response.status === 410) {
        const candidate = response.value as { readonly error?: unknown };
        if (candidate?.error === "enrollment_unavailable")
          return { status: "unavailable", reason: "rejected" };
        return transportError();
      }
      if (!response.ok) return transportError();
      return parsePollResponse(response.value);
    },
  };
}
