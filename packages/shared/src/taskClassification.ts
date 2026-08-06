/**
 * Agent-vs-background task classification shared by the server ingest path
 * and client folds. Lives in shared (not contracts) because it is runtime
 * policy, not a wire schema — `packages/contracts` stays schema-only.
 */

/**
 * Watch-loop task types: Monitor-tool tasks plus background shells (a shell
 * that outlives its turn is in practice a watch loop). Canonical single copy —
 * the server liveness registry, ingestion's agentKind stamp, and the client
 * fold's legacy fallback all classify with these sets.
 */
export const MONITOR_TASK_TYPES: ReadonlySet<string> = new Set([
  "monitor",
  "monitor_mcp",
  "local_bash",
  "shell",
]);

/** Task types that are neither agents nor watch loops (plan-mode bookkeeping). */
export const INERT_TASK_TYPES: ReadonlySet<string> = new Set(["plan", "dream"]);

/**
 * Agent-vs-background classification, stamped by ingestion as `agentKind` so
 * persisted rows are self-describing. A deliberate denylist: the SDK's
 * agent-flavored type names drift (subagent, local_agent, local_workflow, …)
 * and an allowlist silently dropped real subagents when "local_agent"
 * appeared. A task launched from inside a subagent (agentId set) is
 * agent-internal background work UNLESS it is itself agent-flavored — a
 * nested agent can outlive its parent and stays in the roster.
 */
export function classifyTaskAgentKind(input: {
  readonly taskType?: string | undefined;
  readonly agentId?: string | undefined;
}): "agent" | "background" {
  const { taskType, agentId } = input;
  const nonAgentType =
    taskType !== undefined && (MONITOR_TASK_TYPES.has(taskType) || INERT_TASK_TYPES.has(taskType));
  if (agentId !== undefined && agentId.trim().length > 0) {
    return taskType === undefined || nonAgentType ? "background" : "agent";
  }
  return nonAgentType ? "background" : "agent";
}
