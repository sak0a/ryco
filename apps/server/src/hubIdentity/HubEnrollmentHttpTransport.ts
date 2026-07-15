import { canonicalizeHubOrigin } from "@ryco/shared/nodeIdentity";

import type {
  HubEnrollmentPollResponse,
  HubEnrollmentStartRequest,
  HubEnrollmentStartResponse,
  HubEnrollmentTransport,
} from "./HubEnrollmentClient.ts";

export class HubEnrollmentHttpTransportError extends Error {
  readonly code = "enrollment_transport_failed" as const;

  constructor() {
    super("Hub enrollment transport failed.");
    this.name = "HubEnrollmentHttpTransportError";
  }
}

const MAX_RESPONSE_BYTES = 16 * 1024;
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

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_RESPONSE_BYTES) {
      return transportError();
    }
  }
  if (response.body === null) return transportError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) return transportError();
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    total,
  ).toString("utf8");
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return transportError();
  }
}

function jsonRequest(body: unknown): Omit<RequestInit, "signal"> {
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
  if (candidate.status === "unavailable") return { status: "unavailable" };
  return transportError();
}

export function makeHubEnrollmentHttpTransport(
  fetchImplementation: FetchLike = fetch,
): HubEnrollmentTransport {
  const request = async (url: string, body: unknown): Promise<Response> => {
    try {
      return await fetchImplementation(url, jsonRequest(body));
    } catch {
      return transportError();
    }
  };

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
      return parseStartResponse(await readBoundedJson(response));
    },
    poll: async ({ hubOrigin: rawHubOrigin, pollingSecret }) => {
      const hubOrigin = canonicalizeHubOrigin(rawHubOrigin);
      const response = await request(`${hubOrigin}/api/node/enrollments/poll`, {
        pollingSecret: Buffer.from(pollingSecret).toString("base64url"),
      });
      if (response.status === 404 || response.status === 410) return { status: "unavailable" };
      if (!response.ok) return transportError();
      return parsePollResponse(await readBoundedJson(response));
    },
  };
}
