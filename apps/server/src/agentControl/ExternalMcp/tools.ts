import {
  AGENT_CONTROL_CAPABILITIES,
  AGENT_CONTROL_EXTERNAL_MCP_TOOL_NAMES,
  AGENT_CONTROL_EXTERNAL_MCP_TOOLS,
  AGENT_CONTROL_MCP_MODELS_PER_INSTANCE_MAX,
  AgentControlExternalCapabilitiesResult,
  AgentControlExternalCreateTaskInput,
  AgentControlExternalOverviewResult,
  AgentControlExternalTaskIdInput,
  AgentControlExternalWaitForTaskInput,
  AgentControlMcpListProjectsInput,
  AgentControlMcpListProjectsResult,
  AgentControlIntegrationId,
  type AgentControlExternalIntegration,
  type AgentControlMcpProviderInstanceSummary,
  type ServerProvider,
} from "@ryco/contracts";
import { Effect, Schema } from "effect";

import type { ProjectionSnapshotQueryShape } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { agentControlSupportForDriver } from "../ProviderInjection.ts";
import type { AgentControlExternalIntegrationServiceShape } from "../Services/AgentControlExternalIntegration.ts";
import type { AgentControlExternalTaskServiceShape } from "../Services/AgentControlExternalTask.ts";

export interface ExternalMcpToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface ExternalMcpToolResult {
  readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string }>;
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
}

export interface ExternalMcpTools {
  readonly descriptorsFor: (
    integration: AgentControlExternalIntegration,
  ) => ReadonlyArray<ExternalMcpToolDescriptor>;
  readonly hasTool: (name: string) => boolean;
  readonly callTool: (
    integrationId: AgentControlIntegrationId,
    name: string,
    args: unknown,
  ) => Effect.Effect<ExternalMcpToolResult>;
}

