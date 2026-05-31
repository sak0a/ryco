import type { SourceControlLabel } from "@ryco/contracts";
import { CircleDotIcon, GitPullRequestIcon, TicketCheckIcon, UsersIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { avatarUrlForAuthor, hashAuthorToHue } from "./CommentThread.logic";
import { LabelChip } from "./LabelChip";

interface WorktreeItemSidebarProps {
  assignees?: ReadonlyArray<string> | null | undefined;
  labels?: ReadonlyArray<SourceControlLabel> | null | undefined;
  reviewers?: ReadonlyArray<string> | null | undefined;
  linkedIssueNumbers?: ReadonlyArray<number> | null | undefined;
  linkedChangeRequestNumbers?: ReadonlyArray<number> | null | undefined;
  linkedWorkItemKeys?: ReadonlyArray<string> | null | undefined;
  onSelectLinkedIssue?: ((issueNumber: number) => void) | undefined;
  onSelectLinkedChangeRequest?: ((number: number) => void) | undefined;
  onSelectLinkedWorkItem?: ((key: string) => void) | undefined;
}

export function WorktreeItemSidebar(props: WorktreeItemSidebarProps) {
  return (
    <aside className="flex max-h-56 w-full shrink-0 flex-col gap-4 overflow-y-auto border-border/60 border-t bg-muted/12 px-4 py-3 text-xs lg:max-h-none lg:w-72 lg:border-t-0 lg:border-l lg:py-4">
      {props.reviewers !== undefined ? (
        <SidebarSection title="Reviewers">
          <UserList logins={props.reviewers ?? []} emptyText="No reviewers" />
        </SidebarSection>
      ) : null}
      <SidebarSection title="Assignees">
        <UserList logins={props.assignees ?? []} emptyText="No one assigned" />
      </SidebarSection>
      <SidebarSection title="Labels">
        {props.labels && props.labels.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {props.labels.map((label) => (
              <LabelChip key={label.name} label={label} />
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground/70 text-xs italic">None</span>
        )}
      </SidebarSection>
      {props.linkedIssueNumbers !== undefined ? (
        <SidebarSection title="Linked issues">
          <RefList
            icon={<CircleDotIcon className="size-3" />}
            kind="issue"
            numbers={props.linkedIssueNumbers ?? []}
            onSelect={props.onSelectLinkedIssue}
          />
        </SidebarSection>
      ) : null}
      {props.linkedWorkItemKeys !== undefined ? (
        <SidebarSection title="Linked Jira">
          <WorkItemKeyList
            keys={props.linkedWorkItemKeys ?? []}
            onSelect={props.onSelectLinkedWorkItem}
          />
        </SidebarSection>
      ) : null}
      {props.linkedChangeRequestNumbers !== undefined ? (
        <SidebarSection title="Linked pull requests">
          <RefList
            icon={<GitPullRequestIcon className="size-3" />}
            kind="pr"
            numbers={props.linkedChangeRequestNumbers ?? []}
            onSelect={props.onSelectLinkedChangeRequest}
          />
        </SidebarSection>
      ) : null}
    </aside>
  );
}

function WorkItemKeyList(props: {
  keys: ReadonlyArray<string>;
  onSelect?: ((key: string) => void) | undefined;
}) {
  if (props.keys.length === 0) {
    return <span className="text-muted-foreground/70 text-xs italic">None</span>;
  }
  return (
    <ul className="flex flex-wrap gap-1">
      {props.keys.map((key) => (
        <li key={key}>
          {props.onSelect ? (
            <button
              type="button"
              onClick={() => props.onSelect?.(key)}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-foreground text-xs hover:bg-accent/60"
              aria-label={`View Jira work item ${key}`}
            >
              <TicketCheckIcon className="size-3" />
              <span>{key}</span>
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-foreground text-xs">
              <TicketCheckIcon className="size-3" />
              <span>{key}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
        {title}
      </h3>
      {children}
    </section>
  );
}

function UserList({ logins, emptyText }: { logins: ReadonlyArray<string>; emptyText: string }) {
  if (logins.length === 0) {
    return <span className="text-muted-foreground/70 text-xs italic">{emptyText}</span>;
  }
  return (
    <ul className="space-y-1.5">
      {logins.map((login) => (
        <li key={login} className="flex items-center gap-1.5">
          <UserAvatar login={login} />
          <span className="min-w-0 truncate text-foreground/90 text-xs">{login}</span>
        </li>
      ))}
    </ul>
  );
}

function UserAvatar({ login }: { login: string }) {
  const url = avatarUrlForAuthor(login);
  const hue = hashAuthorToHue(login);
  if (url === null) {
    return (
      <span
        aria-hidden
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
        style={{ backgroundColor: `hsl(${hue} 60% 40%)` }}
      >
        <UsersIcon className="size-2.5" />
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      width={20}
      height={20}
      loading="lazy"
      decoding="async"
      className={cn("inline-flex size-5 shrink-0 rounded-full bg-muted/40 object-cover")}
      aria-hidden
    />
  );
}

function RefList(props: {
  icon: React.ReactNode;
  kind: "issue" | "pr";
  numbers: ReadonlyArray<number>;
  onSelect?: ((n: number) => void) | undefined;
}) {
  if (props.numbers.length === 0) {
    return <span className="text-muted-foreground/70 text-xs italic">None</span>;
  }
  return (
    <ul className="flex flex-wrap gap-1">
      {props.numbers.map((n) => (
        <li key={n}>
          {props.onSelect ? (
            <button
              type="button"
              onClick={() => props.onSelect?.(n)}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-foreground text-xs hover:bg-accent/60"
              aria-label={`View ${props.kind === "pr" ? "pull request" : "issue"} #${n}`}
            >
              {props.icon}
              <span>#{n}</span>
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-foreground text-xs">
              {props.icon}
              <span>#{n}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
