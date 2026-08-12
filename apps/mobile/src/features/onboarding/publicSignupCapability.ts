import type { HttpClientService } from "@ryco/client-runtime/platform";
import {
  PUBLIC_SIGNUP_CONFIG_PATH,
  PublicSignupConfigResponse,
} from "@ryco/contracts/hosted-identity";
import { Schema } from "effect";

import { normalizeHubOrigin } from "../../hostedHub/hubProfile";

const MAX_PUBLIC_SIGNUP_CONFIG_BYTES = 4_096;

export type PublicSignupCapabilityCheck =
  | { readonly status: "enabled"; readonly checkedAt: number }
  | { readonly status: "disabled"; readonly checkedAt: number }
  | {
      readonly status: "unreachable";
      readonly checkedAt: number;
      readonly reason: "invalid-response" | "unreachable";
    };

export type PublicSignupCapabilityProbeResult =
  | { readonly status: "stale"; readonly generation: number }
  | ({ readonly generation: number } & PublicSignupCapabilityCheck);

export function createPublicSignupCapabilityClient(
  httpClient: HttpClientService,
  now: () => number = Date.now,
): {
  readonly check: (origin: string, signal?: AbortSignal) => Promise<PublicSignupCapabilityCheck>;
} {
  return {
    check: async (origin, signal) => {
      const checkedAt = now();
      const normalized = normalizeHubOrigin(origin, { allowInsecure: true });
      if (!normalized.ok) {
        return { status: "unreachable", checkedAt, reason: "invalid-response" };
      }

      let response: Awaited<ReturnType<HttpClientService["fetch"]>>;
      try {
        response = await httpClient.fetch(
          new URL(PUBLIC_SIGNUP_CONFIG_PATH, normalized.origin).toString(),
          {
            method: "GET",
            headers: { Accept: "application/json" },
            credentials: "omit",
            cache: "no-store",
            ...(signal ? { signal } : {}),
          },
        );
      } catch {
        return { status: "unreachable", checkedAt, reason: "unreachable" };
      }
      if (!response.ok) {
        return { status: "unreachable", checkedAt, reason: "unreachable" };
      }

      let body: string;
      try {
        body = await response.text();
      } catch {
        return { status: "unreachable", checkedAt, reason: "invalid-response" };
      }
      if (body.length === 0 || body.length > MAX_PUBLIC_SIGNUP_CONFIG_BYTES) {
        return { status: "unreachable", checkedAt, reason: "invalid-response" };
      }

      let decoded: typeof PublicSignupConfigResponse.Type;
      try {
        decoded = Schema.decodeUnknownSync(PublicSignupConfigResponse)(JSON.parse(body), {
          onExcessProperty: "error",
        });
      } catch {
        return { status: "unreachable", checkedAt, reason: "invalid-response" };
      }
      return { status: decoded.status, checkedAt };
    },
  };
}

export function createPublicSignupCapabilityProbe(input: {
  readonly check: (origin: string, signal?: AbortSignal) => Promise<PublicSignupCapabilityCheck>;
}): {
  readonly check: (origin: string) => Promise<PublicSignupCapabilityProbeResult>;
  readonly invalidate: () => void;
  readonly dispose: () => void;
} {
  let generation = 0;
  let operation: AbortController | null = null;
  const invalidate = () => {
    generation += 1;
    operation?.abort();
    operation = null;
  };
  return {
    check: async (origin) => {
      operation?.abort();
      const currentGeneration = generation + 1;
      generation = currentGeneration;
      const controller = new AbortController();
      operation = controller;
      const result = await input.check(origin, controller.signal);
      if (
        controller.signal.aborted ||
        generation !== currentGeneration ||
        operation !== controller
      ) {
        return { status: "stale", generation: currentGeneration };
      }
      operation = null;
      return { ...result, generation: currentGeneration };
    },
    invalidate,
    dispose: invalidate,
  };
}