const descriptors: ReadonlyArray<ExternalMcpToolDescriptor> = [
  {
    name: AGENT_CONTROL_EXTERNAL_MCP_TOOLS.overview,
    description: "Describe this paired Ryco integration and its approval boundary.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: AGENT_CONTROL_EXTERNAL_MCP_TOOLS.capabilities,
    description: "List granted tools, provider instances, and task limits.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: AGENT_CONTROL_EXTERNAL_MCP_TOOLS.listAllowedProjects,
    description: "List projects this integration is explicitly allowed to target.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 50 } },
      additionalProperties: false,
    },
  },
  {
    name: AGENT_CONTROL_EXTERNAL_MCP_TOOLS.createTask,
    description: "Create one immutable task proposal. Ryco user approval is always required.",
    inputSchema: {
      type: "object",
      required: ["requestId", "projectId", "providerInstanceId", "model", "options", "prompt"],
      properties: {
        requestId: { type: "string", minLength: 1, maxLength: 128 },
        projectId: { type: "string", minLength: 1 },
        providerInstanceId: { type: "string", minLength: 1 },
        model: { type: "string", minLength: 1 },
        options: { type: "array" },
        title: { type: "string", minLength: 1, maxLength: 200 },
        prompt: { type: "string", minLength: 1, maxLength: 120000 },
        environment: { type: "string", enum: ["worktree", "local"] },
        runtimeMode: { type: "string", enum: ["approval-required", "full-access"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: AGENT_CONTROL_EXTERNAL_MCP_TOOLS.readTask,
    description: "Read the approval, execution, and terminal state of a task created here.",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: { taskId: { type: "string", minLength: 1, maxLength: 128 } },
      additionalProperties: false,
    },
  },
  {
    name: AGENT_CONTROL_EXTERNAL_MCP_TOOLS.waitForTask,
    description: "Wait boundedly for a task decision or terminal outcome.",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: {
        taskId: { type: "string", minLength: 1, maxLength: 128 },
        waitFor: { type: "string", enum: ["decided", "terminal"] },
        timeoutMs: { type: "integer", minimum: 1, maximum: 50000 },
      },
      additionalProperties: false,
    },
  },
];

const toolCapability = (name: string) => {
  switch (name) {
    case AGENT_CONTROL_EXTERNAL_MCP_TOOLS.listAllowedProjects:
      return AGENT_CONTROL_CAPABILITIES.externalListProjects;
    case AGENT_CONTROL_EXTERNAL_MCP_TOOLS.createTask:
      return AGENT_CONTROL_CAPABILITIES.externalCreateTask;
    case AGENT_CONTROL_EXTERNAL_MCP_TOOLS.readTask:
    case AGENT_CONTROL_EXTERNAL_MCP_TOOLS.waitForTask:
      return AGENT_CONTROL_CAPABILITIES.externalReadTask;
    default:
      return null;
  }
};

const providerSummary = (provider: ServerProvider): AgentControlMcpProviderInstanceSummary => {
  const support = agentControlSupportForDriver(provider.driver);
  const unavailableReason =
    provider.enabled && provider.status === "ready" && provider.availability !== "unavailable"
      ? null
      : "Provider instance is unavailable.";
  return {
    instanceId: provider.instanceId,
    driver: provider.driver,
    displayName: provider.displayName ?? null,
    enabled: provider.enabled,
    status: provider.status,
    availability: provider.availability ?? "available",
    models: provider.models
      .slice(0, AGENT_CONTROL_MCP_MODELS_PER_INSTANCE_MAX)
      .map((model) => ({ slug: model.slug, name: model.name })),
    agentControl: { ...support, available: unavailableReason === null, unavailableReason },
  };
};

export const makeExternalMcpTools = (deps: {
  readonly integrations: AgentControlExternalIntegrationServiceShape;
  readonly tasks: AgentControlExternalTaskServiceShape;
  readonly projections: ProjectionSnapshotQueryShape;
  readonly getProviders: Effect.Effect<ReadonlyArray<ServerProvider>>;
}): ExternalMcpTools => {
  const names = new Set<string>(AGENT_CONTROL_EXTERNAL_MCP_TOOL_NAMES);
  const descriptorsFor = (integration: AgentControlExternalIntegration) =>
    descriptors.filter((descriptor) => {
      const capability = toolCapability(descriptor.name);
      return capability === null || integration.capabilities.includes(capability);
    });
  const decode = <S extends Schema.Top>(schema: S, args: unknown) =>
    Schema.decodeUnknownEffect(schema)(args ?? {});

  const execute = (integrationId: AgentControlIntegrationId, name: string, args: unknown) =>
    Effect.gen(function* () {
      switch (name) {
        case AGENT_CONTROL_EXTERNAL_MCP_TOOLS.overview: {
          const integration = yield* deps.integrations.authorizeTool({ integrationId, tool: name });
          return Schema.encodeSync(AgentControlExternalOverviewResult)({
            integrationId,
            displayName: integration.displayName,
            clientKind: integration.clientKind,
            notice:
              "Every external task waits for explicit approval by a Ryco user before a thread is created.",
          });
        }
        case AGENT_CONTROL_EXTERNAL_MCP_TOOLS.capabilities: {
          const integration = yield* deps.integrations.authorizeTool({ integrationId, tool: name });
          const providers = yield* deps.getProviders;
          return Schema.encodeSync(AgentControlExternalCapabilitiesResult)({
            tools: descriptorsFor(integration).map((descriptor) => descriptor.name),
            grantedCapabilities: integration.capabilities,
            projectScope: integration.projectScope,
            rateLimitPerMinute: integration.rateLimitPerMinute,
            activeTaskLimit: integration.activeTaskLimit,
            activeTaskCount: integration.activeTaskCount,
            providerInstances: providers.map(providerSummary),
          });
        }
        case AGENT_CONTROL_EXTERNAL_MCP_TOOLS.listAllowedProjects: {
          const input = yield* decode(AgentControlMcpListProjectsInput, args);
          const integration = yield* deps.integrations.authorizeTool({
            integrationId,
            tool: name,
            requiredCapability: AGENT_CONTROL_CAPABILITIES.externalListProjects,
          });
          const snapshot = yield* deps.projections.getShellSnapshot();
          const allowed = snapshot.projects.filter(
            (project) =>
              integration.projectScope.kind === "all" ||
              integration.projectScope.projectIds.includes(project.id),
          );
          const limit = Math.min(Math.max(1, input.limit ?? 20), 50);
          return Schema.encodeSync(AgentControlMcpListProjectsResult)({
            projects: allowed.slice(0, limit).map((project) => ({
              projectId: project.id,
              title: project.title,
              createdAt: project.createdAt,
              updatedAt: project.updatedAt,
            })),
            nextCursor: null,
          });
        }
        case AGENT_CONTROL_EXTERNAL_MCP_TOOLS.createTask:
          return yield* deps.tasks.create({
            integrationId,
            request: yield* decode(AgentControlExternalCreateTaskInput, args),
          });
        case AGENT_CONTROL_EXTERNAL_MCP_TOOLS.readTask:
          return yield* deps.tasks.read({
            integrationId,
            taskId: (yield* decode(AgentControlExternalTaskIdInput, args)).taskId,
          });
        case AGENT_CONTROL_EXTERNAL_MCP_TOOLS.waitForTask:
          return yield* deps.tasks.wait({
            integrationId,
            request: yield* decode(AgentControlExternalWaitForTaskInput, args),
          });
        default:
          return yield* Effect.fail(new Error("Unknown external MCP tool"));
      }
    });

  const callTool: ExternalMcpTools["callTool"] = (integrationId, name, args) =>
    execute(integrationId, name, args).pipe(
      Effect.map((value) => ({
        content: [{ type: "text" as const, text: JSON.stringify(value) }],
        structuredContent: value,
      })),
      Effect.catch(() =>
        Effect.succeed({
          content: [{ type: "text" as const, text: "External Agent Control request was refused." }],
          isError: true,
        }),
      ),
      Effect.catchDefect(() =>
        Effect.succeed({
          content: [{ type: "text" as const, text: "External Agent Control request failed." }],
          isError: true,
        }),
      ),
    );

  return { descriptorsFor, hasTool: (name) => names.has(name), callTool };
};
