import type { HubCapabilityCheck, HubCapabilityFailureReason } from "./hubCapability";
import { hubCapabilityFailureText } from "./hubCapability";
import {
  createHubProfile,
  normalizeHubOrigin,
  type HubOriginFailureReason,
  type HubProfile,
} from "./hubProfile";

export type HubProfileEditorResult =
  | { readonly status: "stale"; readonly generation: number }
  | {
      readonly status: "invalid";
      readonly generation: number;
      readonly reason: HubOriginFailureReason;
    }
  | {
      readonly status: "incompatible";
      readonly generation: number;
      readonly reason: HubCapabilityFailureReason;
    }
  | {
      readonly status: "compatible";
      readonly generation: number;
      readonly profile: HubProfile;
    };

export interface HubProfileEditor {
  readonly check: (draft: {
    readonly origin: string;
    readonly label: string;
  }) => Promise<HubProfileEditorResult>;
  readonly invalidate: () => void;
  readonly generation: () => number;
  readonly dispose: () => void;
}

export function hubOriginFailureText(reason: HubOriginFailureReason): string {
  switch (reason) {
    case "required":
      return "Enter the full Hub domain.";
    case "invalid-url":
    case "invalid-host":
      return "Enter a valid absolute Hub URL.";
    case "https-required":
      return "Hub domains must use HTTPS.";
    case "credentials-not-allowed":
      return "The Hub URL cannot contain a username or password.";
    case "origin-only":
      return "Use only the Hub origin, without a path, query, or fragment.";
    case "placeholder-host":
      return "Replace the placeholder with your real Hub domain.";
  }
}

export function hubProfileEditorFailureText(result: HubProfileEditorResult): string {
  if (result.status === "invalid") return hubOriginFailureText(result.reason);
  if (result.status === "incompatible") return hubCapabilityFailureText(result.reason);
  return "";
}

export function createHubProfileEditor(input: {
  readonly check: (origin: string, signal?: AbortSignal) => Promise<HubCapabilityCheck>;
  readonly allowInsecure: boolean;
}): HubProfileEditor {
  let currentGeneration = 0;
  let operation: AbortController | null = null;

  const invalidate = () => {
    currentGeneration += 1;
    operation?.abort();
    operation = null;
  };

  return {
    check: async (draft) => {
      operation?.abort();
      const generation = currentGeneration + 1;
      currentGeneration = generation;
      const controller = new AbortController();
      operation = controller;

      const normalized = normalizeHubOrigin(draft.origin, {
        allowInsecure: input.allowInsecure,
      });
      if (!normalized.ok) {
        if (operation === controller) operation = null;
        return { status: "invalid", generation, reason: normalized.reason };
      }

      const result = await input.check(normalized.origin, controller.signal);
      if (
        controller.signal.aborted ||
        currentGeneration !== generation ||
        operation !== controller
      ) {
        return { status: "stale", generation };
      }
      operation = null;
      if (result.status === "incompatible") {
        return { status: "incompatible", generation, reason: result.reason };
      }

      const profile = createHubProfile({
        origin: normalized.origin,
        label: draft.label || result.capability.relyingParty.displayName,
        allowInsecure: input.allowInsecure,
        compatibility: {
          status: "compatible",
          checkedAt: result.checkedAt,
          protocolVersion: result.capability.protocolVersion,
          handoffVersion: result.capability.nativeHandoff.version,
          relyingPartyId: result.capability.relyingParty.id,
        },
      });
      if (profile === null) {
        return { status: "invalid", generation, reason: "invalid-url" };
      }
      return { status: "compatible", generation, profile };
    },
    invalidate,
    generation: () => currentGeneration,
    dispose: invalidate,
  };
}
