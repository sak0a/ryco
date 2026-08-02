import {
  BotIcon,
  GitCommitHorizontalIcon,
  GitPullRequestIcon,
  LoaderIcon,
  SparklesIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "~/lib/utils";

import type { PanelLayout } from "../../themes/appearancePreferences";
import {
  Accordion,
  AvatarStack,
  ChangesContent,
  ChecksContent,
  CheckDots,
  DiffStat,
  EnvironmentContent,
  getOverviewSummary,
  MetricCell,
  MetricTile,
  MiniProgress,
  type OverviewSummary,
  OverviewBadge,
  planPercent,
  PlanExplanation,
  PlanSteps,
  pickChangesItem,
  pickEnvironmentItem,
  ProposedPlanDisclosure,
  PullRequestContent,
  SECTION_ICON,
  SectionLane,
  SubagentRows,
} from "./overviewSections";
import type { OverviewLayoutProps } from "./overviewTypes";

/* ------------------------------------------------------------------ *
 * Shared derivations
 * ------------------------------------------------------------------ */

type SectionId = "changes" | "plan" | "agents" | "pr" | "env";

/** Check if either the active plan or proposed plan has content to display. */
function isPlanActive(props: OverviewLayoutProps): boolean {
  return Boolean(
    (props.activePlan && (props.activePlan.steps.length > 0 || props.activePlan.explanation)) ||
    props.activeProposedPlan?.planMarkdown,
  );
}

/** Animated pulse dot indicating an in-progress operation. */
function RunningDot() {
  return <span className="ml-px size-2 shrink-0 rounded-full bg-sky-400 animate-status-pulse" />;
}

/** Format a count and word pair with proper pluralization. */
function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Generate a brief status label for PR checks (failed count, running, or passing). */
function checksHint(summary: OverviewSummary, failedWord: string): string {
  if (summary.checksFailed > 0) return `${summary.checksFailed} ${failedWord}`;
  if (summary.checksRunning > 0) return `${summary.checksRunning} running`;
  return "passing";
}

function PlanValue({ summary }: { summary: OverviewSummary }) {
  return (
    <>
      {summary.planDone}
      <span className="text-[11px] font-normal text-muted-foreground">/{summary.planTotal}</span>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Section summary badges (accordion / lane heads)
 * ------------------------------------------------------------------ */

/** Display PR check results (pass/fail count) or merge conflict status; undefined if no PR. */
function pullRequestSummaryBadge(props: OverviewLayoutProps, summary: OverviewSummary): ReactNode {
  if (!props.pullRequest) return undefined;
  if (props.pullRequest.hasMergeConflicts)
    return <OverviewBadge tone="error">conflict</OverviewBadge>;
  if (summary.checksTotal > 0) {
    return (
      <OverviewBadge tone={summary.checksFailed > 0 ? "error" : "success"}>
        {summary.checksPassed}/{summary.checksTotal}
      </OverviewBadge>
    );
  }
  return undefined;
}

/** Display subagent count (running with spinner, or total). */
function subagentSummaryBadge(summary: OverviewSummary): ReactNode {
  if (summary.agentsRunning > 0) {
    return (
      <OverviewBadge tone="info">
        <LoaderIcon className="animate-spin" />
        {summary.agentsRunning}
      </OverviewBadge>
    );
  }
  return <OverviewBadge tone="neutral">{summary.agentsTotal}</OverviewBadge>;
}

/** Display plan progress (done/total); undefined if no plan steps. */
function planSummaryBadge(summary: OverviewSummary): ReactNode {
  if (summary.planTotal === 0) return undefined;
  return (
    <OverviewBadge tone="neutral">
      {summary.planDone} / {summary.planTotal}
    </OverviewBadge>
  );
}

/** Display environment status: warning detail if present, otherwise success indicator. */
function environmentSummaryBadge(detail: string | undefined): ReactNode {
  if (detail) return <OverviewBadge tone="warning">{detail}</OverviewBadge>;
  return (
    <OverviewBadge tone="success">
      <span className="size-1.5 rounded-full bg-current" /> ready
    </OverviewBadge>
  );
}

/** Suppress environment status text that only repeats the target with different casing. */
function distinctEnvironmentStatus(target: string, detail: string | undefined): string | undefined {
  const normalizedDetail = detail?.trim();
  if (!normalizedDetail) return undefined;
  return normalizedDetail.toLocaleLowerCase() === target.trim().toLocaleLowerCase()
    ? undefined
    : normalizedDetail;
}

/* ------------------------------------------------------------------ *
 * Section model (shared by stack + hybrid accordions)
 * ------------------------------------------------------------------ */

interface SectionDescriptor {
  id: SectionId;
  icon: ReactNode;
  title: ReactNode;
  summary: ReactNode;
  defaultOpen: boolean;
  body: ReactNode;
}

function buildSections(
  props: OverviewLayoutProps,
  summary: OverviewSummary,
  options: { prShowReviews: boolean },
): SectionDescriptor[] {
  const envItem = pickEnvironmentItem(props.overviewItems);
  const sections: SectionDescriptor[] = [];

  if (summary.fileCount > 0 || Boolean(pickChangesItem(props.overviewItems))) {
    sections.push({
      id: "changes",
      icon: SECTION_ICON.changes,
      title: "Changes",
      summary: summary.hasDiff ? (
        <DiffStat additions={summary.additions} deletions={summary.deletions} />
      ) : undefined,
      defaultOpen: true,
      body: (
        <ChangesContent
          changes={props.changes}
          overviewItems={props.overviewItems}
          onOpenReview={props.onOpenReview}
          pullRequestNumber={props.pullRequest?.number}
        />
      ),
    });
  }

  if (isPlanActive(props)) {
    sections.push({
      id: "plan",
      icon: SECTION_ICON.plan,
      title: "Plan",
      summary: planSummaryBadge(summary),
      defaultOpen: false,
      body: (
        <>
          <PlanExplanation activePlan={props.activePlan} />
          <PlanSteps activePlan={props.activePlan} />
          <ProposedPlanDisclosure
            activeProposedPlan={props.activeProposedPlan}
            environmentId={props.environmentId}
            markdownCwd={props.markdownCwd}
            workspaceRoot={props.workspaceRoot}
          />
        </>
      ),
    });
  }

  if ((props.subagents?.length ?? 0) > 0) {
    sections.push({
      id: "agents",
      icon: SECTION_ICON.agents,
      title: "Subagents",
      summary: subagentSummaryBadge(summary),
      defaultOpen: false,
      body: <SubagentRows subagents={props.subagents} onOpenSubagent={props.onOpenSubagent} />,
    });
  }

  if (props.pullRequest) {
    const pullRequest = props.pullRequest;
    const isRealPullRequest = pullRequest.number != null;
    sections.push({
      id: "pr",
      icon: isRealPullRequest ? SECTION_ICON.pr : SECTION_ICON.checks,
      title: isRealPullRequest ? `Pull Request #${pullRequest.number}` : "Checks",
      summary: pullRequestSummaryBadge(props, summary),
      defaultOpen: true,
      body: isRealPullRequest ? (
        <PullRequestContent
          pullRequest={pullRequest}
          showChecks
          showReviews={options.prShowReviews}
        />
      ) : (
        <ChecksContent pullRequest={pullRequest} />
      ),
    });
  }

  if (envItem) {
    sections.push({
      id: "env",
      icon: SECTION_ICON.env,
      title: "Environment",
      summary: environmentSummaryBadge(envItem.detail),
      defaultOpen: false,
      body: <EnvironmentContent overviewItems={props.overviewItems} />,
    });
  }

  return sections;
}

/* ------------------------------------------------------------------ *
 * Metric strip (stack) + metric tiles (hybrid)
 * ------------------------------------------------------------------ */

function MetricStrip({ summary }: { summary: OverviewSummary }) {
  const cells: ReactNode[] = [];
  if (summary.hasDiff || summary.fileCount > 0) {
    cells.push(
      <MetricCell
        key="diff"
        label="Diff"
        value={<DiffStat additions={summary.additions} deletions={summary.deletions} />}
        hint={plural(summary.fileCount, "file")}
      />,
    );
  }
  if (summary.checksTotal > 0) {
    cells.push(
      <MetricCell
        key="checks"
        label="Checks"
        tone={summary.checksFailed > 0 ? "danger" : "default"}
        value={`${summary.checksPassed}/${summary.checksTotal}`}
        hint={checksHint(summary, "failing")}
      />,
    );
  }
  if (summary.planTotal > 0) {
    cells.push(
      <MetricCell
        key="plan"
        label="Plan"
        value={<PlanValue summary={summary} />}
        hint={`${planPercent(summary)}% done`}
      />,
    );
  }
  if (summary.agentsTotal > 0) {
    cells.push(
      <MetricCell
        key="agents"
        label="Agents"
        value={
          <>
            {summary.agentsRunning}
            {summary.agentsRunning > 0 ? <RunningDot /> : null}
          </>
        }
        hint={summary.agentsRunning > 0 ? "running" : `${summary.agentsTotal} total`}
      />,
    );
  }
  if (cells.length === 0) return null;
  return (
    <div className="sticky top-0 z-10 flex gap-[7px] border-b border-border bg-card/92 px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-card/85">
      {cells}
    </div>
  );
}

function MetricTiles({
  summary,
  activeTile,
  onJump,
}: {
  summary: OverviewSummary;
  activeTile: SectionId;
  onJump: (id: SectionId) => void;
}) {
  const tiles: ReactNode[] = [];
  if (summary.hasDiff || summary.fileCount > 0) {
    tiles.push(
      <MetricTile
        key="diff"
        icon={<GitCommitHorizontalIcon />}
        label="Diff"
        value={<DiffStat additions={summary.additions} deletions={summary.deletions} />}
        hint={plural(summary.fileCount, "file")}
        isActive={activeTile === "changes"}
        onClick={() => onJump("changes")}
      />,
    );
  }
  if (summary.checksTotal > 0) {
    tiles.push(
      <MetricTile
        key="checks"
        icon={<GitPullRequestIcon />}
        label="Checks"
        tone={summary.checksFailed > 0 ? "danger" : "default"}
        value={`${summary.checksPassed}/${summary.checksTotal}`}
        hint={checksHint(summary, "failed")}
        isActive={activeTile === "pr"}
        onClick={() => onJump("pr")}
      />,
    );
  }
  if (summary.planTotal > 0) {
    tiles.push(
      <MetricTile
        key="plan"
        icon={<SparklesIcon />}
        label="Plan"
        value={<PlanValue summary={summary} />}
        hint={`${planPercent(summary)}%`}
        isActive={activeTile === "plan"}
        onClick={() => onJump("plan")}
      />,
    );
  }
  if (summary.agentsTotal > 0) {
    tiles.push(
      <MetricTile
        key="agents"
        icon={<BotIcon />}
        label="Agents"
        value={
          <>
            {summary.agentsRunning}
            {summary.agentsRunning > 0 ? <RunningDot /> : null}
          </>
        }
        hint={summary.agentsRunning > 0 ? "running" : `${summary.agentsTotal} total`}
        isActive={activeTile === "agents"}
        onClick={() => onJump("agents")}
      />,
    );
  }
  if (tiles.length === 0) return null;
  return <div className="grid grid-cols-4 gap-[7px] px-3 py-[11px]">{tiles}</div>;
}

/* ------------------------------------------------------------------ *
 * Layouts
 * ------------------------------------------------------------------ */

function StackLayout(props: OverviewLayoutProps) {
  const summary = getOverviewSummary(props);
  const sections = buildSections(props, summary, { prShowReviews: true });
  return (
    <div>
      <MetricStrip summary={summary} />
      <div>
        {sections.map((section) => (
          <Accordion
            key={section.id}
            icon={section.icon}
            title={section.title}
            summary={section.summary}
            defaultOpen={section.defaultOpen}
          >
            {section.body}
          </Accordion>
        ))}
      </div>
    </div>
  );
}

function HybridLayout(props: OverviewLayoutProps) {
  const summary = getOverviewSummary(props);
  const sections = buildSections(props, summary, { prShowReviews: false });

  // Track only sections the user has explicitly toggled; everything else falls
  // back to its `defaultOpen`. This way a section that mounts after the first
  // render (e.g. the PR section once it loads) still honors its default state
  // instead of being pinned closed by a stale controlled value.
  const [openOverrides, setOpenOverrides] = useState<Partial<Record<SectionId, boolean>>>({});
  const [activeTile, setActiveTile] = useState<SectionId>("changes");
  const [flashId, setFlashId] = useState<SectionId | null>(null);
  const sectionRefs = useRef(new Map<SectionId, HTMLDivElement | null>());
  const flashTimeoutRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (flashTimeoutRef.current !== null) window.clearTimeout(flashTimeoutRef.current);
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const toggle = useCallback((id: SectionId, defaultOpen: boolean) => {
    setOpenOverrides((prev) => ({ ...prev, [id]: !(prev[id] ?? defaultOpen) }));
  }, []);

  const handleJump = useCallback((id: SectionId) => {
    setActiveTile(id);
    setOpenOverrides((prev) => ({ ...prev, [id]: true }));
    setFlashId(null);
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      sectionRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setFlashId(id);
      if (flashTimeoutRef.current !== null) window.clearTimeout(flashTimeoutRef.current);
      flashTimeoutRef.current = window.setTimeout(() => setFlashId(null), 1000);
    });
  }, []);

  return (
    <div>
      <MetricTiles summary={summary} activeTile={activeTile} onJump={handleJump} />
      <div className="border-t border-border">
        {sections.map((section) => (
          <Accordion
            key={section.id}
            icon={section.icon}
            title={section.title}
            summary={section.summary}
            open={openOverrides[section.id] ?? section.defaultOpen}
            onToggle={() => toggle(section.id, section.defaultOpen)}
            flash={flashId === section.id}
            rootRef={(node) => sectionRefs.current.set(section.id, node)}
          >
            {section.body}
          </Accordion>
        ))}
      </div>
    </div>
  );
}

function StatusBoardLayout(props: OverviewLayoutProps) {
  const summary = getOverviewSummary(props);
  const changesItem = pickChangesItem(props.overviewItems);
  const envItem = pickEnvironmentItem(props.overviewItems);
  const subagents = props.subagents ?? [];
  const activeStep =
    props.activePlan?.steps.find((step) => step.status === "inProgress")?.step ??
    props.activePlan?.explanation ??
    undefined;
  const agentNames = subagents
    .slice(0, 2)
    .map((subagent) => subagent.name)
    .join(", ");
  const changesFileLabel =
    summary.fileCount > 0 ? plural(summary.fileCount, "file") : changesItem?.value;
  const environmentStatus = envItem
    ? distinctEnvironmentStatus(envItem.value, envItem.detail)
    : undefined;

  return (
    <div>
      {summary.fileCount > 0 || Boolean(changesItem) ? (
        <SectionLane
          icon={SECTION_ICON.changes}
          title="Changes"
          summary={
            <>
              {changesFileLabel ? (
                <span
                  className={cn(
                    "font-mono text-[10px] text-muted-foreground tabular-nums",
                    summary.hasDiff && "border-r border-border pr-1.5",
                  )}
                >
                  {changesFileLabel}
                </span>
              ) : null}
              {summary.hasDiff ? (
                <DiffStat
                  additions={summary.additions}
                  deletions={summary.deletions}
                  className="text-[10px]"
                />
              ) : null}
            </>
          }
          defaultOpen
        >
          <ChangesContent
            changes={props.changes}
            overviewItems={props.overviewItems}
            onOpenReview={props.onOpenReview}
            pullRequestNumber={props.pullRequest?.number}
          />
        </SectionLane>
      ) : null}

      {props.pullRequest ? (
        <SectionLane
          icon={SECTION_ICON.checks}
          title="Checks"
          subtitle={
            props.pullRequest.number != null
              ? `CI on PR #${props.pullRequest.number}`
              : summary.refName
                ? `CI on ${summary.refName}`
                : "CI"
          }
          summary={
            <>
              <CheckDots runs={props.pullRequest.latestRuns} />
              {summary.checksTotal > 0 ? (
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                  {summary.checksPassed}/{summary.checksTotal}
                </span>
              ) : null}
            </>
          }
        >
          <ChecksContent pullRequest={props.pullRequest} />
        </SectionLane>
      ) : null}

      {isPlanActive(props) ? (
        <SectionLane
          icon={SECTION_ICON.plan}
          title="Plan"
          subtitle={activeStep}
          summary={
            summary.planTotal > 0 ? (
              <>
                <MiniProgress value={planPercent(summary)} />
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                  {summary.planDone}/{summary.planTotal}
                </span>
              </>
            ) : undefined
          }
        >
          <PlanExplanation activePlan={props.activePlan} />
          <PlanSteps activePlan={props.activePlan} />
          <ProposedPlanDisclosure
            activeProposedPlan={props.activeProposedPlan}
            environmentId={props.environmentId}
            markdownCwd={props.markdownCwd}
            workspaceRoot={props.workspaceRoot}
          />
        </SectionLane>
      ) : null}

      {subagents.length > 0 ? (
        <SectionLane
          icon={SECTION_ICON.agents}
          title="Subagents"
          subtitle={agentNames ? `${agentNames}${subagents.length > 2 ? "…" : ""}` : undefined}
          summary={
            <>
              <AvatarStack subagents={subagents} />
              <span className="text-[11px] text-muted-foreground">
                {summary.agentsRunning > 0
                  ? `${summary.agentsRunning} running`
                  : `${summary.agentsTotal} total`}
              </span>
            </>
          }
        >
          <SubagentRows subagents={props.subagents} onOpenSubagent={props.onOpenSubagent} />
        </SectionLane>
      ) : null}

      {props.pullRequest && props.pullRequest.number != null ? (
        <SectionLane
          icon={SECTION_ICON.pr}
          title={`Pull Request #${props.pullRequest.number}`}
          subtitle={props.pullRequest.title}
          summary={
            <>
              {props.pullRequest.state ? (
                <OverviewBadge tone="success">{props.pullRequest.state}</OverviewBadge>
              ) : null}
              {props.pullRequest.hasMergeConflicts ? (
                <OverviewBadge tone="error">conflict</OverviewBadge>
              ) : null}
            </>
          }
          externalLink={
            props.pullRequest.url
              ? {
                  href: props.pullRequest.url,
                  ariaLabel: `Open pull request #${props.pullRequest.number} in a new tab`,
                }
              : undefined
          }
        >
          <PullRequestContent
            pullRequest={props.pullRequest}
            showTitle={false}
            showChecks={false}
            showReviews
          />
        </SectionLane>
      ) : null}

      {envItem ? (
        <SectionLane
          icon={SECTION_ICON.env}
          title="Environment"
          subtitle={envItem.value}
          summary={environmentSummaryBadge(environmentStatus)}
        />
      ) : null}
    </div>
  );
}

export function OverviewLayoutContent({
  layout,
  ...props
}: OverviewLayoutProps & { layout: PanelLayout }) {
  if (layout === "hybrid") return <HybridLayout {...props} />;
  if (layout === "board") return <StatusBoardLayout {...props} />;
  return <StackLayout {...props} />;
}
