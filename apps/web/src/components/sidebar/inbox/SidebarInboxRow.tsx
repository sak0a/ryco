import type { ProviderInstanceEntry } from "@ryco/client-runtime/state/composer";
import type { ThreadInboxEntry } from "@ryco/client-runtime/state/threads";
import { PROVIDER_DISPLAY_NAMES, type ProviderDriverKind } from "@ryco/contracts";
import {
  CheckIcon,
  CircleAlertIcon,
  CloudIcon,
  FolderIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  LoaderCircleIcon,
  PinIcon,
  ServerIcon,
  Undo2Icon,
} from "lucide-react";
import { memo, type ReactNode, useMemo, useState } from "react";

import { cn } from "../../../lib/utils";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { ProjectFavicon } from "../../ProjectFavicon";
import { ProviderInstanceIcon } from "../../chat/ProviderInstanceIcon";
import { getTriggerDisplayModelLabel } from "../../chat/providerIconUtils";
import { ContextMenu, ContextMenuPopup, ContextMenuTrigger, MenuItem } from "../../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { entryActionDisabledReason } from "./sidebarInbox.logic";

interface SidebarInboxRowProps {
  readonly entry: ThreadInboxEntry;
  readonly showEnvironment: boolean;
  readonly providerEntryByInstanceId?: ReadonlyMap<string, ProviderInstanceEntry> | undefined;
  readonly onNavigate: (entry: ThreadInboxEntry) => void;
  readonly onSettle: (entry: ThreadInboxEntry) => Promise<boolean>;
  readonly onUnsettle: (entry: ThreadInboxEntry) => Promise<boolean>;
}

interface ActiveStatus {
  readonly label: string;
  readonly dotClassName: string;
  readonly pulse: boolean;
}

interface ProviderPresentation {
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly accentColor?: string | undefined;
  readonly modelLabel: string | null;
}

function activeStatus(entry: ThreadInboxEntry, failure: string | null): ActiveStatus | null {
  if (failure) {
    return { label: "Error", dotClassName: "bg-red-500", pulse: false };
  }
  const blocker = entry.lifecycle.settlementBlocker;
  if (blocker === "pending-approval") {
    return {
      label: "Approval needed",
      dotClassName: "bg-amber-500",
      pulse: false,
    };
  }
  if (blocker === "pending-user-input") {
    return {
      label: "Input needed",
      dotClassName: "bg-violet-500",
      pulse: false,
    };
  }
  if (blocker === "session-running" || blocker === "session-starting") {
    return { label: "Agent running", dotClassName: "bg-sky-500", pulse: true };
  }
  if (blocker === "local-queue" || blocker === "queued-turn") {
    return { label: "Queued", dotClassName: "bg-teal-500", pulse: false };
  }
  if (entry.isDraft) {
    return {
      label: "Draft",
      dotClassName: "bg-muted-foreground/50",
      pulse: false,
    };
  }
  return null;
}

function resolveProviderPresentation(
  entry: ThreadInboxEntry,
  providerEntryByInstanceId: ReadonlyMap<string, ProviderInstanceEntry> | undefined,
): ProviderPresentation | null {
  const selection = entry.thread?.modelSelection;
  const session = entry.thread?.session;
  const instanceId = session?.providerInstanceId ?? selection?.instanceId;
  const providerEntry = instanceId ? providerEntryByInstanceId?.get(instanceId) : undefined;
  const driverKind = providerEntry?.driverKind ?? session?.provider;
  if (!driverKind) return null;

  const selectedModel = selection
    ? providerEntry?.models.find((model) => model.slug === selection.model)
    : undefined;
  return {
    driverKind,
    displayName:
      providerEntry?.displayName ?? PROVIDER_DISPLAY_NAMES[driverKind] ?? String(driverKind),
    accentColor: providerEntry?.accentColor,
    modelLabel: selectedModel
      ? getTriggerDisplayModelLabel(selectedModel)
      : (selection?.model ?? null),
  };
}

function ProjectArtwork({ entry, className }: { entry: ThreadInboxEntry; className?: string }) {
  if (!entry.project) {
    return (
      <FolderIcon aria-hidden className={cn("shrink-0 text-muted-foreground/55", className)} />
    );
  }
  return (
    <ProjectFavicon
      {...(className ? { className } : {})}
      customAvatarContentHash={entry.project.customAvatarContentHash ?? null}
      cwd={entry.project.cwd}
      environmentId={entry.environment.environmentId}
      projectId={entry.project.id}
    />
  );
}

function DetailRow({
  icon,
  children,
  tone,
}: {
  icon: ReactNode;
  children: ReactNode;
  tone?: "error";
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-start gap-2 text-[11px] leading-4 text-muted-foreground",
        tone === "error" && "text-red-500",
      )}
    >
      <span className="mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

