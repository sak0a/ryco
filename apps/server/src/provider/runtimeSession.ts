import type {
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderRuntimeEvent,
  ProviderSessionStartInput,
  RuntimeSessionId,
} from "@ryco/contracts";
import { Effect } from "effect";

import { ProviderAdapterValidationError } from "./Errors.ts";

export function requireRuntimeSessionId(
  provider: ProviderDriverKind,
  input: Pick<ProviderSessionStartInput, "runtimeSessionId">,
): Effect.Effect<RuntimeSessionId, ProviderAdapterValidationError> {
  return input.runtimeSessionId !== undefined
    ? Effect.succeed(input.runtimeSessionId)
    : Effect.fail(
        new ProviderAdapterValidationError({
          provider,
          operation: "startSession",
          issue: "runtimeSessionId is required for new provider sessions.",
        }),
      );
}

export function stampRuntimeEvent(
  event: ProviderRuntimeEvent,
  input: {
    readonly providerInstanceId: ProviderInstanceId;
    readonly runtimeSessionId: RuntimeSessionId;
  },
): ProviderRuntimeEvent {
  return {
    ...event,
    providerInstanceId: input.providerInstanceId,
    runtimeSessionId: input.runtimeSessionId,
  };
}
