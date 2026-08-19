import {
  AgentControlMcpInstallation,
  AgentControlMcpInstallationId,
  TrimmedNonEmptyString,
} from "@ryco/contracts";
import { Context, Schema } from "effect";
import type { Effect, Option } from "effect";

import type { AgentControlMcpInstallationRepositoryError } from "../Errors.ts";

export const AgentControlMcpInstallationFingerprint = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[a-f0-9]{64}$/),
);
export type AgentControlMcpInstallationFingerprint =
  typeof AgentControlMcpInstallationFingerprint.Type;

export const StoredAgentControlMcpInstallation = Schema.Struct({
  ...AgentControlMcpInstallation.fields,
  desiredFingerprint: Schema.NullOr(AgentControlMcpInstallationFingerprint),
  nativeFingerprint: Schema.NullOr(AgentControlMcpInstallationFingerprint),
});
export type StoredAgentControlMcpInstallation = typeof StoredAgentControlMcpInstallation.Type;

export interface AgentControlMcpInstallationRepositoryShape {
  readonly insert: (
    installation: StoredAgentControlMcpInstallation,
  ) => Effect.Effect<boolean, AgentControlMcpInstallationRepositoryError>;
  readonly get: (
    installationId: AgentControlMcpInstallationId,
  ) => Effect.Effect<
    Option.Option<StoredAgentControlMcpInstallation>,
    AgentControlMcpInstallationRepositoryError
  >;
  readonly list: () => Effect.Effect<
    ReadonlyArray<StoredAgentControlMcpInstallation>,
    AgentControlMcpInstallationRepositoryError
  >;
  readonly replace: (input: {
    readonly expectedRevision: number;
    readonly installation: StoredAgentControlMcpInstallation;
  }) => Effect.Effect<boolean, AgentControlMcpInstallationRepositoryError>;
}

export class AgentControlMcpInstallationRepository extends Context.Service<
  AgentControlMcpInstallationRepository,
  AgentControlMcpInstallationRepositoryShape
>()("ryco/persistence/Services/AgentControlMcpInstallation") {}