function InboxRowTooltip({
  entry,
  provider,
  failure,
}: {
  entry: ThreadInboxEntry;
  provider: ProviderPresentation | null;
  failure: string | null;
}) {
  const projectLabel = entry.project?.name ?? "Unknown project";
  const branchLabel = entry.worktree?.branch ?? entry.thread?.branch ?? entry.draft?.branch ?? null;
  const workspaceLabel =
    entry.worktree?.title ??
    entry.worktree?.worktreePath ??
    entry.thread?.worktreePath ??
    entry.draft?.worktreePath ??
    null;
  const blockerLabel =
    entry.lifecycle.settlementBlocker === "pending-approval"
      ? "Waiting for approval"
      : entry.lifecycle.settlementBlocker === "pending-user-input"
        ? "Waiting for your input"
        : null;

  return (
    <div className="w-72 space-y-2.5 px-1.5 py-1.5 text-left">
      <p className="text-sm font-semibold leading-5 text-popover-foreground">
        {entry.title || "Untitled thread"}
      </p>
      <div className="space-y-1.5">
        <DetailRow icon={<ProjectArtwork className="size-3.5" entry={entry} />}>
          {projectLabel}
        </DetailRow>
        <DetailRow icon={<ServerIcon aria-hidden className="size-3.5" />}>
          {entry.environment.label}
        </DetailRow>
        {workspaceLabel ? (
          <DetailRow icon={<FolderIcon aria-hidden className="size-3.5" />}>
            {workspaceLabel}
          </DetailRow>
        ) : null}
        {branchLabel ? (
          <DetailRow icon={<GitBranchIcon aria-hidden className="size-3.5" />}>
            {branchLabel}
          </DetailRow>
        ) : null}
        {provider ? (
          <DetailRow
            icon={
              <ProviderInstanceIcon
                accentColor={provider.accentColor}
                className="size-3.5"
                displayName={provider.displayName}
                driverKind={provider.driverKind}
                iconClassName="size-3.5"
              />
            }
          >
            {provider.modelLabel
              ? `${provider.displayName} · ${provider.modelLabel}`
              : provider.displayName}
          </DetailRow>
        ) : null}
        {entry.worktree?.prState ? (
          <DetailRow icon={<GitPullRequestIcon aria-hidden className="size-3.5" />}>
            Pull request {entry.worktree.prState}
          </DetailRow>
        ) : null}
        {blockerLabel ? (
          <DetailRow icon={<CircleAlertIcon aria-hidden className="size-3.5" />}>
            {blockerLabel}
          </DetailRow>
        ) : null}
        {failure ? (
          <DetailRow icon={<CircleAlertIcon aria-hidden className="size-3.5" />} tone="error">
            {failure}
          </DetailRow>
        ) : null}
      </div>
    </div>
  );
}

