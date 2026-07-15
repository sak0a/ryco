import {
  canonicalizeHubOrigin,
  encodeNodeAuthenticationTranscript,
} from "@ryco/shared/nodeIdentity";
import type { RelayNodeAuthHandshake } from "@ryco/contracts/relay";

import type { LocalHubIdentityStateStore } from "./LocalHubIdentityState.ts";
import type { NodeSigningIdentity } from "./NodeSigningIdentity.ts";

export interface HubNodeChallenge {
  readonly protocolMajor: number;
  readonly protocolMinor: number;
  readonly challenge: Uint8Array;
  readonly challengeExpiresAt: number;
}

export interface HubNodeChallengeTransport {
  readonly request: (input: {
    readonly hubOrigin: string;
    readonly nodeId: string;
    readonly activeKeyId: string;
    readonly protocolMajor: number;
    readonly protocolMinor: number;
  }) => Promise<HubNodeChallenge>;
}

export interface NodeAuthenticationKeySelector {
  readonly authenticationKey: (hubOrigin: string) => Promise<{
    readonly keyId: string;
    readonly secretName: string;
  }>;
}

export type NodeRelayAuthenticationFrame = RelayNodeAuthHandshake;

export class HubNodeProofClientError extends Error {
  readonly code = "node_proof_failed" as const;

  constructor() {
    super("Hub node proof operation failed.");
    this.name = "HubNodeProofClientError";
  }
}

export interface HubNodeProofClient {
  readonly createRelayAuthenticationFrame: (
    hubOrigin: string,
    protocol: { readonly protocolMajor: number; readonly protocolMinor: number },
  ) => Promise<NodeRelayAuthenticationFrame>;
}

function proofError(): never {
  throw new HubNodeProofClientError();
}

function validateChallenge(
  value: HubNodeChallenge,
  requested: { readonly protocolMajor: number; readonly protocolMinor: number },
  now: number,
): HubNodeChallenge {
  if (
    value.protocolMajor !== requested.protocolMajor ||
    value.protocolMinor !== requested.protocolMinor ||
    !(value.challenge instanceof Uint8Array) ||
    value.challenge.byteLength !== 32 ||
    !Number.isSafeInteger(value.challengeExpiresAt) ||
    value.challengeExpiresAt <= now ||
    value.challengeExpiresAt > now + 60_000
  ) {
    return proofError();
  }
  return { ...value, challenge: Uint8Array.from(value.challenge) };
}

export function makeHubNodeProofClient(dependencies: {
  readonly transport: HubNodeChallengeTransport;
  readonly stateStore: LocalHubIdentityStateStore;
  readonly signingIdentity: NodeSigningIdentity;
  readonly keySelector: NodeAuthenticationKeySelector;
  readonly now?: () => number;
}): HubNodeProofClient {
  const now = dependencies.now ?? Date.now;
  return {
    createRelayAuthenticationFrame: async (rawHubOrigin, protocol) => {
      let hubOrigin: string;
      try {
        hubOrigin = canonicalizeHubOrigin(rawHubOrigin);
      } catch {
        return proofError();
      }
      if (
        !Number.isSafeInteger(protocol.protocolMajor) ||
        protocol.protocolMajor < 0 ||
        protocol.protocolMajor > 65_535 ||
        !Number.isSafeInteger(protocol.protocolMinor) ||
        protocol.protocolMinor < 0 ||
        protocol.protocolMinor > 65_535
      ) {
        return proofError();
      }
      const state = await dependencies.stateStore.readOrCreate();
      const active = state.activeNode;
      if (active === null || active.hubOrigin !== hubOrigin) return proofError();
      const selected = await dependencies.keySelector.authenticationKey(hubOrigin);
      let challenge: HubNodeChallenge;
      try {
        challenge = validateChallenge(
          await dependencies.transport.request({
            hubOrigin,
            nodeId: active.nodeId,
            activeKeyId: selected.keyId,
            ...protocol,
          }),
          protocol,
          now(),
        );
      } catch {
        return proofError();
      }
      const transcript = encodeNodeAuthenticationTranscript({
        hubOrigin,
        ...protocol,
        nodeId: active.nodeId,
        activeKeyId: selected.keyId,
        challengeExpiresAt: challenge.challengeExpiresAt,
        challenge: challenge.challenge,
      });
      try {
        const signature = await dependencies.signingIdentity.sign(selected.secretName, transcript);
        return {
          type: "auth",
          peer: "node",
          ...protocol,
          nodeId: active.nodeId as RelayNodeAuthHandshake["nodeId"],
          nonce: Uint8Array.from(challenge.challenge),
          signature,
        };
      } catch {
        return proofError();
      } finally {
        challenge.challenge.fill(0);
        transcript.fill(0);
      }
    },
  };
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

async function readBoundedResponseText(response: Response): Promise<string> {
  if (response.body === null) return proofError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > 16 * 1024) return proofError();
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    total,
  ).toString("utf8");
}

export function makeHubNodeChallengeHttpTransport(
  fetchImplementation: FetchLike = fetch,
): HubNodeChallengeTransport {
  return {
    request: async (input) => {
      let response: Response;
      try {
        response = await fetchImplementation(
          `${canonicalizeHubOrigin(input.hubOrigin)}/api/node/auth/challenges`,
          {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify({
              nodeId: input.nodeId,
              activeKeyId: input.activeKeyId,
              protocolMajor: input.protocolMajor,
              protocolMinor: input.protocolMinor,
            }),
            credentials: "omit",
            cache: "no-store",
            redirect: "error",
            referrerPolicy: "no-referrer",
          },
        );
      } catch {
        return proofError();
      }
      const declaredHeader = response.headers.get("content-length");
      if (declaredHeader !== null) {
        const declared = Number(declaredHeader);
        if (!Number.isSafeInteger(declared) || declared < 0 || declared > 16 * 1024) {
          return proofError();
        }
      }
      if (!response.ok) return proofError();
      let value: unknown;
      try {
        const text = await readBoundedResponseText(response);
        value = JSON.parse(text) as unknown;
      } catch {
        return proofError();
      }
      if (typeof value !== "object" || value === null) return proofError();
      const candidate = value as Record<string, unknown>;
      if (
        typeof candidate.protocolMajor !== "number" ||
        typeof candidate.protocolMinor !== "number" ||
        typeof candidate.challengeExpiresAt !== "number" ||
        typeof candidate.challenge !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(candidate.challenge)
      ) {
        return proofError();
      }
      const challenge = Buffer.from(candidate.challenge, "base64url");
      if (challenge.byteLength !== 32 || challenge.toString("base64url") !== candidate.challenge) {
        return proofError();
      }
      return {
        protocolMajor: candidate.protocolMajor,
        protocolMinor: candidate.protocolMinor,
        challenge: Uint8Array.from(challenge),
        challengeExpiresAt: candidate.challengeExpiresAt,
      };
    },
  };
}
