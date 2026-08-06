/**
 * Agents workspace surface: the fleet view over the native subagent fold,
 * and the ONLY place the roster renders (the chat carries one CTA row per
 * spawn batch).
 *
 * Visualization rules:
 * - Live work first: running workflows and direct spawns sort above settled.
 * - Rows are flat status lines — no expansion, no per-agent tool feeds. The
 *   row answers "who / what phase / how much"; agents with a transcript
 *   deep-link into their workspace transcript tab instead of unfolding.
 * - A settled workflow run collapses to a single summary line; click it to
 *   show its member list inline (the one allowed toggle — run granularity,
 *   not agent granularity).
 * - Static status dots, DOM-write elapsed timers, plain token counters.
 */
import type { EnvironmentId, ThreadId } from "@ryco/contracts";
import {
  BotIcon,
  BracesIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { readEnvironmentApi } from "../environmentApi";
import {
  formatSubagentModelLabel,
  formatSubagentTokenCount,
  type AgentPanelModel,
  type AgentPanelWorkflowGroup,
  type RuntimeSubagent,
} from "../threadWorkspaceViewModel";
import { cn } from "~/lib/utils";
import { ScrollArea } from "./ui/scroll-area";

/**
 * In-flight states all present as Working (one steady state: detail belongs
 * in the activity sub-line, and a stalled/waiting/queued subagent is still
 * the fleet doing its job, not a user problem). Only settled states
 * differentiate.
 */
const STATUS_VISUALS: Record<RuntimeSubagent["status"], { dotClass: string; label: string }> = {
  pending: { dotClass: "bg-info", label: "Working" },
  running: { dotClass: "bg-info", label: "Working" },
  waiting: { dotClass: "bg-info", label: "Working" },
  // Idle reads as settled (muted, not sky): a resting Codex child looks done
  // unless resumed.
  idle: { dotClass: "bg-muted-foreground/50", label: "Idle · resumable" },
  completed: { dotClass: "bg-success", label: "Completed" },
  failed: { dotClass: "bg-destructive", label: "Failed" },
  cancelled: { dotClass: "bg-muted-foreground/60", label: "Stopped" },
  interrupted: { dotClass: "bg-muted-foreground/60", label: "Stopped" },
};

function StatusDot({ status }: { status: RuntimeSubagent["status"] }) {
  return (
    <span
      aria-hidden
      className={cn("size-1.5 shrink-0 rounded-full", STATUS_VISUALS[status].dotClass)}
    />
  );
}

function formatElapsedSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) {
    return `${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours === 0) {
    return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  }
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function elapsedBetween(startedAt: string, endIso: string | null): string {
  const start = Date.parse(startedAt);
  const end = endIso ? Date.parse(endIso) : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return "";
  }
  return formatElapsedSeconds((end - start) / 1000);
}

/**
 * How long a settled agent actually ran. The provider's own duration_ms is
 * authoritative when reported; activity timestamps are the fallback for
 * synthesized rows (workflow members) that carry no usage duration.
 */
function settledDuration(agent: RuntimeSubagent): string | null {
  if (agent.usage?.durationMs !== undefined) {
    return formatElapsedSeconds(agent.usage.durationMs / 1000);
  }
  if (agent.startedAt && agent.completedAt) {
    return elapsedBetween(agent.startedAt, agent.completedAt);
  }
  return null;
}

/**
 * Elapsed time for the current activation. Live agents self-tick via DOM
 * writes (zero React commits per tick); settled agents freeze at the run's
 * actual duration.
 */
function AgentElapsed({ agent }: { agent: RuntimeSubagent }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const live = agent.status === "running" || agent.status === "waiting";
  const startedAt = agent.startedAt;

  useEffect(() => {
    if (!live || !startedAt) {
      return;
    }
    const update = () => {
      if (textRef.current) {
        textRef.current.textContent = elapsedBetween(startedAt, null);
      }
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [live, startedAt]);

  if (!live) {
    const duration = settledDuration(agent);
    return duration ? <span className="tabular-nums">{duration}</span> : null;
  }
  if (!startedAt) {
    return null;
  }
  return (
    <span ref={textRef} className="tabular-nums">
      {elapsedBetween(startedAt, null)}
    </span>
  );
}

/**
 * Human label for an agent's last tool. The Workflow harness makes agents
 * deliver their result through an internal tool literally named
 * "StructuredOutput" — surfacing that verbatim reads like a bug, so it maps
 * to result language instead.
 */
function agentToolHint(name: string, live: boolean): string {
  if (/^structured[\s_-]?output$/i.test(name)) {
    return live ? "Delivering result" : "Delivered result";
  }
  return live ? `Using ${name}` : name;
}

/**
 * Status-dependent activity line. Live rows lead with what is happening now;
 * settled rows lead with the outcome. Errors are the only inline previews on
 * failed rows because they explain a red row at a glance.
 */
function agentActivityText(agent: RuntimeSubagent): string | null {
  const live =
    agent.status === "running" || agent.status === "pending" || agent.status === "waiting";
  if (live) {
    return (
      agent.progress ??
      (agent.lastToolName ? agentToolHint(agent.lastToolName, true) : null) ??
      agent.result ??
      agent.error
    );
  }
  return (
    agent.error ??
    agent.result ??
    agent.progress ??
    (agent.lastToolName ? agentToolHint(agent.lastToolName, false) : null)
  );
}

/** Hairline separation between stacked agent rows. */
function AgentRowList({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-border/30">{children}</div>;
}

/** Flat, non-interactive agent status line. No unfold. */
function AgentRow({ agent }: { agent: RuntimeSubagent }) {
  const visuals = STATUS_VISUALS[agent.status];
  const activity = agentActivityText(agent);
  const modelLabel = formatSubagentModelLabel(agent.model, agent.effort);

  return (
    <div className="px-1.5 py-2">
      <div className="flex items-start gap-2">
        <span className="flex h-5 items-center">
          <StatusDot status={agent.status} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="truncate text-sm font-medium">{agent.title}</span>
            {agent.role ? (
              <span className="max-w-28 truncate rounded-sm border border-border/60 px-1 font-mono text-[.65rem] text-muted-foreground">
                {agent.role}
              </span>
            ) : null}
            <span className="ml-auto flex items-center gap-1 font-mono text-[.7rem] text-muted-foreground/80">
              <AgentElapsed agent={agent} />
              {agent.status === "completed" ? (
                <CheckIcon aria-hidden className="size-3 text-success" />
              ) : null}
            </span>
          </span>
          {activity ? (
            <span
              className={cn(
                "mt-0.5 block truncate text-xs",
                agent.status === "failed" ? "text-destructive-foreground" : "text-muted-foreground",
              )}
            >
              {activity}
            </span>
          ) : null}
          <span className="mt-0.5 flex items-center gap-1 font-mono text-[.7rem] text-muted-foreground/70">
            {modelLabel ? <span className="truncate">{modelLabel}</span> : null}
            {agent.usage ? (
              <span className="tabular-nums">
                {modelLabel ? "· " : ""}
                {formatSubagentTokenCount(agent.usage.totalTokens)} tok
              </span>
            ) : null}
            {agent.usage?.toolUses !== undefined ? (
              <span>· {agent.usage.toolUses} tools</span>
            ) : null}
            {agent.activationCount > 1 ? <span>· run {agent.activationCount}</span> : null}
            <span className="sr-only">{visuals.label}</span>
          </span>
        </span>
      </div>
    </div>
  );
}

function workflowIsLive(group: AgentPanelWorkflowGroup): boolean {
  const status = group.workflow.status;
  return (
    status !== "completed" &&
    status !== "failed" &&
    status !== "cancelled" &&
    status !== "interrupted"
  );
}

function workflowMembers(group: AgentPanelWorkflowGroup): ReadonlyArray<RuntimeSubagent> {
  return [...group.phases.flatMap((phase) => phase.members), ...group.unphasedMembers];
}

/**
 * Phase rail: the run's shape at a glance. One segment per phase in order,
 * separated by chevrons; each segment shows title + one dot per member.
 * The whole arc (done → live → pending) is visible without scrolling the
 * member list.
 */
function PhaseRail({ group }: { group: AgentPanelWorkflowGroup }) {
  if (group.phases.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 px-1.5 pb-1 pt-1.5">
      {group.phases.map((phase, index) => (
        <div key={phase.index} className="flex items-center gap-1">
          {index > 0 ? (
            <ChevronRightIcon aria-hidden className="size-3 text-muted-foreground/40" />
          ) : null}
          <div
            className={cn(
              "flex items-center gap-1 rounded-sm border px-1.5 py-0.5",
              phase.state === "running"
                ? "border-info/40"
                : phase.state === "done"
                  ? "border-success/30"
                  : "border-border/50",
            )}
          >
            <span
              className={cn(
                "font-mono text-[.65rem]",
                phase.state === "running"
                  ? "text-info-foreground"
                  : phase.state === "done"
                    ? "text-success-foreground"
                    : "text-muted-foreground/70",
              )}
            >
              {phase.state === "done" ? "✓ " : ""}
              {phase.title}
            </span>
            <span className="flex items-center gap-0.5">
              {phase.members.length === 0 ? (
                <span className="font-mono text-[.6rem] text-muted-foreground/50">–</span>
              ) : (
                phase.members.map((member) => <StatusDot key={member.id} status={member.status} />)
              )}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

type WorkflowScriptState =
  | { readonly state: "loading" }
  | { readonly state: "loaded"; readonly contents: string; readonly truncated: boolean }
  | { readonly state: "failed" };

/** A hung RPC must resolve to the failed state (with its retry affordance),
 * not an indefinite "Loading…". */
const SCRIPT_FETCH_TIMEOUT_MS = 15_000;

/**
 * Read-only workflow script viewer, fetched through the contained
 * getWorkflowScript RPC (never a raw filesystem read from the client).
 */
function WorkflowScriptView({
  environmentId,
  threadId,
  scriptPath,
  onClose,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  scriptPath: string;
  onClose: () => void;
}) {
  const [result, setResult] = useState<WorkflowScriptState>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    setResult({ state: "loading" });
    const getWorkflowScript = readEnvironmentApi(environmentId)?.orchestration.getWorkflowScript;
    if (!getWorkflowScript) {
      setResult({ state: "failed" });
      return;
    }
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("workflow script fetch timed out")),
        SCRIPT_FETCH_TIMEOUT_MS,
      );
    });
    Promise.race([getWorkflowScript({ threadId, scriptPath }), timeout])
      .then((value) => {
        if (!cancelled) {
          setResult({ state: "loaded", contents: value.contents, truncated: value.truncated });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResult({ state: "failed" });
        }
      })
      .finally(() => {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      });
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    };
  }, [environmentId, threadId, scriptPath, attempt]);

  return (
    <div className="mx-1.5 mb-1 rounded-md border border-border/60 bg-background/60">
      <div className="flex items-center gap-2 border-b border-border/50 px-2 py-1">
        <BracesIcon aria-hidden className="size-3 text-muted-foreground" />
        <span className="truncate font-mono text-[.65rem] text-muted-foreground">
          {scriptPath.split("/").at(-1)}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close script"
          className="ml-auto text-muted-foreground hover:text-foreground"
        >
          <XIcon aria-hidden className="size-3" />
        </button>
      </div>
      <div className="max-h-72 overflow-auto p-2">
        {result.state === "loaded" ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-[.7rem] leading-relaxed text-foreground/90">
            {result.contents}
            {result.truncated ? "\n… (truncated)" : ""}
          </pre>
        ) : result.state === "failed" ? (
          <div className="flex items-center gap-2">
            <p className="text-xs text-destructive-foreground">Could not load the script.</p>
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Retry
            </button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Loading…</p>
        )}
      </div>
    </div>
  );
}

/**
 * Collapsible phase section: live phases open by default, done phases
 * collapsed to header + member dot row. User toggles override the default
 * and stick for the phase's lifetime.
 */
function PhaseSection({ phase }: { phase: AgentPanelWorkflowGroup["phases"][number] }) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? phase.state === "running";
  return (
    <div>
      <button
        type="button"
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        className={cn(
          "mt-2 flex w-full items-center gap-1.5 rounded-sm px-1.5 text-left text-[.65rem] font-medium uppercase tracking-wider hover:bg-accent/40",
          phase.state === "done"
            ? "text-success-foreground"
            : phase.state === "running"
              ? "text-info-foreground"
              : "text-muted-foreground/70",
        )}
      >
        {open ? (
          <ChevronDownIcon aria-hidden className="size-3 shrink-0" />
        ) : (
          <ChevronRightIcon aria-hidden className="size-3 shrink-0" />
        )}
        {phase.state === "done" ? <CheckIcon aria-hidden className="size-3" /> : null}
        <span>{phase.title}</span>
        <span className="font-normal normal-case text-muted-foreground/70">
          {phase.state === "pending" && phase.members.length === 0
            ? "pending"
            : phase.state === "done"
              ? `${phase.settledCount} done`
              : `${phase.activeCount} active · ${phase.settledCount} done`}
        </span>
        {!open && phase.members.length > 0 ? (
          <span className="ml-auto flex items-center gap-0.5">
            {phase.members.map((member) => (
              <StatusDot key={member.id} status={member.status} />
            ))}
          </span>
        ) : null}
      </button>
      {open ? (
        <AgentRowList>
          {phase.members.map((member) => (
            <AgentRow key={member.id} agent={member} />
          ))}
        </AgentRowList>
      ) : null}
    </div>
  );
}

/** Live workflow: phase rail + full phase tree. */
function LiveWorkflowSection({
  group,
  environmentId,
  threadId,
}: {
  group: AgentPanelWorkflowGroup;
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
}) {
  const [scriptOpen, setScriptOpen] = useState(false);
  const members = workflowMembers(group);
  const settled = members.filter(
    (member) =>
      member.status === "completed" ||
      member.status === "failed" ||
      member.status === "cancelled" ||
      member.status === "interrupted",
  ).length;
  const scriptPath = group.workflow.runHandles?.scriptPath;
  const canShowScript = scriptPath !== undefined && environmentId !== null && threadId !== null;
  return (
    <section className="rounded-lg border border-border/50 bg-card/30 p-1.5">
      <div className="flex items-center gap-2 px-1.5 pt-0.5 text-[.65rem] font-medium uppercase tracking-wider text-muted-foreground">
        <span aria-hidden className="size-1.5 rounded-full bg-info" />
        <span>{group.workflow.workflowName ?? group.workflow.title}</span>
        {canShowScript ? (
          <button
            type="button"
            onClick={() => setScriptOpen((value) => !value)}
            className={cn(
              "rounded-sm border border-border/60 px-1 font-mono normal-case hover:text-foreground",
              scriptOpen && "text-foreground",
            )}
            aria-expanded={scriptOpen}
          >
            {"{}"} script
          </button>
        ) : null}
        <span className="ml-auto font-mono normal-case text-muted-foreground/80">
          {settled}/{members.length} settled
        </span>
      </div>
      <PhaseRail group={group} />
      {scriptOpen && canShowScript ? (
        <WorkflowScriptView
          environmentId={environmentId}
          threadId={threadId}
          scriptPath={scriptPath}
          onClose={() => setScriptOpen(false)}
        />
      ) : null}
      {group.phases.map((phase) => (
        <PhaseSection key={phase.index} phase={phase} />
      ))}
      <AgentRowList>
        {group.unphasedMembers.map((member) => (
          <AgentRow key={member.id} agent={member} />
        ))}
      </AgentRowList>
      {group.phases.length === 0 && group.unphasedMembers.length === 0 ? (
        <AgentRow agent={group.workflow} />
      ) : null}
    </section>
  );
}

/**
 * Settled workflow: one summary line. Click toggles the member list — the
 * only expansion in the panel, at run granularity. The script stays
 * reachable after the run settles: runHandles survive the fold, and a
 * finished run is exactly when reading its script matters.
 */
function SettledWorkflowSection({
  group,
  environmentId,
  threadId,
}: {
  group: AgentPanelWorkflowGroup;
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
}) {
  const [open, setOpen] = useState(false);
  const [scriptOpen, setScriptOpen] = useState(false);
  const scriptPath = group.workflow.runHandles?.scriptPath;
  const canShowScript = scriptPath !== undefined && environmentId !== null && threadId !== null;
  const members = workflowMembers(group);
  const failed = members.filter((member) => member.status === "failed").length;
  // Coordinator usage may already aggregate members (panel-footer rule):
  // count it only when there are no member rows to sum.
  const totalTokens = members.reduce(
    (sum, member) => sum + (member.usage?.totalTokens ?? 0),
    members.length === 0 ? (group.workflow.usage?.totalTokens ?? 0) : 0,
  );
  const elapsed =
    group.workflow.startedAt && group.workflow.completedAt
      ? elapsedBetween(group.workflow.startedAt, group.workflow.completedAt)
      : null;
  return (
    <section>
      <div className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent/40">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
        >
          <StatusDot status={failed > 0 ? "failed" : group.workflow.status} />
          <span className="truncate text-sm">
            {group.workflow.workflowName ?? group.workflow.title}
          </span>
        </button>
        {canShowScript ? (
          <button
            type="button"
            onClick={() => setScriptOpen((value) => !value)}
            className={cn(
              "shrink-0 rounded-sm border border-border/60 px-1 font-mono text-[.65rem] text-muted-foreground hover:text-foreground",
              scriptOpen && "text-foreground",
            )}
            aria-expanded={scriptOpen}
          >
            {"{}"} script
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex shrink-0 items-center gap-1.5 font-mono text-[.7rem] text-muted-foreground/80"
          aria-expanded={open}
          tabIndex={-1}
        >
          {failed > 0 ? <span className="text-destructive-foreground">{failed} failed</span> : null}
          <span>{members.length} agents</span>
          <span className="tabular-nums">· {formatSubagentTokenCount(totalTokens)} tok</span>
          {elapsed ? <span className="tabular-nums">· {elapsed}</span> : null}
          {open ? (
            <ChevronDownIcon aria-hidden className="size-3" />
          ) : (
            <ChevronRightIcon aria-hidden className="size-3" />
          )}
        </button>
      </div>
      {scriptOpen && canShowScript ? (
        <WorkflowScriptView
          environmentId={environmentId}
          threadId={threadId}
          scriptPath={scriptPath}
          onClose={() => setScriptOpen(false)}
        />
      ) : null}
      {open ? (
        <div className="ms-3 border-s border-border/45 ps-2">
          <AgentRowList>
            {members.map((member) => (
              <AgentRow key={member.id} agent={member} />
            ))}
          </AgentRowList>
        </div>
      ) : null}
    </section>
  );
}

export function AgentsPanel({
  model,
  environmentId = null,
  threadId = null,
}: {
  model: AgentPanelModel;
  environmentId?: EnvironmentId | null;
  threadId?: ThreadId | null;
}) {
  if (!model.hasAgents) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <BotIcon aria-hidden className="size-6 text-muted-foreground/60" />
        <p className="text-sm font-medium">No agents yet</p>
        <p className="max-w-56 text-xs text-muted-foreground">
          When this thread spawns subagents or runs a workflow, they show up here with live status,
          activity, and token usage.
        </p>
      </div>
    );
  }

  const liveWorkflows = model.workflows.filter(workflowIsLive);
  const settledWorkflows = model.workflows.filter((group) => !workflowIsLive(group));
  const liveDirect = model.directAgents.filter(
    (agent) =>
      agent.status === "running" || agent.status === "pending" || agent.status === "waiting",
  );
  const settledDirect = model.directAgents.filter(
    (agent) =>
      agent.status !== "running" && agent.status !== "pending" && agent.status !== "waiting",
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-2">
          {liveWorkflows.map((group) => (
            <LiveWorkflowSection
              key={group.workflow.id}
              group={group}
              environmentId={environmentId}
              threadId={threadId}
            />
          ))}
          {liveDirect.length > 0 ? (
            <section>
              <div className="px-1.5 pt-1 text-[.65rem] font-medium uppercase tracking-wider text-muted-foreground">
                Direct spawns
              </div>
              <AgentRowList>
                {liveDirect.map((agent) => (
                  <AgentRow key={agent.id} agent={agent} />
                ))}
              </AgentRowList>
            </section>
          ) : null}
          {settledWorkflows.length > 0 || settledDirect.length > 0 ? (
            <section>
              <div className="px-1.5 pt-2 text-[.65rem] font-medium uppercase tracking-wider text-muted-foreground/70">
                Earlier
              </div>
              {settledWorkflows.map((group) => (
                <SettledWorkflowSection
                  key={group.workflow.id}
                  group={group}
                  environmentId={environmentId}
                  threadId={threadId}
                />
              ))}
              <AgentRowList>
                {settledDirect.map((agent) => (
                  <AgentRow key={agent.id} agent={agent} />
                ))}
              </AgentRowList>
            </section>
          ) : null}
        </div>
      </ScrollArea>
      <footer className="flex items-center justify-between border-t border-border/60 px-3 py-1.5 font-mono text-[.7rem] text-muted-foreground">
        <span className="flex items-center gap-2">
          {model.runningCount + model.waitingCount > 0 ? (
            <span className="text-info-foreground">
              ● {model.runningCount + model.waitingCount} working
            </span>
          ) : null}
          {model.idleCount > 0 ? <span>{model.idleCount} idle</span> : null}
          {model.settledCount > 0 ? <span>{model.settledCount} settled</span> : null}
        </span>
        <span className="tabular-nums">Σ {formatSubagentTokenCount(model.totalTokens)} tok</span>
      </footer>
    </div>
  );
}
