import { canonicalizeHubOrigin } from "@ryco/shared/nodeIdentity";

import type {
  HubKeyRotationChallenge,
  HubKeyRotationStatus,
  HubKeyRotationTransport,
} from "./HubKeyRotationClient.ts";

export class HubKeyRotationHttpTransportError extends Error {
  readonly code = "rotation_transport_failed" as const;

  constructor() {
    super("Hub key rotation transport failed.");
    this.name = "HubKeyRotationHttpTransportError";
  }
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const MAX_RESPONSE_BYTES = 16 * 1024;

function transportError(): never {
  throw new HubKeyRotationHttpTransportError();
}

async function boundedJson(response: Response): Promise<Record<string, unknown>> {
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
  try {
    const value = JSON.parse(
      Buffer.concat(
        chunks.map((chunk) => Buffer.from(chunk)),
        total,
      ).toString("utf8"),
    ) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return transportError();
    return value as Record<string, unknown>;
  } catch {
    return transportError();
  }
}

function parseStatus(value: Record<string, unknown>): HubKeyRotationStatus {
  if (value.status === "proof_required") return { status: "proof_required" };
  if (value.status === "awaiting_owner") return { status: "awaiting_owner" };
  if (value.status === "rejected") return { status: "rejected" };
  if (value.status === "activated" && typeof value.activatedAt === "number") {
    return { status: "activated", activatedAt: value.activatedAt };
  }
  return transportError();
}

function parseChallenge(value: Record<string, unknown>): HubKeyRotationChallenge {
  if (
    typeof value.rotationRequestId !== "string" ||
    typeof value.newKeyId !== "string" ||
    typeof value.protocolMajor !== "number" ||
    typeof value.protocolMinor !== "number" ||
    typeof value.challengeExpiresAt !== "number" ||
    typeof value.challenge !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.challenge)
  ) {
    return transportError();
  }
  const challenge = Buffer.from(value.challenge, "base64url");
  if (challenge.byteLength !== 32 || challenge.toString("base64url") !== value.challenge) {
    return transportError();
  }
  return {
    rotationRequestId: value.rotationRequestId,
    newKeyId: value.newKeyId,
    protocolMajor: value.protocolMajor,
    protocolMinor: value.protocolMinor,
    challenge: Uint8Array.from(challenge),
    challengeExpiresAt: value.challengeExpiresAt,
  };
}

export function makeHubKeyRotationHttpTransport(
  fetchImplementation: FetchLike = fetch,
): HubKeyRotationTransport {
  const post = async (hubOrigin: string, path: string, body: unknown): Promise<Response> => {
    let response: Response;
    try {
      response = await fetchImplementation(`${canonicalizeHubOrigin(hubOrigin)}${path}`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(body),
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
    } catch {
      return transportError();
    }
    if (!response.ok) return transportError();
    return response;
  };

  return {
    begin: async (request) =>
      parseChallenge(
        await boundedJson(
          await post(request.hubOrigin, "/api/node/key-rotations", {
            nodeId: request.nodeId,
            oldActiveKeyId: request.oldActiveKeyId,
            algorithm: request.newKey.algorithm,
            publicKey: Buffer.from(request.newKey.publicKey).toString("base64url"),
            ...(request.existingRotationRequestId === undefined
              ? {}
              : { rotationRequestId: request.existingRotationRequestId }),
          }),
        ),
      ),
    prove: async (request) =>
      parseStatus(
        await boundedJson(
          await post(request.hubOrigin, "/api/node/key-rotations/prove", {
            rotationRequestId: request.rotationRequestId,
            challenge: Buffer.from(request.challenge).toString("base64url"),
            signature: Buffer.from(request.signature).toString("base64url"),
          }),
        ),
      ),
    status: async (request) =>
      parseStatus(
        await boundedJson(
          await post(request.hubOrigin, "/api/node/key-rotations/status", {
            rotationRequestId: request.rotationRequestId,
          }),
        ),
      ),
  };
}
