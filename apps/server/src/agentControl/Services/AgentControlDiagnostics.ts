import type {
  AgentControlMcpDiagnosticsSummaryResult,
  AgentControlMcpOperationalReadInput,
  AgentControlMcpOrchestrationEventsResult,
  AgentControlMcpProviderRuntimeEventsResult,
  AgentControlMcpRecentActivityResult,
  ProjectId,
  ProviderInstanceId,
} from "@ryco/contracts";
import { Context } from "effect";
import type { Effect } from "effect";
import type { AgentControlDiagnosticsReadError } from "../Errors.ts";

export interface AgentControlDiagnosticsScope {
  readonly projectId: ProjectId;
  readonly providerInstanceId: ProviderInstanceId;
}

export interface AgentControlDiagnosticsShape {
  readonly recentActivity: (
    scope: AgentControlDiagnosticsScope,
    input: AgentControlMcpOperationalReadInput,
  ) => Effect.Effect<AgentControlMcpRecentActivityResult, AgentControlDiagnosticsReadError>;
  readonly orchestrationEvents: (
    scope: AgentControlDiagnosticsScope,
    input: AgentControlMcpOperationalReadInput,
  ) => Effect.Effect<AgentControlMcpOrchestrationEventsResult, AgentControlDiagnosticsReadError>;
  readonly providerRuntimeEvents: (
    scope: AgentControlDiagnosticsScope,
    input: AgentControlMcpOperationalReadInput,
  ) => Effect.Effect<AgentControlMcpProviderRuntimeEventsResult, AgentControlDiagnosticsReadError>;
  readonly summary: (
    scope: AgentControlDiagnosticsScope,
  ) => Effect.Effect<AgentControlMcpDiagnosticsSummaryResult, AgentControlDiagnosticsReadError>;
}

export class AgentControlDiagnosticsService extends Context.Service<
  AgentControlDiagnosticsService,
  AgentControlDiagnosticsShape
>()("ryco/agentControl/Services/AgentControlDiagnostics") {}