export const SidebarInboxRow = memo(function SidebarInboxRow({
  entry,
  showEnvironment,
  providerEntryByInstanceId,
  onNavigate,
  onSettle,
  onUnsettle,
}: SidebarInboxRowProps) {
  const [pending, setPending] = useState(false);
  const settled = entry.lifecycle.classification === "settled";
  const disabledReason = entryActionDisabledReason(entry);
  const actionDisabled = pending || disabledReason !== null;
  const failure = entry.thread?.error ?? entry.thread?.session?.lastError ?? null;
  const status = useMemo(() => activeStatus(entry, failure), [entry, failure]);
  const provider = useMemo(
    () => resolveProviderPresentation(entry, providerEntryByInstanceId),
    [entry, providerEntryByInstanceId],
  );
  const timestamp = settled
    ? (entry.lifecycle.effectiveSettlementTimestamp ?? entry.createdAt)
    : (entry.thread?.latestTurn?.startedAt ??
      entry.thread?.updatedAt ??
      entry.thread?.latestUserMessageAt ??
      entry.createdAt);
  const projectLabel = entry.project?.name ?? "Unknown project";
  const workspaceLabel = entry.worktree?.title ?? null;
  const branchLabel = entry.worktree?.branch ?? entry.thread?.branch ?? entry.draft?.branch ?? null;
  const prState = entry.worktree?.prState ?? null;

  const handleAction = async () => {
    if (actionDisabled) return;
    setPending(true);
    try {
      if (settled) await onUnsettle(entry);
      else await onSettle(entry);
    } finally {
      setPending(false);
    }
  };

  const actionLabel = settled ? "Move to Active" : "Settle thread";
  const navigationButton = (
    <button
      aria-current={entry.current ? "page" : undefined}
      className={cn(
        "min-w-0 flex-1 cursor-pointer rounded-lg text-left outline-hidden ring-ring focus-visible:ring-2",
        settled ? "flex h-9 items-center gap-2 px-2.5 pr-9" : "h-[78px] px-2.5 py-2 pr-9",
      )}
      onClick={() => onNavigate(entry)}
      type="button"
    >
      {settled ? (
        <>
          <ProjectArtwork className="size-3.5 opacity-65 grayscale" entry={entry} />
          <span className="min-w-0 flex-1 truncate text-xs text-sidebar-foreground/75">
            {entry.title || "Untitled thread"}
          </span>
          {provider ? (
            <ProviderInstanceIcon
              accentColor={provider.accentColor}
              className="size-3 opacity-55"
              displayName={provider.displayName}
              driverKind={provider.driverKind}
              iconClassName="size-3"
            />
          ) : null}
          <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground/55 transition-opacity group-hover/inbox-row:opacity-0 group-focus-within/inbox-row:opacity-0">
            {formatRelativeTimeLabel(timestamp)}
          </span>
        </>
      ) : (
        <>
          <span className="flex min-w-0 items-center gap-2">
            <ProjectArtwork className="size-4" entry={entry} />
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-muted-foreground">
              {projectLabel}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-[9px] tabular-nums text-muted-foreground/65 transition-opacity group-hover/inbox-row:opacity-0 group-focus-within/inbox-row:opacity-0">
              {status ? (
                <>
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      status.dotClassName,
                      status.pulse && "animate-pulse",
                    )}
                  />
                  <span className={cn(failure && "text-red-500")}>{status.label}</span>
                </>
              ) : (
                formatRelativeTimeLabel(timestamp)
              )}
            </span>
          </span>
          <span className="mt-1.5 flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-4 text-sidebar-foreground">
              {entry.title || "Untitled thread"}
            </span>
            {entry.pinned ? (
              <PinIcon aria-label="Pinned" className="size-3 shrink-0 text-muted-foreground" />
            ) : null}
          </span>
          <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[9px] text-muted-foreground/70">
            <span className="inline-flex min-w-0 flex-1 items-center gap-1">
              <GitBranchIcon aria-hidden className="size-2.5 shrink-0" />
              <span className="truncate font-mono">
                {workspaceLabel && workspaceLabel !== branchLabel
                  ? `${workspaceLabel} · ${branchLabel ?? "no branch"}`
                  : (branchLabel ?? workspaceLabel ?? "no branch")}
              </span>
            </span>
            {prState ? (
              <span
                aria-label={`Pull request ${prState}`}
                className={cn(
                  "inline-flex shrink-0 items-center gap-0.5",
                  prState === "merged" && "text-violet-500",
                )}
              >
                <GitPullRequestIcon aria-hidden className="size-2.5" />
                {prState}
              </span>
            ) : null}
            {showEnvironment ? (
              <CloudIcon aria-label={entry.environment.label} className="size-2.5 shrink-0" />
            ) : null}
            {provider ? (
              <ProviderInstanceIcon
                accentColor={provider.accentColor}
                className="size-3"
                displayName={provider.displayName}
                driverKind={provider.driverKind}
                iconClassName="size-3"
              />
            ) : null}
          </span>
        </>
      )}
    </button>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            className={cn(
              "group/inbox-row relative mx-2 flex min-w-0 items-center rounded-lg transition-colors",
              settled && "opacity-85",
              entry.current ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/65",
            )}
            data-thread-key={entry.key}
          />
        }
      >
        <Tooltip>
          <TooltipTrigger render={navigationButton} />
          <TooltipPopup align="start" className="whitespace-normal" side="right" sideOffset={7}>
            <InboxRowTooltip entry={entry} failure={failure} provider={provider} />
          </TooltipPopup>
        </Tooltip>

        <button
          aria-label={`${actionLabel}: ${entry.title || "Untitled thread"}`}
          className={cn(
            "absolute right-1.5 top-1.5 inline-flex h-6 items-center justify-center rounded-md px-1.5 text-[10px] font-medium text-muted-foreground opacity-0 outline-hidden ring-ring transition-[opacity,color,background-color] group-hover/inbox-row:opacity-100 group-focus-within/inbox-row:opacity-100 focus-visible:ring-2",
            !actionDisabled &&
              "cursor-pointer hover:bg-sidebar-accent hover:text-sidebar-foreground",
            actionDisabled && "cursor-not-allowed opacity-35 group-hover/inbox-row:opacity-35",
          )}
          disabled={actionDisabled}
          onClick={(event) => {
            event.stopPropagation();
            void handleAction();
          }}
          title={disabledReason ?? actionLabel}
          type="button"
        >
          {pending ? (
            <LoaderCircleIcon aria-hidden className="size-3 animate-spin" />
          ) : settled ? (
            <Undo2Icon aria-hidden className="size-3" />
          ) : (
            <>
              <CheckIcon aria-hidden className="size-3" />
              <span className="ml-1">Settle</span>
            </>
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuPopup align="start" className="min-w-40" side="bottom">
        <MenuItem
          disabled={actionDisabled}
          onClick={() => void handleAction()}
          title={disabledReason ?? actionLabel}
        >
          {settled ? <Undo2Icon /> : <CheckIcon />}
          {actionLabel}
        </MenuItem>
      </ContextMenuPopup>
    </ContextMenu>
  );
});
